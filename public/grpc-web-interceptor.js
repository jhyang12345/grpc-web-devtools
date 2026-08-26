(() => {
  const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
  const READY_EVENT = "grpc-web-dev-tools-ready";
  const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
  const REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
  const REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";
  const TRANSPORT = "grpc-web";
  const INSTRUMENTED = "__grpcWebDevtoolsInstrumented__";
  const ACTIVE_UNARY = "__grpcWebDevtoolsActiveUnary__";
  const ACTIVE_REPLAY = "__grpcWebDevtoolsActiveReplay__";
  const STATE_KEY = Symbol.for("grpc-web-inspector.grpc-replay-state");
  const LISTENER_KEY = Symbol.for("grpc-web-inspector.grpc-replay-listener");
  const MAX_REPLAY_HANDLES = 100;
  const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

  function getState() {
    if (!window[STATE_KEY]) {
      Object.defineProperty(window, STATE_KEY, {
        configurable: true,
        value: { registry: new Map(), adapters: new Map() },
      });
    }
    return window[STATE_KEY];
  }

  const state = getState();

  function monotonicNow() {
    return window.performance && typeof window.performance.now === "function" ? window.performance.now() : Date.now();
  }

  function nextRequestId() {
    const requestId = window.__grpcWebDevtoolsRequestId || 1;
    window.__grpcWebDevtoolsRequestId = requestId + 1;
    return requestId;
  }

  function safeStringify(value) {
    try { return JSON.stringify(value); } catch (_) { return ""; }
  }

  function byteLength(value) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
    return unescape(encodeURIComponent(value)).length;
  }

  function isPlainObject(value) {
    return !!value && Object.prototype.toString.call(value) === "[object Object]";
  }

  function serializeRequest(value) {
    try { return value && typeof value.toObject === "function" ? value.toObject() : value; } catch (error) {
      return { __error: `Serialization failed for request: ${error && error.message || "unknown error"}` };
    }
  }

  function serializeResponse(value) {
    try { return value && typeof value.toObject === "function" ? value.toObject() : value; } catch (error) {
      return { __error: `Serialization failed for response: ${error && error.message || "unknown error"}` };
    }
  }

  function serializeError(error) {
    const hasCode = error && (typeof error.code === "string" || typeof error.code === "number");
    const isNetworkError = !hasCode && error instanceof TypeError;
    return {
      code: error && error.code,
      message: error && error.message ? String(error.message) : String(error || "Unknown RPC error"),
      ...(isNetworkError ? { isNetworkError: true } : {}),
    };
  }

  function backendUrlFromMethod(method) {
    const value = typeof method === "string" ? method.trim() : "";
    return /^(https?:\/\/|\/)/i.test(value) ? value : undefined;
  }

  function post(payload) {
    window.postMessage({ type: POST_TYPE, transport: TRANSPORT, ...payload }, "*");
  }

  function randomToken() {
    const bytes = new Uint32Array(4);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 0xffffffff); });
    return Array.from(bytes, value => value.toString(36)).join("-");
  }

  function enforceReplayLimit() {
    while (state.registry.size > MAX_REPLAY_HANDLES) state.registry.delete(state.registry.keys().next().value);
  }

  function registerReplay(payload, invoke) {
    if (isPlainObject(payload) && payload.__error) {
      return { available: false, reason: "The captured request could not be serialized for replay." };
    }
    const serialized = safeStringify(payload);
    if (!serialized || byteLength(serialized) > MAX_PAYLOAD_BYTES) {
      return { available: false, reason: "The captured request exceeds the 5 MiB replay limit." };
    }
    enforceReplayLimit();
    let token;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = randomToken();
      if (!state.registry.has(candidate)) {
        token = candidate;
        break;
      }
    }
    if (!token) return { available: false, reason: "Unable to allocate a replay handle." };
    state.registry.set(token, { invoke });
    enforceReplayLimit();
    return { available: true, token };
  }

  function getReplay(token) {
    const handle = state.registry.get(token);
    if (!handle) return null;
    state.registry.delete(token);
    state.registry.set(token, handle);
    return handle;
  }

  function pascalCase(value) {
    return String(value).replace(/(^|[_\-\s]+)([a-zA-Z0-9])/g, (_, __, character) => character.toUpperCase());
  }

  function getterValue(target, field) {
    const names = [`get${pascalCase(field)}`];
    if (field.endsWith("List")) names.push(`get${pascalCase(field.slice(0, -4))}List`);
    const name = names.find(candidate => typeof target[candidate] === "function");
    try { return name ? target[name]() : null; } catch (_) { return null; }
  }

  function cloneMessage(Constructor, json, template) {
    const result = new Constructor();
    Object.keys(json).forEach(field => applyField(result, template, field, json[field]));
    return result;
  }

  function applyField(target, template, field, value) {
    const setter = `set${pascalCase(field)}`;
    const clearer = `clear${pascalCase(field)}`;
    if (value === null) {
      if (typeof target[clearer] === "function") return target[clearer]();
      if (typeof target[setter] === "function") return target[setter](value);
      throw new Error(`Field "${field}" cannot be cleared.`);
    }
    if (Array.isArray(value)) return applyArrayField(target, template, field, value, setter, clearer);
    if (isPlainObject(value)) return applyObjectField(target, template, field, value, setter);
    if (typeof target[setter] !== "function") throw new Error(`Field "${field}" cannot be set.`);
    target[setter](value);
  }

  function applyArrayField(target, template, field, value, setter, clearer) {
    if (typeof target[setter] !== "function") throw new Error(`Repeated field "${field}" cannot be set.`);
    if (!value.some(isPlainObject)) return target[setter](value.slice());
    const sample = getterValue(template, field);
    const sampleItem = Array.isArray(sample) ? sample[0] : null;
    if (!sampleItem || !sampleItem.constructor) throw new Error(`Repeated message field "${field}" requires an existing item to infer its type.`);
    const adder = `add${pascalCase(field.endsWith("List") ? field.slice(0, -4) : field)}`;
    if (typeof target[clearer] === "function") target[clearer]();
    if (typeof target[adder] === "function") {
      value.forEach(item => target[adder](isPlainObject(item) ? cloneMessage(sampleItem.constructor, item, sampleItem) : item));
    } else {
      target[setter](value.map(item => isPlainObject(item) ? cloneMessage(sampleItem.constructor, item, sampleItem) : item));
    }
  }

  function applyObjectField(target, template, field, value, setter) {
    if (typeof target[setter] !== "function") throw new Error(`Nested field "${field}" cannot be set.`);
    const nested = getterValue(template, field);
    if (!nested || !nested.constructor) throw new Error(`Nested field "${field}" requires an existing value to infer its type.`);
    target[setter](cloneMessage(nested.constructor, value, nested));
  }

  function reconstruct(method, originalRequest, json) {
    if (!isPlainObject(json)) throw new Error("Replay request JSON must be an object.");
    const adapter = state.adapters.get(method);
    if (adapter) return typeof adapter.fromJson === "function" ? adapter.fromJson(json, originalRequest) : adapter.createRequest(json, originalRequest);
    if (!originalRequest || typeof originalRequest.constructor !== "function") throw new Error("Unable to reconstruct the original gRPC-Web request type.");
    return cloneMessage(originalRequest.constructor, json, originalRequest);
  }

  function replayedFrom(command, requestId) {
    return { captureId: command.captureId, transport: TRANSPORT, requestId };
  }

  function withReplay(target, context, invoke) {
    target[ACTIVE_REPLAY] = context;
    try { return invoke(); } finally { delete target[ACTIVE_REPLAY]; }
  }

  function createUnaryCapture(method, request, requestPayload, replayedFromValue, createHandle) {
    const requestId = nextRequestId();
    const requestTimestamp = Date.now();
    const elapsedStart = monotonicNow();
    const replay = createHandle(requestId);
    let completed = false;
    const backendUrl = backendUrlFromMethod(method);
    post({ phase: "start", method, methodType: "unary", requestId, request: requestPayload, replay, replayedFrom: replayedFromValue, ...(backendUrl ? { backendUrl } : {}), timing: { requestTimestamp } });
    return {
      complete(error, response) {
        if (completed) return;
        completed = true;
        const completionTimestamp = Date.now();
        const event = { phase: error ? "error" : "complete", method, methodType: "unary", requestId, replayedFrom: replayedFromValue, timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, monotonicNow() - elapsedStart), messageCount: error ? 0 : 1 } };
        if (error) event.error = serializeError(error);
        else event.response = serializeResponse(response);
        post(event);
      },
    };
  }

  function instrumentClient(client) {
    const target = client && client.client_;
    if (!target || target[INSTRUMENTED]) return;
    const originalRpcCall = target.rpcCall;
    const originalServerStreaming = target.serverStreaming;
    const originalUnaryCall = target.unaryCall;
    if (typeof originalRpcCall !== "function" || typeof originalServerStreaming !== "function") return;
    Object.defineProperty(target, INSTRUMENTED, { value: true, configurable: true });

    target.rpcCall = function rpcCall(method, request, metadata, methodInfo, callback) {
      const context = this[ACTIVE_REPLAY];
      const activeCapture = this[ACTIVE_UNARY];
      const capture = activeCapture || (() => {
        const requestPayload = serializeRequest(request);
        return createUnaryCapture(method, request, requestPayload, context && context.replayedFrom, requestId => registerReplay(requestPayload, (json, command) => {
          const replayRequest = reconstruct(method, request, json);
          return withReplay(target, { replayedFrom: replayedFrom(command, requestId) }, () => target.rpcCall(method, replayRequest, metadata, methodInfo, () => {}));
        }));
      })();
      try {
        return originalRpcCall.call(this, method, request, metadata, methodInfo, (error, response) => {
          capture.complete(error, response);
          if (typeof callback === "function") callback(error, response);
        });
      } catch (error) {
        capture.complete(error);
        throw error;
      }
    };

    if (typeof originalUnaryCall === "function") {
      target.unaryCall = function unaryCall(method, request) {
        const context = this[ACTIVE_REPLAY];
        const requestPayload = serializeRequest(request);
        const originalArguments = Array.from(arguments);
        const capture = createUnaryCapture(method, request, requestPayload, context && context.replayedFrom, requestId => registerReplay(requestPayload, (json, command) => {
          const replayRequest = reconstruct(method, request, json);
          const replayArguments = originalArguments.slice();
          replayArguments[1] = replayRequest;
          return withReplay(target, { replayedFrom: replayedFrom(command, requestId) }, () => target.unaryCall.apply(target, replayArguments));
        }));
        this[ACTIVE_UNARY] = capture;
        let result;
        try { result = originalUnaryCall.apply(this, arguments); } catch (error) { capture.complete(error); throw error; } finally { delete this[ACTIVE_UNARY]; }
        if (result && typeof result.then === "function") result.then(response => capture.complete(null, response), error => capture.complete(error));
        else capture.complete(null, result);
        return result;
      };
    }

    target.serverStreaming = function serverStreaming(method, request, metadata, methodInfo) {
      const context = this[ACTIVE_REPLAY];
      const requestId = nextRequestId();
      const requestTimestamp = Date.now();
      const elapsedStart = monotonicNow();
      const requestPayload = serializeRequest(request);
      let messageCount = 0;
      let firstMessageAt;
      let terminal = false;
      const replay = registerReplay(requestPayload, (json, command) => {
        const replayRequest = reconstruct(method, request, json);
        const stream = withReplay(target, { replayedFrom: replayedFrom(command, requestId) }, () => target.serverStreaming(method, replayRequest, metadata, methodInfo));
        if (stream && typeof stream.on === "function") { stream.on("data", () => {}); stream.on("error", () => {}); }
        return stream;
      });
      const backendUrl = backendUrlFromMethod(method);
      post({ phase: "start", method, methodType: "server_streaming", requestId, request: requestPayload, replay, replayedFrom: context && context.replayedFrom, ...(backendUrl ? { backendUrl } : {}), timing: { requestTimestamp } });
      const finish = (phase, value) => {
        if (terminal) return;
        terminal = true;
        const completionTimestamp = Date.now();
        const event = { phase, method, methodType: "server_streaming", requestId, replayedFrom: context && context.replayedFrom, timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, monotonicNow() - elapsedStart), messageCount, timeToFirstMessage: firstMessageAt == null ? null : Math.max(0, firstMessageAt - elapsedStart) } };
        if (phase === "error") event.error = serializeError(value);
        else event.status = value && { code: value.code, details: value.details };
        post(event);
      };
      try {
        const stream = originalServerStreaming.call(this, method, request, metadata, methodInfo);
        stream.on("data", response => {
          messageCount += 1;
          if (firstMessageAt == null) firstMessageAt = monotonicNow();
          post({ phase: "message", method, methodType: "server_streaming", requestId, replayedFrom: context && context.replayedFrom, response: serializeResponse(response), timing: { requestTimestamp, messageCount, timeToFirstMessage: Math.max(0, firstMessageAt - elapsedStart) } });
        });
        stream.on("status", status => status && status.code !== 0 ? finish("error", { code: status.code, message: status.details || status.message || "gRPC stream failed" }) : finish("complete", status));
        stream.on("error", error => finish("error", error));
        return stream;
      } catch (error) {
        finish("error", error);
        throw error;
      }
    };
  }

  function enable(clients) {
    if (Array.isArray(clients)) clients.forEach(instrumentClient);
  }

  enable.registerMethod = (method, adapter) => {
    if (typeof method !== "string" || !adapter || (typeof adapter.fromJson !== "function" && typeof adapter.createRequest !== "function")) throw new Error("A replay adapter must provide fromJson or createRequest.");
    state.adapters.set(method, adapter);
  };
  enable.unregisterMethod = method => state.adapters.delete(method);
  window.__GRPCWEB_DEVTOOLS__ = enable;

  function rejectReplay(data, reason) {
    window.postMessage({ type: REPLAY_REJECTED_TYPE, transport: TRANSPORT, captureId: data && data.captureId, replayToken: data && data.replayToken, sourceEntryId: data && data.sourceEntryId, replayAttemptId: data && data.replayAttemptId, reason: String(reason) }, "*");
  }

  function onReplay(event) {
    const data = event.source === window && event.data;
    if (!data || data.type !== REPLAY_REQUEST_TYPE || data.transport !== TRANSPORT) return;
    const serialized = safeStringify(data.request);
    if (typeof data.replayToken !== "string" || !isPlainObject(data.request) || !serialized || byteLength(serialized) > MAX_PAYLOAD_BYTES) return rejectReplay(data, "The replay request is invalid or exceeds 5 MiB.");
    const handle = getReplay(data.replayToken);
    if (!handle) return rejectReplay(data, "This replay handle is no longer available.");
    try {
      const result = handle.invoke(data.request, data);
      if (result && typeof result.then === "function") result.catch(() => {});
      window.postMessage({ type: REPLAY_ACK_TYPE, transport: TRANSPORT, captureId: data.captureId, replayToken: data.replayToken, sourceEntryId: data.sourceEntryId, replayAttemptId: data.replayAttemptId }, "*");
    } catch (error) {
      rejectReplay(data, error && error.message || "Replay could not be started.");
    }
  }

  const previousListener = window[LISTENER_KEY];
  if (previousListener) {
    window.removeEventListener("message", previousListener.onReplay, false);
    window.removeEventListener("pagehide", previousListener.cleanup, false);
    window.removeEventListener("unload", previousListener.cleanup, false);
  }
  const cleanup = () => state.registry.clear();
  window.addEventListener("message", onReplay, false);
  window.addEventListener("pagehide", cleanup, false);
  window.addEventListener("unload", cleanup, false);
  Object.defineProperty(window, LISTENER_KEY, { configurable: true, value: { onReplay, cleanup } });
  window.dispatchEvent(new CustomEvent(READY_EVENT));
})();
