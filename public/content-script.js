// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

(() => {
  const GRPC_EVENT_TYPE = "__GRPCWEB_DEVTOOLS__";
  const PAGE_REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
  const PAGE_REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
  const PAGE_REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";
  const MAX_QUEUE_SIZE = 100;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_INTERVAL_MS = 3000;
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
  let reconnectAttempts = 0;
  let reconnectTimer = null;
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

  const inject = name => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(name);
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  };
  inject("grpc-web-interceptor.js");
  inject("connect-web-interceptor.js");

  function stopReconnectTimer() {
    if (reconnectTimer) clearInterval(reconnectTimer);
    reconnectTimer = null;
  }

  function startReconnectTimer() {
    if (reconnectTimer || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    reconnectTimer = setInterval(() => {
      if (acknowledged) return stopReconnectTimer();
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return stopReconnectTimer();
      if (port) {
        try { port.disconnect(); } catch (_) {}
        port = null;
      }
      reconnectAttempts += 1;
      setupPortIfNeeded();
    }, RECONNECT_INTERVAL_MS);
  }

  function flushQueue() {
    while (acknowledged && port && messageQueue.length) {
      try { port.postMessage(messageQueue.shift()); } catch (_) { break; }
    }
  }

  function sendPanelMessage(action, data) {
    const message = { action, target: "panel", data };
    setupPortIfNeeded();
    if (port && acknowledged) {
      flushQueue();
      try { port.postMessage(message); return; } catch (_) {}
    }
    messageQueue.push(message);
    if (messageQueue.length > MAX_QUEUE_SIZE) messageQueue.shift();
  }

  function cloneReplayResult(data) {
    return {
      captureId,
      replayToken: typeof data.replayToken === "string" ? data.replayToken : undefined,
      replayAttemptId: typeof data.replayAttemptId === "string" ? data.replayAttemptId : undefined,
      sourceEntryId: Number.isFinite(data.sourceEntryId) ? data.sourceEntryId : undefined,
      reason: typeof data.reason === "string" ? data.reason : undefined,
      message: typeof data.message === "string" ? data.message : undefined,
    };
  }

  function setupPortIfNeeded() {
    if (port || !chrome || !chrome.runtime) return;
    try {
      port = chrome.runtime.connect({ name: "content" });
      acknowledged = false;
      port.onMessage.addListener(message => {
        if (message && message.action === "init_ack") {
          acknowledged = true;
          reconnectAttempts = 0;
          stopReconnectTimer();
          flushQueue();
          return;
        }
        if (
          message && message.action === "replay_request" && message.target === "content" &&
          message.data && message.data.captureId === captureId
        ) {
          try {
            window.postMessage({ type: PAGE_REPLAY_REQUEST_TYPE, ...message.data }, "*");
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
      port.onDisconnect.addListener(() => {
        port = null;
        acknowledged = false;
        startReconnectTimer();
      });
      port.postMessage({ action: "init", data: { captureId } });
      // A successful connect is not healthy until background acknowledges
      // registration. Keep the bounded retry timer alive for a silent port.
      startReconnectTimer();
    } catch (_) {
      port = null;
      acknowledged = false;
      startReconnectTimer();
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
      setupPortIfNeeded();
      sendResponse({ success: !!port, captureId });
    }
  });

  setupPortIfNeeded();
})();
