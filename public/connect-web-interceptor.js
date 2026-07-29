(() => {
  const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
  const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
  const REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
  const REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";
  const TRANSPORT = "connect-web";
  const STATE_KEY = Symbol.for("grpc-web-inspector.connect-replay-state");
  const LISTENER_KEY = Symbol.for("grpc-web-inspector.connect-replay-listener");
  const MAX_REPLAY_HANDLES = 100;
  const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

  function getState() {
    if (!window[STATE_KEY]) Object.defineProperty(window, STATE_KEY, { configurable: true, value: { registry: new Map() } });
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
    try {
      return value && typeof value.toJson === "function"
        ? value.toJson({ emitDefaultValues: true })
        : value;
    } catch (error) {
      return { __error: `Serialization failed for request: ${error && error.message || "unknown error"}` };
    }
  }

  function serializeResponse(value) {
    try { return value && typeof value.toJson === "function" ? value.toJson() : value; } catch (error) {
      return { __error: `Serialization failed for response: ${error && error.message || "unknown error"}` };
    }
  }

  function serializeError(error) {
    return { code: error && error.code, message: error && error.message ? String(error.message) : String(error || "Unknown RPC error") };
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
    if (!serialized || byteLength(serialized) > MAX_PAYLOAD_BYTES) return { available: false, reason: "The captured request exceeds the 5 MiB replay limit." };
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

  function reconstruct(original, json) {
    if (!isPlainObject(json)) throw new Error("Replay request JSON must be an object.");
    const Constructor = original && original.constructor;
    if (!Constructor) throw new Error("Unable to reconstruct the original Connect request type.");
    if (typeof Constructor.fromJson === "function") return Constructor.fromJson(json);
    if (typeof Constructor.fromJsonString === "function") return Constructor.fromJsonString(JSON.stringify(json));
    try { return new Constructor(json); } catch (_) {}
    const result = new Constructor();
    if (typeof result.fromJson === "function") { result.fromJson(json); return result; }
    if (typeof result.fromJsonString === "function") { result.fromJsonString(JSON.stringify(json)); return result; }
    throw new Error("This Connect request type does not expose a supported JSON constructor.");
  }

  function replayedFrom(command, requestId) {
    return { captureId: command.captureId, transport: TRANSPORT, requestId };
  }

  function freshReplayRequest(req, message) {
    const replayReq = { ...req, message };
    const hasSignal = !!req.signal || !!(req.init && req.init.signal);
    if (!hasSignal) return replayReq;
    if (typeof AbortController === "undefined") {
      if ((req.signal && req.signal.aborted) || (req.init && req.init.signal && req.init.signal.aborted)) throw new Error("The original request cancellation signal is already aborted.");
      return replayReq;
    }
    const signal = new AbortController().signal;
    replayReq.signal = signal;
    if (req.init) replayReq.init = { ...req.init, signal };
    return replayReq;
  }

  const readStream = async function* (req, stream, requestId, requestTimestamp, elapsedStart, replayedFromValue) {
    let messageCount = 0;
    let firstMessageAt;
    try {
      for await (const message of stream) {
        messageCount += 1;
        if (firstMessageAt == null) firstMessageAt = monotonicNow();
        post({ phase: "message", method: req.method.name, methodType: "server_streaming", requestId, replayedFrom: replayedFromValue, response: serializeResponse(message), timing: { requestTimestamp, messageCount, timeToFirstMessage: Math.max(0, firstMessageAt - elapsedStart) } });
        yield message;
      }
      const completionTimestamp = Date.now();
      post({ phase: "complete", method: req.method.name, methodType: "server_streaming", requestId, replayedFrom: replayedFromValue, timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, monotonicNow() - elapsedStart), messageCount, timeToFirstMessage: firstMessageAt == null ? null : Math.max(0, firstMessageAt - elapsedStart) } });
    } catch (error) {
      const completionTimestamp = Date.now();
      post({ phase: "error", method: req.method.name, methodType: "server_streaming", requestId, replayedFrom: replayedFromValue, error: serializeError(error), timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, monotonicNow() - elapsedStart), messageCount, timeToFirstMessage: firstMessageAt == null ? null : Math.max(0, firstMessageAt - elapsedStart) } });
      throw error;
    }
  };

  async function execute(next, req, replayedFromValue) {
    const requestId = nextRequestId();
    const requestTimestamp = Date.now();
    const elapsedStart = monotonicNow();
    const methodType = req.stream ? "server_streaming" : "unary";
    const backendUrl = typeof req.url === "string" && req.url ? req.url : undefined;
    const requestPayload = serializeRequest(req.message);
    const replay = registerReplay(requestPayload, (json, command) => {
      const message = reconstruct(req.message, json);
      const replayReq = freshReplayRequest(req, message);
      return execute(next, replayReq, replayedFrom(command, requestId)).then(response => {
        if (!response || !response.stream) return response;
        return (async () => { for await (const _ of response.message) {} return response; })();
      });
    });
    post({ phase: "start", method: req.method.name, methodType, requestId, request: requestPayload, replay, replayedFrom: replayedFromValue, ...(backendUrl ? { backendUrl } : {}), timing: { requestTimestamp } });
    try {
      const response = await next(req);
      if (response.stream) return { ...response, message: readStream(req, response.message, requestId, requestTimestamp, elapsedStart, replayedFromValue) };
      const completionTimestamp = Date.now();
      post({ phase: "complete", method: req.method.name, methodType, requestId, replayedFrom: replayedFromValue, response: serializeResponse(response.message), timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, monotonicNow() - elapsedStart), messageCount: 1 } });
      return response;
    } catch (error) {
      const completionTimestamp = Date.now();
      post({ phase: "error", method: req.method.name, methodType, requestId, replayedFrom: replayedFromValue, error: serializeError(error), timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, monotonicNow() - elapsedStart), messageCount: 0 } });
      throw error;
    }
  }

  window.__CONNECT_WEB_DEVTOOLS__ = next => req => execute(next, req);

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
  window.dispatchEvent(new CustomEvent("connect-web-dev-tools-ready"));
})();
