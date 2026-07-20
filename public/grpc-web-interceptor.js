var __grpcWebDevtoolsRequestId = window.__grpcWebDevtoolsRequestId || 1;
var __grpcWebDevtoolsReplayRegistry = window.__GRPCWEB_DEVTOOLS_GRPC_REPLAYS__ || {};
var __grpcWebDevtoolsReplayOrder = window.__GRPCWEB_DEVTOOLS_GRPC_REPLAY_ORDER__ || [];
const MAX_REPLAY_ENTRIES = 1000;
const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY__";
const REPLAY_RESULT_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_RESULT__";
const TRANSPORT = "grpc-web";

window.__GRPCWEB_DEVTOOLS_GRPC_REPLAYS__ = __grpcWebDevtoolsReplayRegistry;
window.__GRPCWEB_DEVTOOLS_GRPC_REPLAY_ORDER__ = __grpcWebDevtoolsReplayOrder;

function isPlainObject(value) {
  return !!value && Object.prototype.toString.call(value) === "[object Object]";
}

function toPascalCase(value) {
  return String(value)
    .replace(/(^|[_\-\s]+)([a-zA-Z0-9])/g, (_, __, char) => char.toUpperCase());
}

function getSetterName(target, fieldName) {
  const pascalName = toPascalCase(fieldName);
  const candidates = [`set${pascalName}`];

  if (fieldName.endsWith("List")) {
    candidates.push(`set${toPascalCase(fieldName.slice(0, -4))}List`);
  }

  return candidates.find(name => typeof target[name] === "function") || null;
}

function getClearerName(target, fieldName) {
  const pascalName = toPascalCase(fieldName);
  const candidates = [`clear${pascalName}`];

  if (fieldName.endsWith("List")) {
    candidates.push(`clear${toPascalCase(fieldName.slice(0, -4))}List`);
  }

  return candidates.find(name => typeof target[name] === "function") || null;
}

function getGetterCandidates(fieldName) {
  const pascalName = toPascalCase(fieldName);
  const candidates = [`get${pascalName}`];

  if (fieldName.endsWith("List")) {
    candidates.push(`get${toPascalCase(fieldName.slice(0, -4))}List`);
  }

  return candidates;
}

function getGetterValue(target, fieldName) {
  if (!target) {
    return null;
  }

  const getterName = getGetterCandidates(fieldName).find(name => typeof target[name] === "function");
  if (!getterName) {
    return null;
  }

  try {
    return target[getterName]();
  } catch (error) {
    return null;
  }
}

function getAdderName(target, fieldName) {
  const baseName = fieldName.endsWith("List") ? fieldName.slice(0, -4) : fieldName;
  const adderName = `add${toPascalCase(baseName)}`;
  return typeof target[adderName] === "function" ? adderName : null;
}

function cloneGrpcWebMessage(messageCtor, value, template) {
  const message = new messageCtor();
  populateGrpcWebMessage(message, value, template);
  return message;
}

function populateGrpcWebMessage(target, source, template) {
  if (!isPlainObject(source)) {
    throw new Error("Request JSON must be an object.");
  }

  Object.keys(source).forEach(fieldName => {
    const value = source[fieldName];
    const setterName = getSetterName(target, fieldName);
    const clearerName = getClearerName(target, fieldName);

    if (value === null) {
      if (clearerName) {
        target[clearerName]();
        return;
      }
      if (setterName) {
        target[setterName](value);
        return;
      }
      throw new Error(`Field "${fieldName}" cannot be cleared on this request type.`);
    }

    if (Array.isArray(value)) {
      applyGrpcWebArrayField(target, template, fieldName, value, setterName);
      return;
    }

    if (isPlainObject(value)) {
      applyGrpcWebObjectField(target, template, fieldName, value, setterName);
      return;
    }

    if (!setterName) {
      throw new Error(`Field "${fieldName}" cannot be set on this request type.`);
    }

    target[setterName](value);
  });
}

