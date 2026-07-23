(() => {
  const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
  const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
  const REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
  const REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";
  const TRANSPORT = "connect-web";
  const MAX_REPLAY_HANDLES = 100;
  const REPLAY_TTL_MS = 10 * 60 * 1000;
  const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
  const registry = new Map();
  const now = () => (window.performance && typeof window.performance.now === "function" ? window.performance.now() : Date.now());
  const nextRequestId = () => { const id = window.__grpcWebDevtoolsRequestId || 1; window.__grpcWebDevtoolsRequestId = id + 1; return id; };
  const stringify = value => { try { return JSON.stringify(value); } catch (_) { return ""; } };
  const byteLength = value => typeof TextEncoder !== "undefined" ? new TextEncoder().encode(value).length : unescape(encodeURIComponent(value)).length;
  const isPlainObject = value => !!value && Object.prototype.toString.call(value) === "[object Object]";
  const serialize = (value, label) => { try { return value && typeof value.toJson === "function" ? value.toJson() : value; } catch (error) { return { __error: `Serialization failed for ${label}: ${error && error.message || "unknown error"}` }; } };
  const serializeError = error => ({ code: error && error.code, message: error && error.message ? String(error.message) : String(error || "Unknown RPC error") });
  const post = payload => window.postMessage({ type: POST_TYPE, transport: TRANSPORT, ...payload }, "*");
  const token = () => { const bytes = new Uint32Array(4); if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes); else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 0xffffffff); }); return Array.from(bytes, value => value.toString(36)).join("-"); };
  const prune = () => { const cutoff = now() - REPLAY_TTL_MS; registry.forEach((handle, key) => { if (handle.lastUsed < cutoff) registry.delete(key); }); while (registry.size > MAX_REPLAY_HANDLES) registry.delete(registry.keys().next().value); };
  const register = (request, invoke) => { const json = stringify(request); if (!json || byteLength(json) > MAX_PAYLOAD_BYTES) return { available: false, reason: "The captured request exceeds the 5 MiB replay limit." }; prune(); const key = token(); registry.set(key, { lastUsed: now(), invoke }); prune(); return { available: true, token: key }; };
  const get = key => { prune(); const handle = registry.get(key); if (!handle) return null; registry.delete(key); handle.lastUsed = now(); registry.set(key, handle); return handle; };
  const reconstruct = (original, json) => {
    if (!isPlainObject(json)) throw new Error("Replay request JSON must be an object.");
    const Ctor = original && original.constructor; if (!Ctor) throw new Error("Unable to reconstruct the original Connect request type.");
    if (typeof Ctor.fromJson === "function") return Ctor.fromJson(json);
    if (typeof Ctor.fromJsonString === "function") return Ctor.fromJsonString(JSON.stringify(json));
    try { return new Ctor(json); } catch (_) {}
    const result = new Ctor();
    if (typeof result.fromJson === "function") { result.fromJson(json); return result; }
    if (typeof result.fromJsonString === "function") { result.fromJsonString(JSON.stringify(json)); return result; }
    throw new Error("This Connect request type does not expose a supported JSON constructor.");
  };
  const provenance = (data, requestId) => ({ captureId: data.captureId, transport: TRANSPORT, requestId });
  const readStream = async function* (req, stream, requestId, requestTimestamp, elapsedStart, replayedFrom) {
    let messageCount = 0; let first;
    try { for await (const message of stream) { messageCount += 1; if (first == null) first = now(); post({ phase: "message", method: req.method.name, methodType: "server_streaming", requestId, replayedFrom, response: serialize(message, "streaming response"), timing: { requestTimestamp, messageCount, timeToFirstMessage: Math.max(0, first - elapsedStart) } }); yield message; }
      const completionTimestamp = Date.now(); post({ phase: "complete", method: req.method.name, methodType: "server_streaming", requestId, replayedFrom, timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, now() - elapsedStart), messageCount, timeToFirstMessage: first == null ? null : Math.max(0, first - elapsedStart) } });
    } catch (error) { const completionTimestamp = Date.now(); post({ phase: "error", method: req.method.name, methodType: "server_streaming", requestId, replayedFrom, error: serializeError(error), timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, now() - elapsedStart), messageCount, timeToFirstMessage: first == null ? null : Math.max(0, first - elapsedStart) } }); throw error; }
  };
  const execute = async (next, req, replayedFrom) => {
    const requestId = nextRequestId(); const requestTimestamp = Date.now(); const elapsedStart = now(); const methodType = req.stream ? "server_streaming" : "unary";
    const replay = register(serialize(req.message, "request"), (json, command) => {
      const message = reconstruct(req.message, json); const replayReq = { ...req, message };
      if (req.signal && req.signal.aborted && typeof AbortController === "undefined") throw new Error("The original request signal is already aborted.");
      if (typeof AbortController !== "undefined" && req.signal) replayReq.signal = new AbortController().signal;
      return execute(next, replayReq, provenance(command, requestId)).then(response => {
        if (!response || !response.stream) return response;
        return (async () => { for await (const _ of response.message) {} return response; })();
      });
    });
    post({ phase: "start", method: req.method.name, methodType, requestId, request: serialize(req.message, "request"), replay, replayedFrom, timing: { requestTimestamp } });
    try { const response = await next(req); if (response.stream) return { ...response, message: readStream(req, response.message, requestId, requestTimestamp, elapsedStart, replayedFrom) };
      const completionTimestamp = Date.now(); post({ phase: "complete", method: req.method.name, methodType, requestId, replayedFrom, response: serialize(response.message, "response"), timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, now() - elapsedStart), messageCount: 1 } }); return response;
    } catch (error) { const completionTimestamp = Date.now(); post({ phase: "error", method: req.method.name, methodType, requestId, replayedFrom, error: serializeError(error), timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, now() - elapsedStart), messageCount: 0 } }); throw error; }
  };
  window.__CONNECT_WEB_DEVTOOLS__ = next => req => execute(next, req);
  const reject = (data, reason) => window.postMessage({ type: REPLAY_REJECTED_TYPE, transport: TRANSPORT, captureId: data && data.captureId, replayToken: data && data.replayToken, sourceEntryId: data && data.sourceEntryId, replayAttemptId: data && data.replayAttemptId, reason: String(reason) }, "*");
  const onReplay = event => { const data = event.source === window && event.data; if (!data || data.type !== REPLAY_REQUEST_TYPE || data.transport !== TRANSPORT) return; if (typeof data.replayToken !== "string" || !isPlainObject(data.request) || byteLength(stringify(data.request)) > MAX_PAYLOAD_BYTES) return reject(data, "The replay request is invalid or exceeds 5 MiB."); const handle = get(data.replayToken); if (!handle) return reject(data, "This replay handle has expired or is unavailable."); try { const result = handle.invoke(data.request, data); if (result && typeof result.then === "function") result.catch(() => {}); window.postMessage({ type: REPLAY_ACK_TYPE, transport: TRANSPORT, captureId: data.captureId, replayToken: data.replayToken, sourceEntryId: data.sourceEntryId, replayAttemptId: data.replayAttemptId }, "*"); } catch (error) { reject(data, error && error.message || "Replay could not be started."); } };
  const marker = "__connectWebDevtoolsReplayListener__"; const prior = window[marker]; if (prior) { window.removeEventListener("message", prior.onReplay, false); window.removeEventListener("pagehide", prior.cleanup, false); window.removeEventListener("unload", prior.cleanup, false); } const cleanup = () => registry.clear(); window.addEventListener("message", onReplay, false); window.addEventListener("pagehide", cleanup, false); window.addEventListener("unload", cleanup, false); window[marker] = { onReplay, cleanup };
  window.dispatchEvent(new CustomEvent("connect-web-dev-tools-ready"));
})();
