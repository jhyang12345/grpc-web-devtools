var __grpcWebDevtoolsRequestId = window.__grpcWebDevtoolsRequestId || 1;
var __connectWebDevtoolsReplayRegistry = window.__GRPCWEB_DEVTOOLS_CONNECT_REPLAYS__ || {};
var __connectWebDevtoolsReplayOrder = window.__GRPCWEB_DEVTOOLS_CONNECT_REPLAY_ORDER__ || [];
const MAX_REPLAY_ENTRIES = 1000;
const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY__";
const REPLAY_RESULT_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_RESULT__";
const TRANSPORT = "connect-web";

window.__GRPCWEB_DEVTOOLS_CONNECT_REPLAYS__ = __connectWebDevtoolsReplayRegistry;
window.__GRPCWEB_DEVTOOLS_CONNECT_REPLAY_ORDER__ = __connectWebDevtoolsReplayOrder;

function registerReplay(requestId, replayFn) {
  __connectWebDevtoolsReplayRegistry[requestId] = replayFn;
  __connectWebDevtoolsReplayOrder.push(requestId);

  while (__connectWebDevtoolsReplayOrder.length > MAX_REPLAY_ENTRIES) {
    const oldestRequestId = __connectWebDevtoolsReplayOrder.shift();
    delete __connectWebDevtoolsReplayRegistry[oldestRequestId];
  }
}

function postConnectEvent(payload) {
  window.postMessage({
    type: POST_TYPE,
    transport: TRANSPORT,
    ...payload,
  }, "*");
}

function postReplayResult(requestId, ok, message) {
  window.postMessage({
    type: REPLAY_RESULT_TYPE,
    transport: TRANSPORT,
    requestId,
    ok,
    message,
  }, "*");
}

function serializeConnectMessage(message, methodName, label) {
  try {
    return message.toJson?.();
  } catch (err) {
    console.error('[gRPC DevTools] Failed to serialize ' + label + ' for ' + methodName + ':', err);
    return { __error: 'Serialization failed: ' + err.message };
  }
}

function buildConnectRequestMessage(originalMessage, requestData) {
  const ctor = originalMessage && originalMessage.constructor;
  if (!ctor) {
    throw new Error("Unable to reconstruct the original Connect request type.");
  }

  if (typeof ctor.fromJson === "function") {
    return ctor.fromJson(requestData);
  }

  if (typeof ctor.fromJsonString === "function") {
    return ctor.fromJsonString(JSON.stringify(requestData));
  }

  try {
    return new ctor(requestData);
  } catch (error) {
    // Fall through to instance-based APIs below.
  }

  const message = new ctor();
  if (typeof message.fromJson === "function") {
    message.fromJson(requestData);
    return message;
  }

  if (typeof message.fromJsonString === "function") {
    message.fromJsonString(JSON.stringify(requestData));
    return message;
  }

  throw new Error("This Connect request type does not expose a supported JSON constructor.");
}

function handleReplayMessage(event) {
  if (event.source !== window) {
    return;
  }

  const data = event.data;
  if (!data || data.type !== REPLAY_REQUEST_TYPE) {
    return;
  }

  if (data.transport && data.transport !== TRANSPORT) {
    return;
  }

  const replayFn = __connectWebDevtoolsReplayRegistry[data.requestId];
  if (!replayFn) {
    postReplayResult(data.requestId, false, "Replay is no longer available for this call.");
    return;
  }

  Promise.resolve()
    .then(() => replayFn(data.request))
    .then(() => postReplayResult(data.requestId, true, "Replay started."))
    .catch(error => {
      const message = error && error.message ? error.message : "Replay failed.";
      postReplayResult(data.requestId, false, message);
    });
}

window.addEventListener("message", handleReplayMessage, false);

/**
 * Reads the message from the stream and posts it to the window.
 * This is a generator function that will be passed to the response stream.
 */
async function* readMessage(req, stream, requestId, startTime, requestTimestamp, replayedFromRequestId) {
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
      const resp = serializeConnectMessage(m, req.method.name, "streaming response");
      const requestObj = serializeConnectMessage(req.message, req.method.name, "request");

      postConnectEvent({
        methodType: "server_streaming",
        method: req.method.name,
        requestId,
        request: requestObj,
        response: resp,
        canReplay: true,
        replayedFromRequestId,
        timing: {
          startTime,
          endTime: currentTime,
          duration: currentTime - startTime,
          requestTimestamp,
          endTimestamp: Date.now(),
          firstMessageTime,
          lastMessageTime,
          messageCount,
        },
      });
    }
    yield m;
  }
}

async function executeConnectRequest(next, req, requestMessage, replayedFromRequestId) {
  const requestId = __grpcWebDevtoolsRequestId++;
  const startTime = performance.now();
  const requestTimestamp = Date.now();
  const replayableRequest = {
    ...req,
    message: requestMessage,
  };

  registerReplay(requestId, (editedRequest) => (
    executeConnectRequest(next, req, buildConnectRequestMessage(requestMessage, editedRequest), requestId)
  ));

  try {
    const resp = await next(replayableRequest);
    if (!resp.stream) {
      const endTime = performance.now();
      const requestObj = serializeConnectMessage(requestMessage, req.method.name, "request");
      const responseObj = serializeConnectMessage(resp.message, req.method.name, "response");

      postConnectEvent({
        methodType: "unary",
        method: req.method.name,
        requestId,
        request: requestObj,
        response: responseObj,
        canReplay: true,
        replayedFromRequestId,
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
          requestTimestamp,
          endTimestamp: Date.now(),
        },
      });
      return resp;
    }

    return {
      ...resp,
      message: readMessage(replayableRequest, resp.message, requestId, startTime, requestTimestamp, replayedFromRequestId),
    };
  } catch (e) {
    const endTime = performance.now();
    const requestObj = serializeConnectMessage(requestMessage, req.method.name, "request");

    postConnectEvent({
      methodType: req.stream ? "server_streaming" : "unary",
      method: req.method.name,
      requestId,
      request: requestObj,
      response: undefined,
      error: {
        message: e.message,
        code: e.code,
      },
      canReplay: true,
      replayedFromRequestId,
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
          requestTimestamp,
          endTimestamp: Date.now(),
        },
      });
    throw e;
  }
}

/**
 * This interceptor will be passed every request and response. We will take that request and response
 * and post a message to the window. This will allow us to access this message in the content script. This
 * is all to make the manifest v3 happy.
 */
const interceptor = (next) => async (req) => executeConnectRequest(next, req, req.message);

window.__CONNECT_WEB_DEVTOOLS__ = interceptor;

/**
 * Since we are loading inject.js as a script, the order at which it is loaded is not guaranteed.
 * So we will publish a custom event that can be used, to be used to assign the interceptor.
 */
const readyEvent = new CustomEvent("connect-web-dev-tools-ready");
window.dispatchEvent(readyEvent);
