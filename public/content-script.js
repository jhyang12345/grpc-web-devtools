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
    const startedAt = Date.now();
    this._requestId = requestId;
    this._startedAt = startedAt;
    window.postMessage({
      type: postType,
      method,
      methodType,
      requestId,
      startedAt,
      request: request.toObject(),
    });
    stream.on('data', response => {
      const responseAt = Date.now();
      window.postMessage({
        type: postType,
        method,
        methodType,
        requestId,
        startedAt,
        responseAt,
        durationMs: responseAt - startedAt,
        response: response.toObject(),
      });
      if (!!this._callbacks['data']) {
        this._callbacks['data'](response);
      }
    });
    stream.on('status', status => {
      if (status.code === 0) {
        const responseAt = Date.now();
        window.postMessage({
          type: postType,
          method,
          methodType,
          requestId,
          startedAt,
          responseAt,
          durationMs: responseAt - startedAt,
          response: "EOF",
        });
      }
      if (!!this._callbacks['status']) {
        this._callbacks['status'](status);
      }
    });
    stream.on('error', error => {
      if (error.code !== 0) {
        const responseAt = Date.now();
        window.postMessage({
          type: postType,
          method,
          methodType,
          requestId,
          startedAt,
          responseAt,
          durationMs: responseAt - startedAt,
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
      var startedAt = Date.now();
      var requestId = __grpcWebDevtoolsRequestId++;
      var newCallback = function (err, response) {
        if (!posted) {
          var responseAt = Date.now();
          window.postMessage({
            type: postType,
            method,
            methodType: "unary",
            requestId,
            startedAt,
            responseAt,
            durationMs: responseAt - startedAt,
            request: request.toObject(),
            response: err ? undefined : response.toObject(),
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
var requestStartTimes = new Map();

function setupPortIfNeeded() {
  if (!port && chrome && chrome.runtime) {
    port = chrome.runtime.connect(null, { name: "content" });
    port.postMessage({ action: "init" });
    port.onDisconnect.addListener(() => {
      port = null;
      window.removeEventListener("message", handleMessageEvent, false);
    });
  }
}

function sendGRPCNetworkCall(data) {
  if (!data.requestId) {
    data.requestId = fallbackRequestId++;
  }
  if (data.startedAt) {
    requestStartTimes.set(data.requestId, data.startedAt);
  } else {
    const knownStart = requestStartTimes.get(data.requestId);
    if (knownStart) {
      data.startedAt = knownStart;
    } else if (data.request && !data.response && !data.error) {
      data.startedAt = Date.now();
      requestStartTimes.set(data.requestId, data.startedAt);
    }
  }
  if ((data.response || data.error) && !data.responseAt) {
    data.responseAt = Date.now();
  }
  if (data.startedAt && data.responseAt && !data.durationMs) {
    data.durationMs = data.responseAt - data.startedAt;
  }
  setupPortIfNeeded();
  if (port) {
    port.postMessage({
      action: "gRPCNetworkCall",
      target: "panel",
      data,
    });
  }
}

function handleMessageEvent(event) {
  if (event.source != window) return;
  if (event.data.type && event.data.type == "__GRPCWEB_DEVTOOLS__") {
    sendGRPCNetworkCall(event.data);
  }
}

window.addEventListener("message", handleMessageEvent, false);
