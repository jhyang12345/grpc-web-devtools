export const MAX_REPLAY_BYTES = 5 * 1024 * 1024;
export const MAX_PENDING_REPLAYS = 20;
export const REPLAY_TIMEOUT_MS = 5000;
const MAX_ATTEMPT_ID_RETRIES = 8;

function byteLength(value) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

function randomAttemptId() {
  const values = new Uint32Array(3);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) window.crypto.getRandomValues(values);
  else values.forEach((_, index) => { values[index] = Math.floor(Math.random() * 0xffffffff); });
  return Array.from(values, value => value.toString(36)).join("-");
}

export function validateReplayRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return "Request body must be a JSON object.";
  }
  let serialized;
  try {
    serialized = JSON.stringify(request);
  } catch (_) {
    return "Request body could not be serialized.";
  }
  if (byteLength(serialized) > MAX_REPLAY_BYTES) {
    return "Request body exceeds the 5 MiB replay limit.";
  }
  return null;
}

export function validateReplayRoute({ captureId, replayToken, transport }) {
  if (typeof captureId !== "string" || captureId.length === 0 || captureId.length > 256) return "A valid originating frame is required for replay.";
  if (typeof replayToken !== "string" || replayToken.length === 0 || replayToken.length > 512) return "A valid replay handle is required.";
  if (transport !== "grpc-web" && transport !== "connect-web") return "A valid replay transport is required.";
  return null;
}

export function createReplayBridge({ timeoutMs = REPLAY_TIMEOUT_MS, maxPending = MAX_PENDING_REPLAYS, createAttemptId = randomAttemptId } = {}) {
  let port = null;
  const pending = new Map();

  function settle(attemptId, callback, value) {
    const attempt = pending.get(attemptId);
    if (!attempt) return false;
    pending.delete(attemptId);
    clearTimeout(attempt.timer);
    callback(attempt, value);
    return true;
  }

  return {
    configure(nextPort) {
      if (port && nextPort && port !== nextPort) {
        Array.from(pending.keys()).forEach(replayAttemptId => {
          settle(replayAttemptId, (attempt) => attempt.reject(new Error("Replay connection was replaced.")));
        });
      }
      port = nextPort || null;
    },
    send({ captureId, replayToken, sourceEntryId, transport, request }) {
      const validationError = validateReplayRequest(request);
      if (validationError) return Promise.reject(new Error(validationError));
      const routeError = validateReplayRoute({ captureId, replayToken, transport });
      if (routeError) return Promise.reject(new Error(routeError));
      if (!port) return Promise.reject(new Error("Replay connection is unavailable."));
      if (pending.size >= maxPending) return Promise.reject(new Error("Too many replay requests are awaiting acknowledgement."));
      let replayAttemptId;
      for (let attempt = 0; attempt < MAX_ATTEMPT_ID_RETRIES; attempt += 1) {
        const candidate = createAttemptId();
        if (!pending.has(candidate)) {
          replayAttemptId = candidate;
          break;
        }
      }
      if (!replayAttemptId) return Promise.reject(new Error("Unable to allocate a replay attempt ID."));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(replayAttemptId, (attempt) => attempt.reject(new Error("Replay acknowledgement timed out; the originating frame may no longer be available.")));
        }, timeoutMs);
        pending.set(replayAttemptId, { resolve, reject, timer });
        try {
          port.postMessage({
            action: "replay_request",
            target: "content",
            data: { captureId, replayToken, replayAttemptId, sourceEntryId, transport, request },
          });
        } catch (_) {
          settle(replayAttemptId, (attempt) => attempt.reject(new Error("Replay connection is unavailable.")));
        }
      });
    },
    handleMessage(action, data) {
      const replayAttemptId = data?.replayAttemptId;
      if (typeof replayAttemptId !== "string") return false;
      if (action === "replay_ack") return settle(replayAttemptId, (attempt) => attempt.resolve(data));
      if (action === "replay_rejected") {
        return settle(replayAttemptId, (attempt) => attempt.reject(new Error(data?.reason || "Replay was rejected by the originating frame.")));
      }
      return false;
    },
    disconnect(reason = "Replay connection was disconnected.") {
      port = null;
      Array.from(pending.keys()).forEach(replayAttemptId => {
        settle(replayAttemptId, (attempt) => attempt.reject(new Error(reason)));
      });
    },
    pendingCount() {
      return pending.size;
    },
  };
}

const replayBridge = createReplayBridge();

export const configureReplayBridge = (port) => replayBridge.configure(port);
export const sendReplayRequest = (request) => replayBridge.send(request);
export const handleReplayBridgeMessage = (action, data) => replayBridge.handleMessage(action, data);
export const disconnectReplayBridge = (reason) => replayBridge.disconnect(reason);
