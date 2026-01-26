/**
 * Reads the message from the stream and posts it to the window.
 * This is a generator function that will be passed to the response stream.
 */
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_PREVIEW_CHARS = 2000;

function _safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return '"[unserializable]"';
  }
}

function _byteLength(json) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  return json.length;
}

function _truncatePayload(value) {
  if (value == null) return value;
  const json = _safeStringify(value);
  const bytes = _byteLength(json);
  if (bytes <= MAX_PAYLOAD_BYTES) {
    return value;
  }
  return {
    __truncated: true,
    __bytes: bytes,
    __preview: json.slice(0, MAX_PREVIEW_CHARS),
  };
}

async function* readMessage(req, stream) {
  for await (const m of stream) {
    if (m) {
      const resp = m.toJson?.();
      window.postMessage({
        type: "__GRPCWEB_DEVTOOLS__",
        methodType: "server_streaming",
        method: req.method.name,
        request: _truncatePayload(req.message.toJson?.()),
        response: _truncatePayload(resp),
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
  try {
    const resp = await next(req);
    if (!resp.stream) {
      window.postMessage({
        type: "__GRPCWEB_DEVTOOLS__",
        methodType: "unary",
        method: req.method.name,
        request: _truncatePayload(req.message.toJson()),
        response: _truncatePayload(resp.message.toJson()),
      }, "*")
      return resp;
    } else {
      return {
        ...resp,
        message: readMessage(req, resp.message),
      }
    }
  } catch (e) {
    window.postMessage({
      type: "__GRPCWEB_DEVTOOLS__",
      methodType: req.stream ? "server_streaming" : "unary",
      method: req.method.name,
      request: _truncatePayload(req.message.toJson?.()),
      response: undefined,
      error: {
        message: e.message,
        code: e.code,
      }
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
