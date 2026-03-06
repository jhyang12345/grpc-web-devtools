var __grpcWebDevtoolsRequestId = window.__grpcWebDevtoolsRequestId || 1;

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
    this._startTime = performance.now();
    this._messageCount = 0;
    this._firstMessageTime = null;
    this._lastMessageTime = null;

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
      const currentTime = performance.now();
      this._messageCount++;
      if (this._firstMessageTime === null) {
        this._firstMessageTime = currentTime;
      }
      this._lastMessageTime = currentTime;

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
        timing: {
          startTime: this._startTime,
          endTime: currentTime,
          duration: currentTime - this._startTime,
          firstMessageTime: this._firstMessageTime,
          lastMessageTime: this._lastMessageTime,
          messageCount: this._messageCount,
        },
      });
      if (!!this._callbacks['data']) {
        this._callbacks['data'](response);
      }
    });
    stream.on('status', status => {
      const endTime = performance.now();
      if (status.code === 0) {
        window.postMessage({
          type: postType,
          method,
          methodType,
          requestId,
          response: "EOF",
          timing: {
            startTime: this._startTime,
            endTime: endTime,
            duration: endTime - this._startTime,
            firstMessageTime: this._firstMessageTime,
            lastMessageTime: this._lastMessageTime,
            messageCount: this._messageCount,
          },
        });
      }
      if (!!this._callbacks['status']) {
        this._callbacks['status'](status);
      }
    });
    stream.on('error', error => {
      const endTime = performance.now();
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
          timing: {
            startTime: this._startTime,
            endTime: endTime,
            duration: endTime - this._startTime,
            firstMessageTime: this._firstMessageTime,
            lastMessageTime: this._lastMessageTime,
            messageCount: this._messageCount,
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
      var startTime = performance.now();
      var newCallback = function (err, response) {
        var endTime = performance.now();
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
            timing: {
              startTime: startTime,
              endTime: endTime,
              duration: endTime - startTime,
            },
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
