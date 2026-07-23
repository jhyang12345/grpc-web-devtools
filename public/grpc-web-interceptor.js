(() => {
  const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
  const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
  const REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
  const REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";
  const TRANSPORT = "grpc-web";
  const INSTRUMENTED = "__grpcWebDevtoolsInstrumented__";
  const ACTIVE_UNARY = "__grpcWebDevtoolsActiveUnary__";
  const ACTIVE_REPLAY = "__grpcWebDevtoolsActiveReplay__";
  const MAX_REPLAY_HANDLES = 100;
  const REPLAY_TTL_MS = 10 * 60 * 1000;
  const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
  const registry = new Map();
  const previousEnablement = window.__GRPCWEB_DEVTOOLS__;
  const methodAdapters = previousEnablement && previousEnablement.__methodAdapters instanceof Map ? previousEnablement.__methodAdapters : new Map();
  const now = () => (window.performance && typeof window.performance.now === "function" ? window.performance.now() : Date.now());
  const nextRequestId = () => { const id = window.__grpcWebDevtoolsRequestId || 1; window.__grpcWebDevtoolsRequestId = id + 1; return id; };
  const stringify = value => { try { return JSON.stringify(value); } catch (_) { return ""; } };
  const byteLength = value => typeof TextEncoder !== "undefined" ? new TextEncoder().encode(value).length : unescape(encodeURIComponent(value)).length;
  const isPlainObject = value => !!value && Object.prototype.toString.call(value) === "[object Object]";
  const serialize = (value, label) => { try { return value && typeof value.toObject === "function" ? value.toObject() : value; } catch (error) { return { __error: `Serialization failed for ${label}: ${error && error.message || "unknown error"}` }; } };
  const serializeError = error => ({ code: error && error.code, message: error && error.message ? String(error.message) : String(error || "Unknown RPC error") });
  const post = payload => window.postMessage({ type: POST_TYPE, transport: TRANSPORT, ...payload }, "*");
  const randomToken = () => {
    const bytes = new Uint32Array(4);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes); else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 0xffffffff); });
    return Array.from(bytes, value => value.toString(36)).join("-");
  };
  const prune = () => { const cutoff = now() - REPLAY_TTL_MS; registry.forEach((handle, token) => { if (handle.lastUsed < cutoff) registry.delete(token); }); while (registry.size > MAX_REPLAY_HANDLES) registry.delete(registry.keys().next().value); };
  const registerHandle = (request, invoke) => {
    const json = stringify(request);
    if (!json || byteLength(json) > MAX_PAYLOAD_BYTES) return { available: false, reason: "The captured request exceeds the 5 MiB replay limit." };
    prune();
    const token = randomToken();
    registry.set(token, { lastUsed: now(), invoke });
    prune();
    return { available: true, token };
  };
  const getHandle = token => { prune(); const handle = registry.get(token); if (!handle) return null; registry.delete(token); handle.lastUsed = now(); registry.set(token, handle); return handle; };
  const pascal = name => String(name).replace(/(^|[_\-\s]+)([a-zA-Z0-9])/g, (_, __, char) => char.toUpperCase());
  const getter = (target, field) => { const names = [`get${pascal(field)}`]; if (field.endsWith("List")) names.push(`get${pascal(field.slice(0, -4))}List`); const name = names.find(candidate => typeof target[candidate] === "function"); try { return name ? target[name]() : null; } catch (_) { return null; } };
  const cloneMessage = (Ctor, json, template) => { const result = new Ctor(); Object.keys(json).forEach(field => {
    const value = json[field]; const set = `set${pascal(field)}`; const clear = `clear${pascal(field)}`;
    if (value === null) { if (typeof result[clear] === "function") result[clear](); else if (typeof result[set] === "function") result[set](value); else throw new Error(`Field "${field}" cannot be cleared.`); return; }
    if (Array.isArray(value)) { if (typeof result[set] !== "function") throw new Error(`Repeated field "${field}" cannot be set.`); const sample = getter(template, field); const sampleItem = Array.isArray(sample) ? sample[0] : null; if (value.some(isPlainObject)) { if (!sampleItem || !sampleItem.constructor) throw new Error(`Repeated message field "${field}" requires an existing item to infer its type.`); const add = `add${pascal(field.endsWith("List") ? field.slice(0, -4) : field)}`; if (typeof result[clear] === "function") result[clear](); if (typeof result[add] === "function") value.forEach(item => result[add](isPlainObject(item) ? cloneMessage(sampleItem.constructor, item, sampleItem) : item)); else result[set](value.map(item => isPlainObject(item) ? cloneMessage(sampleItem.constructor, item, sampleItem) : item)); } else result[set](value.slice()); return; }
    if (isPlainObject(value)) { if (typeof result[set] !== "function") throw new Error(`Nested field "${field}" cannot be set.`); const nested = getter(template, field); if (!nested || !nested.constructor) throw new Error(`Nested field "${field}" requires an existing value to infer its type.`); result[set](cloneMessage(nested.constructor, value, nested)); return; }
    if (typeof result[set] !== "function") throw new Error(`Field "${field}" cannot be set.`); result[set](value);
  }); return result; };
  const reconstruct = (method, original, json) => {
    if (!isPlainObject(json)) throw new Error("Replay request JSON must be an object.");
    const adapter = methodAdapters.get(method);
    if (adapter) return typeof adapter.fromJson === "function" ? adapter.fromJson(json, original) : adapter.createRequest(json, original);
    if (!original || typeof original.constructor !== "function") throw new Error("Unable to reconstruct the original gRPC-Web request type.");
    return cloneMessage(original.constructor, json, original);
  };
  const provenance = (data, requestId) => ({ captureId: data.captureId, transport: TRANSPORT, requestId });
  function withReplay(target, value, fn) { target[ACTIVE_REPLAY] = value; try { return fn(); } finally { delete target[ACTIVE_REPLAY]; } }
  const createUnaryCapture = (method, request, replayedFrom, createHandle) => {
    const requestId = nextRequestId(); const requestTimestamp = Date.now(); const elapsedStart = now(); let completed = false;
    const replay = createHandle ? createHandle(requestId) : { available: false, reason: "Replay is unavailable for this request." };
    post({ phase: "start", method, methodType: "unary", requestId, request: serialize(request, "request"), replay, replayedFrom, timing: { requestTimestamp } });
    return { requestId, complete(error, response) { if (completed) return; completed = true; const completionTimestamp = Date.now(); const event = { phase: error ? "error" : "complete", method, methodType: "unary", requestId, replayedFrom, timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, now() - elapsedStart), messageCount: error ? 0 : 1 } }; if (error) event.error = serializeError(error); else event.response = serialize(response, "response"); post(event); } };
  };
  const instrumentClient = client => {
    const target = client && client.client_; if (!target || target[INSTRUMENTED]) return;
    const originalUnary = target.rpcCall; const originalStreaming = target.serverStreaming; const originalUnaryCall = target.unaryCall;
    if (typeof originalUnary !== "function" || typeof originalStreaming !== "function") return;
    Object.defineProperty(target, INSTRUMENTED, { value: true, configurable: true });
    target.rpcCall = function rpcCall(method, request, metadata, methodInfo, callback) {
      const replayContext = this[ACTIVE_REPLAY];
      const capture = this[ACTIVE_UNARY] || createUnaryCapture(method, request, replayContext && replayContext.replayedFrom, requestId => registerHandle(serialize(request, "request"), (json, command) => {
        const next = reconstruct(method, request, json); return withReplay(target, { replayedFrom: provenance(command, requestId) }, () => target.rpcCall(method, next, metadata, methodInfo, () => {}));
      }));
      try { return originalUnary.call(this, method, request, metadata, methodInfo, (error, response) => { capture.complete(error, response); if (typeof callback === "function") callback(error, response); }); } catch (error) { capture.complete(error); throw error; }
    };
    if (typeof originalUnaryCall === "function") target.unaryCall = function unaryCall(method, request) {
      const replayContext = this[ACTIVE_REPLAY];
      const capture = createUnaryCapture(method, request, replayContext && replayContext.replayedFrom, requestId => registerHandle(serialize(request, "request"), (json, command) => {
        const next = reconstruct(method, request, json); const args = Array.from(arguments); args[1] = next; return withReplay(target, { replayedFrom: provenance(command, requestId) }, () => target.unaryCall.apply(target, args));
      }));
      this[ACTIVE_UNARY] = capture; let result; try { result = originalUnaryCall.apply(this, arguments); } catch (error) { capture.complete(error); throw error; } finally { delete this[ACTIVE_UNARY]; }
      if (result && typeof result.then === "function") result.then(response => capture.complete(null, response), error => capture.complete(error)); else capture.complete(null, result); return result;
    };
    target.serverStreaming = function serverStreaming(method, request, metadata, methodInfo) {
      const replayContext = this[ACTIVE_REPLAY]; const requestId = nextRequestId(); const requestTimestamp = Date.now(); const elapsedStart = now(); let messages = 0; let first; let terminal = false;
      const replay = registerHandle(serialize(request, "request"), (json, command) => { const next = reconstruct(method, request, json); const stream = withReplay(target, { replayedFrom: provenance(command, requestId) }, () => target.serverStreaming(method, next, metadata, methodInfo)); if (stream && typeof stream.on === "function") { stream.on("data", () => {}); stream.on("error", () => {}); } return stream; });
      post({ phase: "start", method, methodType: "server_streaming", requestId, request: serialize(request, "request"), replay, replayedFrom: replayContext && replayContext.replayedFrom, timing: { requestTimestamp } });
      const finish = (phase, value) => { if (terminal) return; terminal = true; const completionTimestamp = Date.now(); const event = { phase, method, methodType: "server_streaming", requestId, replayedFrom: replayContext && replayContext.replayedFrom, timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, now() - elapsedStart), messageCount: messages, timeToFirstMessage: first == null ? null : Math.max(0, first - elapsedStart) } }; if (phase === "error") event.error = serializeError(value); else event.status = value && { code: value.code, details: value.details }; post(event); };
      try { const stream = originalStreaming.call(this, method, request, metadata, methodInfo); stream.on("data", response => { messages += 1; if (first == null) first = now(); post({ phase: "message", method, methodType: "server_streaming", requestId, replayedFrom: replayContext && replayContext.replayedFrom, response: serialize(response, "streaming response"), timing: { requestTimestamp, messageCount: messages, timeToFirstMessage: Math.max(0, first - elapsedStart) } }); }); stream.on("status", status => status && status.code !== 0 ? finish("error", { code: status.code, message: status.details || status.message || "gRPC stream failed" }) : finish("complete", status)); stream.on("error", error => finish("error", error)); return stream; } catch (error) { finish("error", error); throw error; }
    };
  };
  const enable = clients => { if (Array.isArray(clients)) clients.forEach(instrumentClient); };
  enable.__methodAdapters = methodAdapters;
  enable.registerMethod = (method, adapter) => { if (typeof method !== "string" || !adapter || (typeof adapter.fromJson !== "function" && typeof adapter.createRequest !== "function")) throw new Error("A replay adapter must provide fromJson or createRequest."); methodAdapters.set(method, adapter); };
  enable.unregisterMethod = method => methodAdapters.delete(method);
  window.__GRPCWEB_DEVTOOLS__ = enable;
  const reject = (data, reason) => window.postMessage({ type: REPLAY_REJECTED_TYPE, transport: TRANSPORT, captureId: data && data.captureId, replayToken: data && data.replayToken, sourceEntryId: data && data.sourceEntryId, replayAttemptId: data && data.replayAttemptId, reason: String(reason) }, "*");
  const onReplay = event => { const data = event.source === window && event.data; if (!data || data.type !== REPLAY_REQUEST_TYPE || data.transport !== TRANSPORT) return; if (typeof data.replayToken !== "string" || !isPlainObject(data.request) || byteLength(stringify(data.request)) > MAX_PAYLOAD_BYTES) return reject(data, "The replay request is invalid or exceeds 5 MiB."); const handle = getHandle(data.replayToken); if (!handle) return reject(data, "This replay handle has expired or is unavailable."); try { const result = handle.invoke(data.request, data); if (result && typeof result.then === "function") result.catch(() => {}); window.postMessage({ type: REPLAY_ACK_TYPE, transport: TRANSPORT, captureId: data.captureId, replayToken: data.replayToken, sourceEntryId: data.sourceEntryId, replayAttemptId: data.replayAttemptId }, "*"); } catch (error) { reject(data, error && error.message || "Replay could not be started."); } };
  const marker = "__grpcWebDevtoolsReplayListener__"; const prior = window[marker]; if (prior) { window.removeEventListener("message", prior.onReplay, false); window.removeEventListener("pagehide", prior.cleanup, false); window.removeEventListener("unload", prior.cleanup, false); } const cleanup = () => registry.clear(); window.addEventListener("message", onReplay, false); window.addEventListener("pagehide", cleanup, false); window.addEventListener("unload", cleanup, false); window[marker] = { onReplay, cleanup };
})();
