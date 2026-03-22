// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

// Inject script for grpc-web
var s = document.createElement('script');
s.src = chrome.runtime.getURL('grpc-web-interceptor.js');
s.onload = function () {
  this.remove();
};
(document.head || document.documentElement).appendChild(s);

// Inject script for connect-web
var cs = document.createElement('script');
cs.src = chrome.runtime.getURL('connect-web-interceptor.js');
cs.onload = function () {
  this.remove();
};
(document.head || document.documentElement).appendChild(cs);

var port;
var fallbackRequestId = 1;
var messageListenerActive = false;
var messageQueue = [];
var reconnectInterval = null;
var reconnectAttempts = 0;
const MAX_QUEUE_SIZE = 100; // Prevent memory issues
const RECONNECT_INTERVAL_MS = 3000; // Try every 3 seconds
const MAX_RECONNECT_ATTEMPTS = 5; // Stop auto-retry after 5 attempts
const GRPC_EVENT_TYPE = "__GRPCWEB_DEVTOOLS__";
const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY__";
const REPLAY_RESULT_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_RESULT__";

function ensureMessageListener() {
  if (!messageListenerActive) {
    window.addEventListener("message", handleMessageEvent, false);
    messageListenerActive = true;
    console.log('[gRPC DevTools] Window message listener activated');
  }
}

function startReconnectTimer() {
  if (reconnectInterval) return; // Already running

  reconnectAttempts = 0;
  console.log('[gRPC DevTools] Starting automatic reconnection attempts...');
  reconnectInterval = setInterval(() => {
    if (!port) {
      reconnectAttempts++;
      console.log('[gRPC DevTools] Auto-reconnect attempt', reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS);

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log('[gRPC DevTools] Max reconnection attempts reached. Use the Reconnect button to retry manually.');
        stopReconnectTimer();
        return;
      }

      setupPortIfNeeded();

      if (port && messageQueue.length > 0) {
        console.log('[gRPC DevTools] Reconnected! Flushing queued messages:', messageQueue.length);
        // Flush will happen on next sendGRPCNetworkCall
      }
    } else {
      // Connected, stop timer
      stopReconnectTimer();
    }
  }, RECONNECT_INTERVAL_MS);
}

function stopReconnectTimer() {
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
    reconnectAttempts = 0;
    console.log('[gRPC DevTools] Stopped reconnection attempts (connected)');
  }
}

function setupPortIfNeeded() {
  if (!port && chrome && chrome.runtime) {
    port = chrome.runtime.connect(null, { name: "content" });
    port.postMessage({ action: "init" });
    port.onMessage.addListener(handlePortMessage);
    console.log('[gRPC DevTools] Port connected');
    stopReconnectTimer(); // Stop auto-reconnect attempts when connected

    port.onDisconnect.addListener(() => {
      console.log('[gRPC DevTools] Port disconnected - will auto-retry connection');
      port = null;
      startReconnectTimer(); // Start auto-reconnect attempts
      // CRITICAL: Do NOT remove window listener - we need it to detect messages
      // and trigger port reconnection when DevTools reopens
    });
  }
}

function sendPanelMessage(action, data) {
  if (!data.requestId) {
    data.requestId = fallbackRequestId++;
  }

  setupPortIfNeeded();

  if (port) {
    // Flush queued messages first
    while (messageQueue.length > 0) {
      const queuedMsg = messageQueue.shift();
      port.postMessage(queuedMsg);
    }

    // Send current message
    port.postMessage({
      action,
      target: "panel",
      data,
    });
  } else {
    // Queue message for later
    const msg = {
      action,
      target: "panel",
      data,
    };

    messageQueue.push(msg);

    // Limit queue size to prevent memory issues
    if (messageQueue.length > MAX_QUEUE_SIZE) {
      const dropped = messageQueue.shift();
      console.warn('[gRPC DevTools] Queue full, dropped oldest message:', dropped.data.method);
    }

    console.log('[gRPC DevTools] Message queued (port disconnected), queue size:', messageQueue.length);
  }
}

function sendGRPCNetworkCall(data) {
  sendPanelMessage("gRPCNetworkCall", data);
}

function sendReplayResult(data) {
  sendPanelMessage("gRPCReplayResult", data);
}

function handleMessageEvent(event) {
  if (event.source != window) return;
  if (event.data.type && event.data.type == GRPC_EVENT_TYPE) {
    sendGRPCNetworkCall(event.data);
    return;
  }

  if (event.data.type && event.data.type == REPLAY_RESULT_TYPE) {
    sendReplayResult(event.data);
  }
}

function handlePortMessage(message) {
  if (!message || message.action !== "replayGrpcCall") {
    return;
  }

  requestReplay(message.data);
}

function requestReplay(data) {
  window.postMessage({
    type: REPLAY_REQUEST_TYPE,
    ...data,
  }, "*");
}

// Listen for reconnection requests from panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    console.log('[gRPC DevTools] Manual reconnect requested from panel');

    // Reset retry counter on manual reconnect
    reconnectAttempts = 0;
    stopReconnectTimer(); // Stop any ongoing auto-retry

    setupPortIfNeeded();

    // Send test message to verify connection
    if (port) {
      port.postMessage({ action: 'pong' });
      sendResponse({ success: true, queued: messageQueue.length });
    } else {
      sendResponse({ success: false, error: 'Failed to establish port' });
      // Start auto-retry again after manual attempt
      startReconnectTimer();
    }
  } else if (request.action === 'replayGrpcCall') {
    if (!request.data || !request.data.requestId) {
      sendResponse({ success: false, error: 'Replay request is missing required fields' });
      return true;
    }

    requestReplay(request.data);
    sendResponse({ success: true });
  }
  return true; // Keep channel open for async response
});

// Ensure message listener is always active
ensureMessageListener();
