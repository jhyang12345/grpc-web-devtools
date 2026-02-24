// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

const injectContent = `
let __grpcWebDevtoolsRequestId = 1;

window.__GRPCWEB_DEVTOOLS__ = function (clients) {
  if (clients.constructor !== Array) {
    return
  }
  const postType = "__GRPCWEB_DEVTOOLS__";
  var StreamInterceptor = function (method, request, stream) {
    this._callbacks = {};
    const methodType = "server_streaming";
    const requestId = __grpcWebDevtoolsRequestId++;
    this._requestId = requestId;

    // Serialize request with error handling
    let requestObj;
    try {
      requestObj = request.toObject();
    } catch (err) {
      console.error('[gRPC DevTools] Failed to serialize request for ' + method + ':', err);
      requestObj = { __error: 'Serialization failed: ' + err.message };
    }

    window.postMessage({
      type: postType,
      method,
      methodType,
      requestId,
      request: requestObj,
    });
    stream.on('data', response => {
      // Serialize response with error handling
      let responseObj;
      try {
        responseObj = response.toObject();
      } catch (err) {
        console.error('[gRPC DevTools] Failed to serialize response for ' + method + ':', err);
        responseObj = { __error: 'Serialization failed: ' + err.message };
      }

      window.postMessage({
        type: postType,
        method,
        methodType,
        requestId,
        response: responseObj,
      });
      if (!!this._callbacks['data']) {
        this._callbacks['data'](response);
      }
    });
    stream.on('status', status => {
      if (status.code === 0) {
        window.postMessage({
          type: postType,
          method,
          methodType,
          requestId,
          response: "EOF",
        });
      }
      if (!!this._callbacks['status']) {
        this._callbacks['status'](status);
      }
    });
    stream.on('error', error => {
      if (error.code !== 0) {
        window.postMessage({
          type: postType,
          method,
          methodType,
          requestId,
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }
      if (!!this._callbacks['error']) {
        this._callbacks['error'](error);
      }
    });
    this._stream = stream;
  }
  StreamInterceptor.prototype.on = function (type, callback) {
    this._callbacks[type] = callback;
    return this;
  }
  StreamInterceptor.prototype.cancel = function () {
    this._stream.cancel()
  }
  clients.map(client => {
    client.client_.rpcCall_ = client.client_.rpcCall;
    client.client_.rpcCall2 = function (method, request, metadata, methodInfo, callback) {
      var posted = false;
      var requestId = __grpcWebDevtoolsRequestId++;
      var newCallback = function (err, response) {
        if (!posted) {
          // Serialize request and response with error handling
          let requestObj;
          try {
            requestObj = request.toObject();
          } catch (reqErr) {
            console.error('[gRPC DevTools] Failed to serialize request for ' + method + ':', reqErr);
            requestObj = { __error: 'Serialization failed: ' + reqErr.message };
          }

          let responseObj;
          if (!err && response) {
            try {
              responseObj = response.toObject();
            } catch (respErr) {
              console.error('[gRPC DevTools] Failed to serialize response for ' + method + ':', respErr);
              responseObj = { __error: 'Serialization failed: ' + respErr.message };
            }
          }

          window.postMessage({
            type: postType,
            method,
            methodType: "unary",
            requestId,
            request: requestObj,
            response: err ? undefined : responseObj,
            error: err || undefined,
          }, "*")
          posted = true;
        }
        callback(err, response)
      }
      return this.rpcCall_(method, request, metadata, methodInfo, newCallback);
    }
    client.client_.rpcCall = client.client_.rpcCall2;
    client.client_.unaryCall = function (method, request, metadata, methodInfo) {
      return new Promise((resolve, reject) => {
        this.rpcCall2(method, request, metadata, methodInfo, function (error, response) {
          error ? reject(error) : resolve(response);
        });
      });
    };
    client.client_.serverStreaming_ = client.client_.serverStreaming;
    client.client_.serverStreaming2 = function (method, request, metadata, methodInfo) {
      var stream = client.client_.serverStreaming_(method, request, metadata, methodInfo);
      var si = new StreamInterceptor(method, request, stream);
      return si;
    }
    client.client_.serverStreaming = client.client_.serverStreaming2;
  })
}
`
// Inject script for grpc-web
let s = document.createElement('script');
s.type = 'text/javascript';
const scriptNode = document.createTextNode(injectContent);
s.appendChild(scriptNode);
(document.head || document.documentElement).appendChild(s);
s.parentNode.removeChild(s);

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
const MAX_QUEUE_SIZE = 100; // Prevent memory issues
const RECONNECT_INTERVAL_MS = 3000; // Try every 3 seconds

function ensureMessageListener() {
  if (!messageListenerActive) {
    window.addEventListener("message", handleMessageEvent, false);
    messageListenerActive = true;
    console.log('[gRPC DevTools] Window message listener activated');
  }
}

function startReconnectTimer() {
  if (reconnectInterval) return; // Already running

  console.log('[gRPC DevTools] Starting automatic reconnection attempts...');
  reconnectInterval = setInterval(() => {
    if (!port) {
      console.log('[gRPC DevTools] Auto-reconnect attempt...');
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
    console.log('[gRPC DevTools] Stopped reconnection attempts (connected)');
  }
}

function setupPortIfNeeded() {
  if (!port && chrome && chrome.runtime) {
    port = chrome.runtime.connect(null, { name: "content" });
    port.postMessage({ action: "init" });
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

function sendGRPCNetworkCall(data) {
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
      action: "gRPCNetworkCall",
      target: "panel",
      data,
    });
  } else {
    // Queue message for later
    const msg = {
      action: "gRPCNetworkCall",
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

function handleMessageEvent(event) {
  if (event.source != window) return;
  if (event.data.type && event.data.type == "__GRPCWEB_DEVTOOLS__") {
    sendGRPCNetworkCall(event.data);
  }
}

// Listen for reconnection requests from panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    console.log('[gRPC DevTools] Ping received, attempting reconnection...');
    setupPortIfNeeded();

    // Send test message to verify connection
    if (port) {
      port.postMessage({ action: 'pong' });
      sendResponse({ success: true, queued: messageQueue.length });
    } else {
      sendResponse({ success: false, error: 'Failed to establish port' });
    }
  }
  return true; // Keep channel open for async response
});

// Ensure message listener is always active
ensureMessageListener();