function applyGrpcWebArrayField(target, template, fieldName, value, setterName) {
  if (!setterName) {
    throw new Error(`Repeated field "${fieldName}" cannot be set on this request type.`);
  }

  const containsObjects = value.some(item => isPlainObject(item));
  if (!containsObjects) {
    target[setterName](value.slice());
    return;
  }

  const templateList = getGetterValue(template, fieldName);
  const templateItem = Array.isArray(templateList) && templateList.length > 0 ? templateList[0] : null;
  const itemCtor = templateItem && templateItem.constructor;

  if (!itemCtor) {
    throw new Error(`Repeated message field "${fieldName}" requires an existing item to infer its protobuf type.`);
  }

  const adderName = getAdderName(target, fieldName);
  const clearerName = getClearerName(target, fieldName);

  if (clearerName) {
    target[clearerName]();
  }

  if (adderName) {
    value.forEach(item => {
      if (isPlainObject(item)) {
        target[adderName](cloneGrpcWebMessage(itemCtor, item, templateItem));
      } else {
        target[adderName](item);
      }
    });
    return;
  }

  target[setterName](value.map(item => (
    isPlainObject(item) ? cloneGrpcWebMessage(itemCtor, item, templateItem) : item
  )));
}

function applyGrpcWebObjectField(target, template, fieldName, value, setterName) {
  if (!setterName) {
    throw new Error(`Nested field "${fieldName}" cannot be set on this request type.`);
  }

  const templateValue = getGetterValue(template, fieldName);
  const nestedCtor = templateValue && templateValue.constructor;

  if (!nestedCtor) {
    throw new Error(`Nested field "${fieldName}" requires an existing value to infer its protobuf type.`);
  }

  target[setterName](cloneGrpcWebMessage(nestedCtor, value, templateValue));
}

function buildGrpcWebRequest(method, originalRequest, requestData) {
  const serviceRegistry = window.__GRPCWEB_DEVTOOLS__ && window.__GRPCWEB_DEVTOOLS__.services;
  const serviceDefinition = serviceRegistry && serviceRegistry[method];

  if (serviceDefinition) {
    if (typeof serviceDefinition.createRequest === "function") {
      return serviceDefinition.createRequest(requestData, originalRequest);
    }

    if (typeof serviceDefinition.requestFromObject === "function") {
      return serviceDefinition.requestFromObject(requestData, originalRequest);
    }

    if (typeof serviceDefinition.requestType === "function") {
      return cloneGrpcWebMessage(serviceDefinition.requestType, requestData, originalRequest);
    }
  }

  if (!originalRequest || typeof originalRequest.constructor !== "function") {
    throw new Error("Unable to reconstruct the original gRPC-Web request type.");
  }

  return cloneGrpcWebMessage(originalRequest.constructor, requestData, originalRequest);
}

