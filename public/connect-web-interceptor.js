var __grpcWebDevtoolsRequestId = window.__grpcWebDevtoolsRequestId || 1;

/**
 * Reads the message from the stream and posts it to the window.
 * This is a generator function that will be passed to the response stream.
 */
async function* readMessage(req, stream, requestId, startTime) {
  let messageCount = 0;
  let firstMessageTime = null;
  let lastMessageTime = null;

  for await (const m of stream) {
    if (m) {
      const currentTime = performance.now();
      messageCount++;
      if (firstMessageTime === null) {
        firstMessageTime = currentTime;
      }
      lastMessageTime = currentTime;

      // Serialize response with error handling
      let resp;
      try {
        resp = m.toJson?.();
      } catch (err) {
        console.error('[gRPC DevTools] Failed to serialize streaming response for ' + req.method.name + ':', err);
        resp = { __error: 'Serialization failed: ' + err.message };
      }

      // Serialize request with error handling
      let requestObj;
      try {
        requestObj = req.message.toJson?.();
      } catch (err) {
        console.error('[gRPC DevTools] Failed to serialize request for ' + req.method.name + ':', err);
        requestObj = { __error: 'Serialization failed: ' + err.message };
      }

      window.postMessage({
        type: "__GRPCWEB_DEVTOOLS__",
        methodType: "server_streaming",
        method: req.method.name,
        requestId,
        request: requestObj,
        response: resp,
        timing: {
          startTime,
          endTime: currentTime,
          duration: currentTime - startTime,
          firstMessageTime,
          lastMessageTime,
          messageCount,
        },
      }, "*");
    }
    yield m;
  }
}

/**
 * This interceptor will be passed every request and response. We will take that request and response
 * and post a message to the window. This will allow us to access this message in the content script. This
 * is all to make the manifest v3 happy.
 */
const interceptor = (next) => async (req) => {
  const requestId = __grpcWebDevtoolsRequestId++;
  const startTime = performance.now();
  try {
    const resp = await next(req);
    if (!resp.stream) {
      const endTime = performance.now();

      // Serialize request with error handling
      let requestObj;
      try {
        requestObj = req.message.toJson();
      } catch (err) {
        console.error('[gRPC DevTools] Failed to serialize request for ' + req.method.name + ':', err);
        requestObj = { __error: 'Serialization failed: ' + err.message };
      }

      // Serialize response with error handling
      let responseObj;
      try {
        responseObj = resp.message.toJson();
      } catch (err) {
        console.error('[gRPC DevTools] Failed to serialize response for ' + req.method.name + ':', err);
        responseObj = { __error: 'Serialization failed: ' + err.message };
      }

      window.postMessage({
        type: "__GRPCWEB_DEVTOOLS__",
        methodType: "unary",
        method: req.method.name,
        requestId,
        request: requestObj,
        response: responseObj,
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
        },
      }, "*")
      return resp;
    } else {
      return {
        ...resp,
        message: readMessage(req, resp.message, requestId, startTime),
      }
    }
  } catch (e) {
    const endTime = performance.now();

    // Serialize request with error handling even in error path
    let requestObj;
    try {
      requestObj = req.message.toJson?.();
    } catch (err) {
      console.error('[gRPC DevTools] Failed to serialize request in error handler for ' + req.method.name + ':', err);
      requestObj = { __error: 'Serialization failed: ' + err.message };
    }

    window.postMessage({
      type: "__GRPCWEB_DEVTOOLS__",
      methodType: req.stream ? "server_streaming" : "unary",
      method: req.method.name,
      requestId,
      request: requestObj,
      response: undefined,
      error: {
        message: e.message,
        code: e.code,
      },
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
    }, "*")
    throw e;
  }
};

window.__CONNECT_WEB_DEVTOOLS__ = interceptor;

/**
 * Since we are loading inject.js as a script, the order at which it is loaded is not guaranteed.
 * So we will publish a custom event that can be used, to be used to assign the interceptor.
 */
const readyEvent = new CustomEvent("connect-web-dev-tools-ready");
window.dispatchEvent(readyEvent);
