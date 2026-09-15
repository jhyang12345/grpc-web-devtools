(() => {
  "use strict";

  const API_NAME = "__GRPCWEB_DEVTOOLS_PROTOBUF_TS__";
  const READY_EVENT = "grpc-web-dev-tools-protobuf-ts-ready";
  const PROTOCOL_VERSION = 1;
  const EVENT_TYPE = "__GRPCWEB_DEVTOOLS__";
  const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
  const REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
  const REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";
  const TRANSPORT = "protobuf-ts";
  const STATE_KEY = Symbol.for("grpc-web-inspector.protobuf-ts-replay-state");
  const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
  const MAX_REPLAY_HANDLES = 100;
  // Explicit allowlist, not a redaction blocklist: options.meta also carries
  // `authorization: bearer <token>` on every call, so only ever copy keys
  // named here — never iterate/copy meta wholesale, no matter how tempting
  // that looks later.
  const CAPTURED_METADATA_KEYS = ["app-version", "service-name"];

  function getState() {
    if (!window[STATE_KEY]) {
      Object.defineProperty(window, STATE_KEY, {
        configurable: true,
        value: {
          api: null,
          listenerInstalled: false,
          nextRequestId: 1,
          registry: new Map(),
        },
      });
    }
    return window[STATE_KEY];
  }

  const state = getState();
  if (state.api) {
    window[API_NAME] = state.api;
    window.dispatchEvent(new CustomEvent(READY_EVENT));
    return;
  }

  function monotonicNow() {
    return window.performance && typeof window.performance.now === "function"
      ? window.performance.now()
      : Date.now();
  }

  function nextRequestId() {
    const requestId = state.nextRequestId;
    state.nextRequestId += 1;
    return requestId;
  }

  function errorMessage(error) {
    return error && error.message ? String(error.message) : String(error || "Unknown RPC error");
  }

  function byteLength(value) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
    return unescape(encodeURIComponent(value)).length;
  }

  function isJsonObject(value) {
    return !!value && Object.prototype.toString.call(value) === "[object Object]";
  }

  function limitPayload(value) {
    let serialized;
    try {
      serialized = JSON.stringify(value);
      if (serialized === undefined) throw new Error("Value is not JSON serializable");
    } catch (error) {
      return {
        payload: { __error: `Serialization failed: ${errorMessage(error)}` },
        byteSize: 0,
        replayable: false,
      };
    }

    const originalSizeBytes = byteLength(serialized);
    if (originalSizeBytes > MAX_PAYLOAD_BYTES) {
      return {
        payload: {
          __truncated: true,
          __originalSizeBytes: originalSizeBytes,
          preview: serialized.slice(0, 2000),
        },
        byteSize: originalSizeBytes,
        replayable: false,
      };
    }

    return {
      payload: JSON.parse(serialized),
      byteSize: originalSizeBytes,
      replayable: true,
    };
  }

  function typeUrlToTypeName(typeUrl) {
    const index = typeUrl.lastIndexOf("/");
    return index === -1 ? typeUrl : typeUrl.slice(index + 1);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const safeBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array();
    for (let index = 0; index < safeBytes.length; index += 1) binary += String.fromCharCode(safeBytes[index]);
    return typeof btoa === "function" ? btoa(binary) : "";
  }

  function isAnyShaped(value) {
    return isJsonObject(value) && typeof value.typeUrl === "string" && value.value instanceof Uint8Array;
  }

  // toJson() throws the moment it hits a google.protobuf.Any whose packed type
  // isn't in options.typeRegistry, discarding the ENTIRE message even though
  // everything else in it serialized fine. We can't know the app's full type
  // registry, so instead of losing the whole payload, walk the decoded message
  // ourselves first, find any Any fields the registry can't resolve, and hand
  // toJson() a patched registry with synthetic stand-in entries for exactly
  // those types (their raw bytes are shown, base64-encoded, instead of the
  // expanded fields).
  function collectUnresolvableAnyTypeNames(value, registry, seen, found, depth) {
    if (depth > 12 || !value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    if (isAnyShaped(value)) {
      if (value.typeUrl === "") return;
      const typeName = typeUrlToTypeName(value.typeUrl);
      if (!registry.some(type => type.typeName === typeName)) found.set(typeName, value.typeUrl);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(item => collectUnresolvableAnyTypeNames(item, registry, seen, found, depth + 1));
      return;
    }

    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        collectUnresolvableAnyTypeNames(value[key], registry, seen, found, depth + 1);
      }
    }
  }

  function createUnresolvedAnyStub(typeName, typeUrl) {
    return {
      typeName,
      fromBinary: bytes => bytes,
      internalJsonWrite: bytes => ({
        __unresolvedAnyType: true,
        "@type": typeUrl,
        note: "Not in the app's protobuf-ts typeRegistry; showing raw bytes instead of expanded fields.",
        valueBase64: bytesToBase64(bytes),
      }),
    };
  }

  function withResilientTypeRegistry(message, jsonOptions) {
    const baseRegistry = jsonOptions && Array.isArray(jsonOptions.typeRegistry) ? jsonOptions.typeRegistry : [];
    const found = new Map();
    try {
      collectUnresolvableAnyTypeNames(message, baseRegistry, new WeakSet(), found, 0);
    } catch (_) {
      return jsonOptions;
    }
    if (found.size === 0) return jsonOptions;
    const stubs = Array.from(found, ([typeName, typeUrl]) => createUnresolvedAnyStub(typeName, typeUrl));
    return { ...jsonOptions, typeRegistry: [...baseRegistry, ...stubs] };
  }

  function serializeMessage(messageType, message, options, emitDefaultValues = false) {
    try {
      const baseJsonOptions = emitDefaultValues
        ? { ...(options && options.jsonOptions), emitDefaultValues: true }
        : options && options.jsonOptions;
      const jsonOptions = withResilientTypeRegistry(message, baseJsonOptions);
      return limitPayload(messageType.toJson(message, jsonOptions));
    } catch (error) {
      return {
        payload: { __error: `Protobuf JSON serialization failed: ${errorMessage(error)}` },
        byteSize: 0,
        replayable: false,
      };
    }
  }

  function extractAllowlistedMetadata(meta) {
    if (!meta || typeof meta !== "object") return undefined;
    const result = {};
    Object.keys(meta).forEach(key => {
      const normalizedKey = key.toLowerCase();
      if (!CAPTURED_METADATA_KEYS.includes(normalizedKey)) return;
      const value = meta[key];
      const normalizedValue = Array.isArray(value) ? value[0] : value;
      if (typeof normalizedValue === "string" && normalizedValue && normalizedValue.length <= 512) result[normalizedKey] = normalizedValue;
    });
    return Object.keys(result).length && new TextEncoder().encode(JSON.stringify(result)).length <= 2048 ? result : undefined;
  }

  // See public/request-metadata-snoop.js: a wire-level fallback for headers
  // attached closer to the real network call than options.meta reflects at
  // the point we read it.
  function takeSnoopedMeta() {
    try {
      return typeof window.__GRPCWEB_DEVTOOLS_TAKE_LAST_REQUEST_META__ === "function"
        ? window.__GRPCWEB_DEVTOOLS_TAKE_LAST_REQUEST_META__()
        : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function serializeError(error) {
    const hasCode = error && (typeof error.code === "string" || typeof error.code === "number");
    const details = {
      name: error && error.name ? String(error.name) : "Error",
      message: errorMessage(error),
    };
    if (hasCode) details.code = error.code;
    if (!hasCode && error instanceof TypeError) details.isNetworkError = true;
    return limitPayload(details).payload;
  }

  function serializeStatus(status) {
    return {
      code: status && status.code,
      details: status && status.detail,
    };
  }

  function postEvent(payload) {
    try {
      window.postMessage({ type: EVENT_TYPE, transport: TRANSPORT, ...payload }, "*");
    } catch (_) {
      // Debug instrumentation must never alter the application RPC.
    }
  }

  function randomToken() {
    const values = new Uint32Array(4);
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(values);
      } else {
        values.forEach((_, index) => {
          values[index] = Math.floor(Math.random() * 0xffffffff);
        });
      }
    } catch (_) {
      values.forEach((_, index) => {
        values[index] = Math.floor(Math.random() * 0xffffffff);
      });
    }
    return Array.from(values, value => value.toString(36)).join("-");
  }

  function enforceReplayLimit() {
    while (state.registry.size > MAX_REPLAY_HANDLES) {
      state.registry.delete(state.registry.keys().next().value);
    }
  }

  function replayResult(type, command, reason) {
    const message = {
      type,
      transport: TRANSPORT,
      captureId: command.captureId,
      replayToken: command.replayToken,
      replayAttemptId: command.replayAttemptId,
      sourceEntryId: command.sourceEntryId,
    };
    if (reason) message.reason = String(reason);
    try {
      window.postMessage(message, "*");
    } catch (_) {
      // The content script will time out a result that cannot be cloned.
    }
  }

  function getReplayHandle(token) {
    const handle = state.registry.get(token);
    if (!handle) return null;
    state.registry.delete(token);
    state.registry.set(token, handle);
    return handle;
  }

  function validateReplayRequest(request) {
    if (!isJsonObject(request)) return "Replay request JSON must be an object.";
    const limited = limitPayload(request);
    if (!limited.replayable) {
      return limited.byteSize > MAX_PAYLOAD_BYTES
        ? "The replay request exceeds the 5 MiB limit."
        : "The replay request could not be serialized.";
    }
    return null;
  }

  function installReplayListener() {
    if (state.listenerInstalled) return;
    state.listenerInstalled = true;

    window.addEventListener("message", event => {
      const command = event.source === window ? event.data : null;
      if (
        !command ||
        command.type !== REPLAY_REQUEST_TYPE ||
        command.transport !== TRANSPORT ||
        typeof command.replayToken !== "string"
      ) {
        return;
      }

      const handle = getReplayHandle(command.replayToken);
      if (!handle) {
        replayResult(REPLAY_REJECTED_TYPE, command, "This replay handle is no longer available.");
        return;
      }
      const validationError = validateReplayRequest(command.request);
      if (validationError) {
        replayResult(REPLAY_REJECTED_TYPE, command, validationError);
        return;
      }

      try {
        handle.invoke(command.request, command);
        replayResult(REPLAY_ACK_TYPE, command);
      } catch (error) {
        replayResult(REPLAY_REJECTED_TYPE, command, errorMessage(error));
      }
    }, false);

    window.addEventListener("pagehide", () => {
      state.registry.clear();
    }, false);
  }

  function registerReplay(payload, invoke) {
    if (!payload.replayable || !isJsonObject(payload.payload)) {
      return {
        available: false,
        reason: payload.byteSize > MAX_PAYLOAD_BYTES
          ? "The captured request exceeds the 5 MiB replay limit."
          : "The captured request could not be serialized for replay.",
      };
    }

    installReplayListener();
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

  function cloneMetadata(metadata) {
    if (!metadata) return undefined;
    return Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
    );
  }

  function snapshotReplayOptions(options) {
    const timeout = options.timeout instanceof Date
      ? Math.max(0, options.timeout.getTime() - Date.now())
      : options.timeout;
    const snapshot = {
      ...options,
      meta: cloneMetadata(options.meta),
      jsonOptions: options.jsonOptions ? { ...options.jsonOptions } : undefined,
      binaryOptions: options.binaryOptions ? { ...options.binaryOptions } : undefined,
      interceptors: options.interceptors ? [...options.interceptors] : undefined,
      timeout,
    };
    delete snapshot.abort;

    return () => ({
      ...snapshot,
      meta: cloneMetadata(snapshot.meta),
      jsonOptions: snapshot.jsonOptions ? { ...snapshot.jsonOptions } : undefined,
      binaryOptions: snapshot.binaryOptions ? { ...snapshot.binaryOptions } : undefined,
      interceptors: snapshot.interceptors ? [...snapshot.interceptors] : undefined,
    });
  }

  function methodPath(baseUrl, method) {
    return `${String(baseUrl || "").replace(/\/+$/, "")}/${method.service.typeName}/${method.name}`;
  }

  function replayProvenance(command, sourceRequestId) {
    return {
      captureId: String(command.captureId || ""),
      transport: TRANSPORT,
      requestId: sourceRequestId,
    };
  }

  function reconstructRequest(method, request, options) {
    return method.I.fromJson(request, options.jsonOptions);
  }

  function captureUnary(context, replayedFrom) {
    const { baseUrl, next, method, input, options } = context;
    const requestId = nextRequestId();
    const requestTimestamp = Date.now();
    const elapsedStart = monotonicNow();
    const requestPayload = serializeMessage(method.I, input, options, true);
    const replayOptions = snapshotReplayOptions(options);
    const replay = registerReplay(requestPayload, (editedRequest, command) => {
      const nextOptions = replayOptions();
      return captureUnary({
        baseUrl,
        next,
        method,
        input: reconstructRequest(method, editedRequest, nextOptions),
        options: nextOptions,
      }, replayProvenance(command, requestId));
    });
    const methodName = methodPath(baseUrl, method);

    postEvent({
      phase: "start",
      method: methodName,
      backendUrl: methodName,
      methodType: "unary",
      requestId,
      request: requestPayload.payload,
      replay,
      replayedFrom,
      meta: extractAllowlistedMetadata(options.meta),
      timing: { requestTimestamp },
    });

    let call;
    let wireMeta;
    try {
      // Discard any stale, never-consumed value from an earlier call before
      // dispatching this one, so this call can't inherit meta it didn't send.
      takeSnoopedMeta();
      call = next(method, input, options);
      // Read immediately, synchronously, with no await in between — see
      // takeSnoopedMeta's caller contract in request-metadata-snoop.js.
      wireMeta = takeSnoopedMeta();
    } catch (error) {
      wireMeta = takeSnoopedMeta();
      const completionTimestamp = Date.now();
      postEvent({
        phase: "error",
        method: methodName,
        methodType: "unary",
        requestId,
        error: serializeError(error),
        replayedFrom,
        meta: wireMeta,
        timing: {
          requestTimestamp,
          completionTimestamp,
          duration: Math.max(0, monotonicNow() - elapsedStart),
          messageCount: 0,
        },
      });
      throw error;
    }

    call.then(
      finishedCall => {
        const completionTimestamp = Date.now();
        postEvent({
          phase: "complete",
          method: methodName,
          methodType: "unary",
          requestId,
          response: serializeMessage(method.O, finishedCall.response, options).payload,
          status: serializeStatus(finishedCall.status),
          replayedFrom,
          meta: wireMeta,
          timing: {
            requestTimestamp,
            completionTimestamp,
            duration: Math.max(0, monotonicNow() - elapsedStart),
            messageCount: 1,
          },
        });
        return finishedCall;
      },
      error => {
        const completionTimestamp = Date.now();
        postEvent({
          phase: "error",
          method: methodName,
          methodType: "unary",
          requestId,
          error: serializeError(error),
          replayedFrom,
          meta: wireMeta,
          timing: {
            requestTimestamp,
            completionTimestamp,
            duration: Math.max(0, monotonicNow() - elapsedStart),
            messageCount: 0,
          },
        });
      }
    );

    return call;
  }

  function captureServerStreaming(context, replayedFrom) {
    const { baseUrl, next, method, input, options } = context;
    const requestId = nextRequestId();
    const requestTimestamp = Date.now();
    const elapsedStart = monotonicNow();
    const requestPayload = serializeMessage(method.I, input, options, true);
    const replayOptions = snapshotReplayOptions(options);
    const replay = registerReplay(requestPayload, (editedRequest, command) => {
      const nextOptions = replayOptions();
      return captureServerStreaming({
        baseUrl,
        next,
        method,
        input: reconstructRequest(method, editedRequest, nextOptions),
        options: nextOptions,
      }, replayProvenance(command, requestId));
    });
    const methodName = methodPath(baseUrl, method);
    let terminal = false;
    let messageCount = 0;
    let firstMessageAt;

    const finish = (phase, value) => {
      if (terminal) return;
      terminal = true;
      const completionTimestamp = Date.now();
      const event = {
        phase,
        method: methodName,
        methodType: "server_streaming",
        requestId,
        replayedFrom,
        timing: {
          requestTimestamp,
          completionTimestamp,
          duration: Math.max(0, monotonicNow() - elapsedStart),
          messageCount,
          timeToFirstMessage: firstMessageAt == null
            ? null
            : Math.max(0, firstMessageAt - elapsedStart),
        },
      };
      if (phase === "complete") event.status = serializeStatus(value);
      else event.error = serializeError(value);
      event.meta = wireMeta;
      postEvent(event);
    };

    postEvent({
      phase: "start",
      method: methodName,
      backendUrl: methodName,
      methodType: "server_streaming",
      requestId,
      request: requestPayload.payload,
      replay,
      replayedFrom,
      meta: extractAllowlistedMetadata(options.meta),
      timing: { requestTimestamp },
    });

    let call;
    let wireMeta;
    try {
      // Discard any stale, never-consumed value from an earlier call before
      // dispatching this one, so this call can't inherit meta it didn't send.
      takeSnoopedMeta();
      call = next(method, input, options);
      // Read immediately, synchronously, with no await in between — see
      // takeSnoopedMeta's caller contract in request-metadata-snoop.js.
      wireMeta = takeSnoopedMeta();
    } catch (error) {
      wireMeta = takeSnoopedMeta();
      finish("error", error);
      throw error;
    }

    let responsesComplete = false;
    let resolvedStatus;
    call.responses.onMessage(message => {
      if (terminal) return;
      messageCount += 1;
      if (firstMessageAt == null) firstMessageAt = monotonicNow();
      postEvent({
        phase: "message",
        method: methodName,
        methodType: "server_streaming",
        requestId,
        response: serializeMessage(method.O, message, options).payload,
        replayedFrom,
        timing: {
          messageCount,
          timeToFirstMessage: Math.max(0, firstMessageAt - elapsedStart),
        },
      });
    });
    call.responses.onError(error => {
      finish("error", error);
    });
    call.responses.onComplete(() => {
      responsesComplete = true;
      if (resolvedStatus) finish("complete", resolvedStatus);
    });
    call.status.then(
      status => {
        resolvedStatus = status;
        if (responsesComplete) finish("complete", status);
      },
      error => {
        finish("error", error);
      }
    );

    return call;
  }

  state.api = Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    interceptUnary: context => captureUnary(context),
    interceptServerStreaming: context => captureServerStreaming(context),
  });
  window[API_NAME] = state.api;
  window.dispatchEvent(new CustomEvent(READY_EVENT));
})();
