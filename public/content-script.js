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

function ensureMessageListener() {
  if (!messageListenerActive) {
    window.addEventListener("message", handleMessageEvent, false);
    messageListenerActive = true;
    console.log('[gRPC DevTools] Window message listener activated');
  }
}

function setupPortIfNeeded() {
  if (!port && chrome && chrome.runtime) {
    port = chrome.runtime.connect(null, { name: "content" });
    port.postMessage({ action: "init" });
    console.log('[gRPC DevTools] Port connected');
    port.onDisconnect.addListener(() => {
      console.log('[gRPC DevTools] Port disconnected - will reconnect on next message');
      port = null;
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
    port.postMessage({
      action: "gRPCNetworkCall",
      target: "panel",
      data,
    });
  } else {
    console.warn('[gRPC DevTools] Port not available - message queued for reconnection');
  }
}

function handleMessageEvent(event) {
  if (event.source != window) return;
  if (event.data.type && event.data.type == "__GRPCWEB_DEVTOOLS__") {
    sendGRPCNetworkCall(event.data);
  }
}

// Ensure message listener is always active
ensureMessageListener();
