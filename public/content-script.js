// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

(() => {
  const GRPC_EVENT_TYPE = "__GRPCWEB_DEVTOOLS__";
  const PAGE_REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
  const PAGE_REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
  const PAGE_REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";
  const MAX_QUEUE_SIZE = 100;
  const RECONNECT_INITIAL_MS = 250;
  const RECONNECT_MAX_MS = 30000;
  const ACK_TIMEOUT_MS = 5000;
  const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
  const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
  const MAX_PAYLOAD_NODES = 10000;
  const MAX_INSPECTED_CHARACTERS = MAX_PAYLOAD_BYTES * 2;
  const captureId = (() => {
    const bytes = new Uint32Array(2);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return `${bytes[0].toString(36)}${bytes[1].toString(36)}`;
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  })();

  let port = null;
  let acknowledged = false;
  let fallbackRequestId = 1;
  let reconnectDelay = RECONNECT_INITIAL_MS;
  let reconnectTimer = null;
  let ackTimer = null;
  const messageQueue = [];
  let messageQueueBytes = 0;

  const tryStringify = value => {
    try {
      const serialized = JSON.stringify(value);
      return typeof serialized === "string"
        ? { serialized, failed: false }
        : { serialized: '"[unserializable]"', failed: true };
    } catch (_) {
      return { serialized: '"[unserializable]"', failed: true };
    }
  };
  const byteLength = value => new TextEncoder().encode(value).length;
  const inspectPayload = value => {
    const state = { nodes: 0, characters: 0, seen: new WeakSet() };
    const visit = (current, depth) => {
      if (current === null) return true;
      const type = typeof current;
      if (type === "string") {
        state.characters += current.length;
        return state.characters <= MAX_INSPECTED_CHARACTERS;
      }
      if (type === "number" || type === "boolean") return true;
      if (type !== "object" || depth > 50 || state.seen.has(current)) return false;
      if (!Array.isArray(current) && Object.prototype.toString.call(current) !== "[object Object]") return false;
      if (Array.isArray(current) && current.length > MAX_PAYLOAD_NODES) return false;
      state.nodes += 1;
      if (state.nodes > MAX_PAYLOAD_NODES) return false;
      state.seen.add(current);
      let keys = 0;
      for (const key in current) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        keys += 1;
        state.characters += key.length;
        if (keys > MAX_PAYLOAD_NODES || state.characters > MAX_INSPECTED_CHARACTERS || !visit(current[key], depth + 1)) return false;
      }
      return true;
    };
    return visit(value, 0);
  };
  const omittedPayload = (preview, originalSizeBytes = null) => ({
    __truncated: true,
    __originalSizeBytes: originalSizeBytes,
    preview,
  });
  const limitPayload = value => {
    if (value == null) return value;
    if (!inspectPayload(value)) {
      return omittedPayload("[unsupported, cyclic, or oversized payload omitted]");
    }
    const serialization = tryStringify(value);
    if (serialization.failed) return omittedPayload("[unserializable payload omitted]");
    const { serialized } = serialization;
    const originalSizeBytes = byteLength(serialized);
    if (originalSizeBytes <= MAX_PAYLOAD_BYTES) return value;
    return omittedPayload(serialized.slice(0, 2000), originalSizeBytes);
  };
  const shortString = (value, maximum = 512) => typeof value === "string" ? value.slice(0, maximum) : undefined;
  const normalizeTiming = value => {
    if (!value || typeof value !== "object") return {};
    const timing = {};
    ["requestTimestamp", "completionTimestamp", "duration", "messageCount", "timeToFirstMessage"].forEach(field => {
      if (Number.isFinite(value[field])) timing[field] = value[field];
    });
    return timing;
  };
  const normalizeReplay = value => value && typeof value === "object" ? {
    available: value.available === true,
    token: shortString(value.token),
    reason: shortString(value.reason),
  } : undefined;
  const normalizeReplayedFrom = value => value && typeof value === "object" ? {
    captureId: shortString(value.captureId),
    transport: shortString(value.transport),
    requestId: Number.isFinite(value.requestId) ? value.requestId : undefined,
  } : undefined;

  const inject = name => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(name);
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  };
  inject("protobuf-ts-interceptor.js");
  inject("grpc-web-interceptor.js");
  inject("connect-web-interceptor.js");

  function stopReconnectTimer() {
    if (reconnectTimer != null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function stopAckTimer() {
    if (ackTimer != null) clearTimeout(ackTimer);
    ackTimer = null;
  }

  function scheduleReconnect(delay = reconnectDelay) {
    if (reconnectTimer != null || port) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      setupPortIfNeeded();
    }, delay);
    reconnectDelay = Math.min(Math.max(RECONNECT_INITIAL_MS, reconnectDelay * 2), RECONNECT_MAX_MS);
  }

  function markPortBroken(currentPort) {
    if (!currentPort || currentPort !== port) return;
    stopAckTimer();
    port = null;
    acknowledged = false;
    try { currentPort.disconnect(); } catch (_) {}
    scheduleReconnect();
  }

  function armAckTimeout(currentPort) {
    stopAckTimer();
    ackTimer = setTimeout(() => {
      ackTimer = null;
      markPortBroken(currentPort);
    }, ACK_TIMEOUT_MS);
  }

  function markAcknowledged() {
    stopAckTimer();
    stopReconnectTimer();
    acknowledged = true;
    reconnectDelay = RECONNECT_INITIAL_MS;
    flushQueue();
  }

  function flushQueue() {
    while (acknowledged && port && messageQueue.length) {
      const currentPort = port;
      const queued = messageQueue[0];
      try {
        currentPort.postMessage(queued.message);
        messageQueue.shift();
        messageQueueBytes = Math.max(0, messageQueueBytes - queued.bytes);
      } catch (_) {
        markPortBroken(currentPort);
        break;
      }
    }
  }

  function compactQueuedMessage(message) {
    if (!message || !message.data || typeof message.data !== "object") return message;
    const data = { ...message.data };
    ["request", "response", "error", "status"].forEach(field => {
      if (data[field] == null) return;
      const serialization = tryStringify(data[field]);
      data[field] = omittedPayload(
        "[payload omitted while the disconnected inspector queue was full]",
        serialization.failed ? null : byteLength(serialization.serialized),
      );
    });
    return { ...message, data };
  }

  function enqueueMessage(message) {
    let queuedMessage = message;
    let serialization = tryStringify(queuedMessage);
    let queuedBytes = serialization.failed ? Number.POSITIVE_INFINITY : byteLength(serialization.serialized);
    if (serialization.failed || queuedBytes > MAX_QUEUE_BYTES) {
      queuedMessage = compactQueuedMessage(queuedMessage);
      serialization = tryStringify(queuedMessage);
      if (serialization.failed) return;
      queuedBytes = byteLength(serialization.serialized);
    }
    messageQueue.push({ message: queuedMessage, bytes: queuedBytes });
    messageQueueBytes += queuedBytes;
    while (messageQueue.length > MAX_QUEUE_SIZE || messageQueueBytes > MAX_QUEUE_BYTES) {
      const removed = messageQueue.shift();
      messageQueueBytes = Math.max(0, messageQueueBytes - (removed ? removed.bytes : 0));
    }
  }

  function sendPanelMessage(action, data) {
    const message = { action, target: "panel", data };
    setupPortIfNeeded();
    if (port && acknowledged) {
      flushQueue();
      if (port && acknowledged) {
        const currentPort = port;
        try { currentPort.postMessage(message); return; } catch (_) { markPortBroken(currentPort); }
      }
    }
    enqueueMessage(message);
  }

  function cloneReplayResult(data) {
    const shortString = (value, limit = 512) => typeof value === "string" ? value.slice(0, limit) : undefined;
    return {
      captureId,
      replayToken: shortString(data.replayToken),
      replayAttemptId: shortString(data.replayAttemptId),
      sourceEntryId: Number.isFinite(data.sourceEntryId) ? data.sourceEntryId : undefined,
      reason: shortString(data.reason),
      message: shortString(data.message),
    };
  }

  function setupPortIfNeeded() {
    if (port || !chrome || !chrome.runtime) return;
    let nextPort;
    try {
      nextPort = chrome.runtime.connect({ name: "content" });
      port = nextPort;
      acknowledged = false;
      nextPort.onMessage.addListener(message => {
        if (nextPort !== port) return;
        if (message && (message.action === "init_ack" || message.action === "heartbeat_ack")) {
          markAcknowledged();
          return;
        }
        if (
          message && message.action === "replay_request" && message.target === "content" &&
          message.data && message.data.captureId === captureId
        ) {
          try {
            window.postMessage({ ...message.data, type: PAGE_REPLAY_REQUEST_TYPE }, "*");
          } catch (_) {
            sendPanelMessage("replay_rejected", {
              captureId,
              replayToken: typeof message.data.replayToken === "string" ? message.data.replayToken : undefined,
              replayAttemptId: typeof message.data.replayAttemptId === "string" ? message.data.replayAttemptId : undefined,
              sourceEntryId: Number.isFinite(message.data.sourceEntryId) ? message.data.sourceEntryId : undefined,
              reason: "Unable to deliver the replay request to the originating frame.",
            });
          }
        }
      });
      nextPort.onDisconnect.addListener(() => markPortBroken(nextPort));
      nextPort.postMessage({ action: "init", data: { captureId } });
      // A port is not usable until the restarted MV3 worker acknowledges it.
      armAckTimeout(nextPort);
    } catch (_) {
      if (port === nextPort) port = null;
      acknowledged = false;
      stopAckTimer();
      try { if (nextPort) nextPort.disconnect(); } catch (_) {}
      scheduleReconnect();
    }
  }

  function probeConnection() {
    reconnectDelay = RECONNECT_INITIAL_MS;
    stopReconnectTimer();
    if (!port) return scheduleReconnect(0);
    const currentPort = port;
    acknowledged = false;
    try {
      currentPort.postMessage({ action: "heartbeat" });
      armAckTimeout(currentPort);
    } catch (_) {
      markPortBroken(currentPort);
    }
  }

  function sendNetworkCall(data) {
    const source = data && typeof data === "object" ? data : {};
    const event = {
      phase: shortString(source.phase, 32),
      method: shortString(source.method, 2048),
      methodType: shortString(source.methodType, 128),
      transport: shortString(source.transport, 128),
      backendUrl: shortString(source.backendUrl, 4096),
      request: source.request,
      response: source.response,
      error: source.error,
      status: source.status,
      timing: normalizeTiming(source.timing),
      replay: source.replay,
      replayedFrom: source.replayedFrom,
      captureId,
      requestId: Number.isFinite(source.requestId) ? source.requestId : fallbackRequestId++,
      location: shortString(String(window.location.href), 4096),
    };
    ["request", "response", "error", "status"].forEach(field => {
      if (event[field] != null) event[field] = limitPayload(event[field]);
    });
    if (event.replay != null) event.replay = normalizeReplay(event.replay);
    if (event.replayedFrom != null) event.replayedFrom = normalizeReplayedFrom(event.replayedFrom);
    sendPanelMessage("gRPCNetworkCall", event);
  }

  window.addEventListener("message", event => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === GRPC_EVENT_TYPE) {
      sendNetworkCall(event.data);
    } else if (
      (event.data.type === PAGE_REPLAY_ACK_TYPE || event.data.type === PAGE_REPLAY_REJECTED_TYPE) &&
      event.data.captureId === captureId
    ) {
      sendPanelMessage(event.data.type === PAGE_REPLAY_ACK_TYPE ? "replay_ack" : "replay_rejected", cloneReplayResult(event.data));
    }
  }, false);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === "ping") {
      probeConnection();
      sendResponse({ success: !!port, connected: acknowledged, captureId });
    }
  });

  window.addEventListener("pageshow", probeConnection, false);
  window.addEventListener("online", probeConnection, false);
  if (document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") probeConnection();
    }, false);
  }

  setupPortIfNeeded();
})();
