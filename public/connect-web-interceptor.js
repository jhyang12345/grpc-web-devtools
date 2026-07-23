(() => {
  const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
  const TRANSPORT = "connect-web";
  const monotonicNow = () => (window.performance && typeof window.performance.now === "function" ? window.performance.now() : Date.now());

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

  const readStream = async function* (req, stream, requestId, requestTimestamp, elapsedStart) {
    let messageCount = 0;
    let firstMessageTimestamp;
    try {
      for await (const message of stream) {
        messageCount += 1;
        if (firstMessageTimestamp == null) firstMessageTimestamp = monotonicNow();
        post({
          phase: "message",
          method: req.method.name,
          methodType: "server_streaming",
          requestId,
          response: serialize(message, "streaming response"),
          timing: timing(requestTimestamp, {
            messageCount,
            timeToFirstMessage: Math.max(0, firstMessageTimestamp - elapsedStart),
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
          duration: Math.max(0, monotonicNow() - elapsedStart),
          messageCount,
          timeToFirstMessage: firstMessageTimestamp == null ? null : Math.max(0, firstMessageTimestamp - elapsedStart),
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
          duration: Math.max(0, monotonicNow() - elapsedStart),
          messageCount,
          timeToFirstMessage: firstMessageTimestamp == null ? null : Math.max(0, firstMessageTimestamp - elapsedStart),
        }),
      });
      throw error;
    }
  };

  const execute = async (next, req) => {
    const requestId = nextRequestId();
    const requestTimestamp = Date.now();
    const elapsedStart = monotonicNow();
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
        return { ...response, message: readStream(req, response.message, requestId, requestTimestamp, elapsedStart) };
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
          duration: Math.max(0, monotonicNow() - elapsedStart),
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
        timing: timing(requestTimestamp, { completionTimestamp, duration: Math.max(0, monotonicNow() - elapsedStart), messageCount: 0 }),
      });
      throw error;
    }
  };

  window.__CONNECT_WEB_DEVTOOLS__ = next => req => execute(next, req);
  window.dispatchEvent(new CustomEvent("connect-web-dev-tools-ready"));
})();