function registerReplay(requestId, replayFn) {
  __grpcWebDevtoolsReplayRegistry[requestId] = replayFn;
  __grpcWebDevtoolsReplayOrder.push(requestId);

  while (__grpcWebDevtoolsReplayOrder.length > MAX_REPLAY_ENTRIES) {
    const oldestRequestId = __grpcWebDevtoolsReplayOrder.shift();
    delete __grpcWebDevtoolsReplayRegistry[oldestRequestId];
  }
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

function postGrpcEvent(payload) {
  window.postMessage({
    type: POST_TYPE,
    transport: TRANSPORT,
    ...payload,
  }, "*");
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

  const replayFn = __grpcWebDevtoolsReplayRegistry[data.requestId];
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

window.__GRPCWEB_DEVTOOLS__ = function (clients) {
  if (clients.constructor !== Array) {
    return
  }
  var StreamInterceptor = function (method, request, stream, requestId, replayedFromRequestId) {
    this._callbacks = {};
    const methodType = "server_streaming";
    this._requestId = requestId;
    this._requestTimestamp = Date.now();
    this._messageCount = 0;

    // Serialize request with error handling
    let requestObj;
    try {
      requestObj = request.toObject();
    } catch (err) {
      console.error('[gRPC DevTools] Failed to serialize request for ' + method + ':', err);
      requestObj = { __error: 'Serialization failed: ' + err.message };
    }

    postGrpcEvent({
      method,
      methodType,
      requestId,
      request: requestObj,
      canReplay: true,
      replayedFromRequestId,
      timing: {
        requestTimestamp: this._requestTimestamp,
      },
    });
    stream.on('data', response => {
      this._messageCount++;

      // Serialize response with error handling
      let responseObj;
      try {
        responseObj = response.toObject();
      } catch (err) {
        console.error('[gRPC DevTools] Failed to serialize response for ' + method + ':', err);
        responseObj = { __error: 'Serialization failed: ' + err.message };
      }

      postGrpcEvent({
        method,
        methodType,
        requestId,
        response: responseObj,
        canReplay: true,
        replayedFromRequestId,
        timing: {
          requestTimestamp: this._requestTimestamp,
          messageCount: this._messageCount,
        },
      });
      if (!!this._callbacks['data']) {
        this._callbacks['data'](response);
      }
    });
    stream.on('status', status => {
      if (status.code === 0) {
        postGrpcEvent({
          method,
          methodType,
          requestId,
          response: "EOF",
          canReplay: true,
          replayedFromRequestId,
          timing: {
            requestTimestamp: this._requestTimestamp,
            messageCount: this._messageCount,
          },
        });
      }
      if (!!this._callbacks['status']) {
        this._callbacks['status'](status);
      }
    });
    stream.on('error', error => {
      if (error.code !== 0) {
        postGrpcEvent({
          method,
          methodType,
          requestId,
          error: {
            code: error.code,
            message: error.message,
          },
          canReplay: true,
          replayedFromRequestId,
          timing: {
            requestTimestamp: this._requestTimestamp,
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
  function executeUnaryCall(clientInstance, method, request, metadata, methodInfo, callback, replayedFromRequestId) {
    var posted = false;
    var requestId = __grpcWebDevtoolsRequestId++;
    var requestTimestamp = Date.now();

    registerReplay(requestId, function (editedRequest) {
      const nextRequest = buildGrpcWebRequest(method, request, editedRequest);
      return executeUnaryCall(clientInstance, method, nextRequest, metadata, methodInfo, null, requestId);
    });

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

        postGrpcEvent({
          method,
          methodType: "unary",
          requestId,
          request: requestObj,
          response: err ? undefined : responseObj,
          error: err || undefined,
          canReplay: true,
          replayedFromRequestId,
          timing: {
            requestTimestamp: requestTimestamp,
          },
        });
        posted = true;
      }

      if (typeof callback === "function") {
        callback(err, response);
      }
    };

    return clientInstance.rpcCall_(method, request, metadata, methodInfo, newCallback);
  }

  function executeServerStreamingCall(clientInstance, method, request, metadata, methodInfo, replayedFromRequestId) {
    var requestId = __grpcWebDevtoolsRequestId++;

    registerReplay(requestId, function (editedRequest) {
      const nextRequest = buildGrpcWebRequest(method, request, editedRequest);
      return executeServerStreamingCall(clientInstance, method, nextRequest, metadata, methodInfo, requestId);
    });

    var stream = clientInstance.serverStreaming_(method, request, metadata, methodInfo);
    return new StreamInterceptor(method, request, stream, requestId, replayedFromRequestId);
  }

  clients.map(client => {
    client.client_.rpcCall_ = client.client_.rpcCall;
    client.client_.rpcCall2 = function (method, request, metadata, methodInfo, callback) {
      return executeUnaryCall(this, method, request, metadata, methodInfo, callback);
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
      return executeServerStreamingCall(client.client_, method, request, metadata, methodInfo);
    }
    client.client_.serverStreaming = client.client_.serverStreaming2;
  })
}
