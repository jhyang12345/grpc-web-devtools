(() => {
  const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
  const TRANSPORT = "connect-web";

  const nextRequestId = () => {
    const requestId = window.__grpcWebDevtoolsRequestId || 1;
    window.__grpcWebDevtoolsRequestId = requestId + 1;
    return requestId;
  };

  const serialize = (value, label) => {
    try {
      return value && typeof value.toJson === "function" ? value.toJson() : value;
    } catch (error) {
      return { __error: `Serialization failed for ${label}: ${error && error.message ? error.message : "unknown error"}` };
    }
  };

  const serializeError = error => ({
    code: error && error.code,
    message: error && error.message ? String(error.message) : String(error || "Unknown RPC error"),
  });

  const post = payload => window.postMessage({ type: POST_TYPE, transport: TRANSPORT, ...payload }, "*");
  const timing = (requestTimestamp, extra) => ({ requestTimestamp, ...extra });

  const readStream = async function* (req, stream, requestId, requestTimestamp) {
    let messageCount = 0;
    let firstMessageTimestamp;
    try {
      for await (const message of stream) {
        messageCount += 1;
        if (firstMessageTimestamp == null) firstMessageTimestamp = Date.now();
        post({
          phase: "message",
          method: req.method.name,
          methodType: "server_streaming",
          requestId,
          response: serialize(message, "streaming response"),
          timing: timing(requestTimestamp, {
            messageCount,
            timeToFirstMessage: firstMessageTimestamp - requestTimestamp,
          }),
        });
        yield message;
      }
      const completionTimestamp = Date.now();
      post({
        phase: "complete",
        method: req.method.name,
        methodType: "server_streaming",
        requestId,
        timing: timing(requestTimestamp, {
          completionTimestamp,
          duration: completionTimestamp - requestTimestamp,
          messageCount,
          timeToFirstMessage: firstMessageTimestamp == null ? null : firstMessageTimestamp - requestTimestamp,
        }),
      });
    } catch (error) {
      const completionTimestamp = Date.now();
      post({
        phase: "error",
        method: req.method.name,
        methodType: "server_streaming",
        requestId,
        error: serializeError(error),
        timing: timing(requestTimestamp, {
          completionTimestamp,
          duration: completionTimestamp - requestTimestamp,
          messageCount,
          timeToFirstMessage: firstMessageTimestamp == null ? null : firstMessageTimestamp - requestTimestamp,
        }),
      });
      throw error;
    }
  };

  const execute = async (next, req) => {
    const requestId = nextRequestId();
    const requestTimestamp = Date.now();
    const methodType = req.stream ? "server_streaming" : "unary";
    post({
      phase: "start",
      method: req.method.name,
      methodType,
      requestId,
      request: serialize(req.message, "request"),
      timing: timing(requestTimestamp),
    });

    try {
      const response = await next(req);
      if (response.stream) {
        return { ...response, message: readStream(req, response.message, requestId, requestTimestamp) };
      }
      const completionTimestamp = Date.now();
      post({
        phase: "complete",
        method: req.method.name,
        methodType,
        requestId,
        response: serialize(response.message, "response"),
        timing: timing(requestTimestamp, {
          completionTimestamp,
          duration: completionTimestamp - requestTimestamp,
          messageCount: 1,
        }),
      });
      return response;
    } catch (error) {
      const completionTimestamp = Date.now();
      post({
        phase: "error",
        method: req.method.name,
        methodType,
        requestId,
        error: serializeError(error),
        timing: timing(requestTimestamp, { completionTimestamp, duration: completionTimestamp - requestTimestamp, messageCount: 0 }),
      });
      throw error;
    }
  };

  window.__CONNECT_WEB_DEVTOOLS__ = next => req => execute(next, req);
  window.dispatchEvent(new CustomEvent("connect-web-dev-tools-ready"));
})();
