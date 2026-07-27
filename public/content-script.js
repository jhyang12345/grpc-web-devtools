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

  const safeStringify = value => {
    try { return JSON.stringify(value); } catch (_) { return '"[unserializable]"'; }
  };
  const byteLength = value => new TextEncoder().encode(value).length;
  const limitPayload = value => {
    if (value == null) return value;
    const serialized = safeStringify(value);
    const originalSizeBytes = byteLength(serialized);
    if (originalSizeBytes <= MAX_PAYLOAD_BYTES) return value;
    return { __truncated: true, __originalSizeBytes: originalSizeBytes, preview: serialized.slice(0, 2000) };
  };
  const shortString = value => typeof value === "string" ? value.slice(0, 512) : undefined;
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
      try {
        currentPort.postMessage(messageQueue[0]);
        messageQueue.shift();
      } catch (_) {
        markPortBroken(currentPort);
        break;
      }
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
    messageQueue.push(message);
    if (messageQueue.length > MAX_QUEUE_SIZE) messageQueue.shift();
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
    const event = {
      ...data,
      captureId,
      requestId: data.requestId == null ? fallbackRequestId++ : data.requestId,
      location: String(window.location.href),
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
