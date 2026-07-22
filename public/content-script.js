// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

(() => {
  const GRPC_EVENT_TYPE = "__GRPCWEB_DEVTOOLS__";
  const MAX_QUEUE_SIZE = 100;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_INTERVAL_MS = 3000;
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
    const message = { action: "gRPCNetworkCall", target: "panel", data: event };
    setupPortIfNeeded();
    if (port && acknowledged) {
      flushQueue();
      try { port.postMessage(message); return; } catch (_) {}
    }
    messageQueue.push(message);
    if (messageQueue.length > MAX_QUEUE_SIZE) messageQueue.shift();
  }

  window.addEventListener("message", event => {
    if (event.source === window && event.data && event.data.type === GRPC_EVENT_TYPE) sendNetworkCall(event.data);
  }, false);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === "ping") {
      setupPortIfNeeded();
      sendResponse({ success: !!port, captureId });
    }
  });

  setupPortIfNeeded();
})();
