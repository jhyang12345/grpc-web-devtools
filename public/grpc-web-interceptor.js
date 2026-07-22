(() => {
  const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
  const TRANSPORT = "grpc-web";
  const INSTRUMENTED = "__grpcWebDevtoolsInstrumented__";

  const nextRequestId = () => {
    const requestId = window.__grpcWebDevtoolsRequestId || 1;
    window.__grpcWebDevtoolsRequestId = requestId + 1;
    return requestId;
  };

  const serialize = (value, method, label) => {
    try {
      return value && typeof value.toObject === "function" ? value.toObject() : value;
    } catch (error) {
      return { __error: `Serialization failed for ${label}: ${error && error.message ? error.message : "unknown error"}` };
    }
  };

  const serializeError = error => ({
    code: error && error.code,
    message: error && error.message ? String(error.message) : String(error || "Unknown RPC error"),
  });

  const post = payload => window.postMessage({
    type: POST_TYPE,
    transport: TRANSPORT,
    ...payload,
  }, "*");

  const timing = (requestTimestamp, extra) => ({
    requestTimestamp,
    ...extra,
  });

  const instrumentClient = client => {
    const target = client && client.client_;
    if (!target || target[INSTRUMENTED]) return;

    const originalUnary = target.rpcCall;
    const originalStreaming = target.serverStreaming;
    if (typeof originalUnary !== "function" || typeof originalStreaming !== "function") return;

    Object.defineProperty(target, INSTRUMENTED, { value: true, configurable: true });

    target.rpcCall = function rpcCall(method, request, metadata, methodInfo, callback) {
      const requestId = nextRequestId();
      const requestTimestamp = Date.now();
      const requestPayload = serialize(request, method, "request");
      let completed = false;

      post({
        phase: "start",
        method,
        methodType: "unary",
        requestId,
        request: requestPayload,
        timing: timing(requestTimestamp),
      });

      const complete = (error, response) => {
        if (completed) return;
        completed = true;
        const completionTimestamp = Date.now();
        const event = {
          phase: error ? "error" : "complete",
          method,
          methodType: "unary",
          requestId,
          timing: timing(requestTimestamp, {
            completionTimestamp,
            duration: completionTimestamp - requestTimestamp,
            messageCount: error ? 0 : 1,
          }),
        };
        if (error) event.error = serializeError(error);
        else event.response = serialize(response, method, "response");
        post(event);
      };

      try {
        return originalUnary.call(this, method, request, metadata, methodInfo, (error, response) => {
          complete(error, response);
          if (typeof callback === "function") callback(error, response);
        });
      } catch (error) {
        complete(error);
        throw error;
      }
    };

    target.serverStreaming = function serverStreaming(method, request, metadata, methodInfo) {
      const requestId = nextRequestId();
      const requestTimestamp = Date.now();
      const requestPayload = serialize(request, method, "request");
      let messageCount = 0;
      let firstMessageTimestamp;
      let terminal = false;

      post({
        phase: "start",
        method,
        methodType: "server_streaming",
        requestId,
        request: requestPayload,
        timing: timing(requestTimestamp),
      });

      const terminalEvent = (phase, value) => {
        if (terminal) return;
        terminal = true;
        const completionTimestamp = Date.now();
        const event = {
          phase,
          method,
          methodType: "server_streaming",
          requestId,
          timing: timing(requestTimestamp, {
            completionTimestamp,
            duration: completionTimestamp - requestTimestamp,
            messageCount,
            timeToFirstMessage: firstMessageTimestamp == null ? null : firstMessageTimestamp - requestTimestamp,
          }),
        };
        if (phase === "error") event.error = serializeError(value);
        else event.status = value && { code: value.code, details: value.details };
        post(event);
      };

      try {
        const stream = originalStreaming.call(this, method, request, metadata, methodInfo);
        stream.on("data", response => {
          messageCount += 1;
          if (firstMessageTimestamp == null) firstMessageTimestamp = Date.now();
          post({
            phase: "message",
            method,
            methodType: "server_streaming",
            requestId,
            response: serialize(response, method, "streaming response"),
            timing: timing(requestTimestamp, {
              messageCount,
              timeToFirstMessage: firstMessageTimestamp - requestTimestamp,
            }),
          });
        });
        stream.on("status", status => terminalEvent(status && status.code === 0 ? "complete" : "error", status));
        stream.on("error", error => terminalEvent("error", error));
        return stream;
      } catch (error) {
        terminalEvent("error", error);
        throw error;
      }
    };
  };

  window.__GRPCWEB_DEVTOOLS__ = clients => {
    if (!Array.isArray(clients)) return;
    clients.forEach(instrumentClient);
  };
})();
