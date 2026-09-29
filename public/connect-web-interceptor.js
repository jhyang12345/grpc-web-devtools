(() => {
  const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
  const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
  const REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
  const REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";
  const TRANSPORT = "connect-web";
  const STATE_KEY = Symbol.for("grpc-web-inspector.connect-replay-state");
  const LISTENER_KEY = Symbol.for("grpc-web-inspector.connect-replay-listener");
  const MAX_REPLAY_HANDLES = 100;
  const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

  function getState() {
    if (!window[STATE_KEY]) Object.defineProperty(window, STATE_KEY, { configurable: true, value: { registry: new Map() } });
    return window[STATE_KEY];
  }

  const state = getState();

  function monotonicNow() {
    return window.performance && typeof window.performance.now === "function" ? window.performance.now() : Date.now();
  }

  function nextRequestId() {
    const requestId = window.__grpcWebDevtoolsRequestId || 1;
    window.__grpcWebDevtoolsRequestId = requestId + 1;
    return requestId;
  }

  function safeStringify(value) {
    try { return JSON.stringify(value); } catch (_) { return ""; }
  }

  function byteLength(value) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
    return unescape(encodeURIComponent(value)).length;
  }

  function isPlainObject(value) {
    return !!value && Object.prototype.toString.call(value) === "[object Object]";
  }

  const UNRESOLVED_ANY_NOTE = "Not in the app's type registry; showing raw bytes instead of expanded fields.";

  function bytesToBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
  }

  function base64ToBytes(text) {
    const normalized = String(text).replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const binary = atob(normalized + "===".slice((normalized.length + 3) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function unresolvedAnyJson(bytes) {
    return { __unresolvedAnyType: true, note: UNRESOLVED_ANY_NOTE, valueBase64: bytesToBase64(bytes) };
  }

  function unresolvedAnyBytes(typeName, json) {
    if (!json || typeof json.valueBase64 !== "string") {
      throw new Error(`google.protobuf.Any "${typeName}" is not in the app's type registry; replay it with its captured valueBase64.`);
    }
    return base64ToBytes(json.valueBase64);
  }

  // Connect-ES v1 (protobuf-es v1 classes). toJson()/fromJson() throw on any
  // google.protobuf.Any whose type is not in a registry, and the interceptor
  // cannot see the app's registry, so retry with stand-ins that keep raw bytes.
  const V1_FALLBACK_REGISTRY = {
    findMessage(typeName) {
      return {
        typeName,
        fromBinary: bytes => ({ toJson: () => unresolvedAnyJson(bytes) }),
        fromJson(json) {
          const bytes = unresolvedAnyBytes(typeName, json);
          return { toBinary: () => bytes, getType: () => ({ typeName }) };
        },
      };
    },
    findEnum: () => undefined,
    findExtensionFor: () => undefined,
  };

  function v1ToJson(message, options) {
    try { return message.toJson(options); } catch (error) {
      try { return message.toJson({ ...options, typeRegistry: V1_FALLBACK_REGISTRY }); } catch (_) { throw error; }
    }
  }

  // Connect-ES v2 (protobuf-es v2) messages are plain objects without methods,
  // with bigint 64-bit integers, Uint8Array bytes and {case, value} oneofs. The
  // method descriptor the interceptor receives is enough to write and read the
  // canonical proto3 JSON mapping without the application's protobuf runtime.
  const LONG_SCALARS = [3, 4, 6, 16, 18]; // INT64, UINT64, FIXED64, SFIXED64, SINT64
  const FLOAT_SCALARS = [1, 2];
  const BYTES_SCALAR = 12;
  const BOOL_SCALAR = 8;
  const STRING_SCALAR = 9;
  const IMPLICIT_PRESENCE = 2;
  const WRAPPERS = ["DoubleValue", "FloatValue", "Int64Value", "UInt64Value", "Int32Value", "UInt32Value", "BoolValue", "StringValue", "BytesValue"]
    .map(name => `google.protobuf.${name}`);

  function isDescMessage(desc) {
    return !!desc && desc.kind === "message" && Array.isArray(desc.fields);
  }

  function fieldOf(desc, localName) {
    return desc.fields.find(field => field.localName === localName);
  }

  function fractionDigits(nanos) {
    if (nanos === 0) return "";
    if (nanos % 1000000 === 0) return `.${String(nanos / 1000000).padStart(3, "0")}`;
    if (nanos % 1000 === 0) return `.${String(nanos / 1000).padStart(6, "0")}`;
    return `.${String(nanos).padStart(9, "0")}`;
  }

  function parseFraction(text) {
    return text ? Number(text.padEnd(9, "0")) : 0;
  }

  function long(field, value) {
    if (field.longAsString || typeof BigInt !== "function") return String(value);
    return BigInt(value);
  }

  function scalarToJson(scalar, value) {
    if (value === undefined || value === null) return value;
    if (LONG_SCALARS.includes(scalar)) return String(value);
    if (scalar === BYTES_SCALAR) return value instanceof Uint8Array ? bytesToBase64(value) : value;
    if (FLOAT_SCALARS.includes(scalar) && typeof value === "number" && !Number.isFinite(value)) {
      return Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity";
    }
    return value;
  }

  function scalarFromJson(field, scalar, value) {
    if (LONG_SCALARS.includes(scalar)) return long(field, value);
    if (scalar === BYTES_SCALAR) return typeof value === "string" ? base64ToBytes(value) : new Uint8Array(value || []);
    if (scalar === BOOL_SCALAR) return value === true || value === "true";
    if (scalar === STRING_SCALAR) return String(value);
    if (FLOAT_SCALARS.includes(scalar) && typeof value === "string") {
      return value === "NaN" ? NaN : value === "Infinity" ? Infinity : value === "-Infinity" ? -Infinity : Number(value);
    }
    return Number(value);
  }

  function scalarZero(field, scalar) {
    if (LONG_SCALARS.includes(scalar)) return long(field, 0);
    if (scalar === BYTES_SCALAR) return new Uint8Array(0);
    if (scalar === BOOL_SCALAR) return false;
    if (scalar === STRING_SCALAR) return "";
    return 0;
  }

  function enumToJson(enumDesc, value) {
    if (enumDesc && enumDesc.typeName === "google.protobuf.NullValue") return null;
    const known = enumDesc && enumDesc.values.find(item => item.number === value);
    return known ? known.name : value;
  }

  function enumFromJson(enumDesc, value) {
    if (value === null || typeof value === "number") return value || 0;
    const known = enumDesc && enumDesc.values.find(item => item.name === value);
    if (!known) throw new Error(`Unknown enum value "${value}" for ${enumDesc ? enumDesc.typeName : "enum"}.`);
    return known.number;
  }

  function isImplicitZero(field, value) {
    if (field.fieldKind === "list") return value.length === 0;
    if (field.fieldKind === "map") return Object.keys(value).length === 0;
    if (field.fieldKind === "enum") return value === 0;
    if (value instanceof Uint8Array) return value.length === 0;
    return value === 0 || value === "" || value === false || (typeof value === "bigint" && value === BigInt(0)) || (LONG_SCALARS.includes(field.scalar) && value === "0");
  }

  function wellKnownToJson(desc, message) {
    switch (desc.typeName) {
      case "google.protobuf.Any":
        return message.typeUrl ? { "@type": message.typeUrl, ...unresolvedAnyJson(message.value || new Uint8Array(0)) } : {};
      case "google.protobuf.Timestamp": {
        const seconds = Number(message.seconds || 0);
        return `${new Date(seconds * 1000).toISOString().slice(0, 19)}${fractionDigits(message.nanos || 0)}Z`;
      }
      case "google.protobuf.Duration": {
        const seconds = BigInt(message.seconds || 0);
        const nanos = message.nanos || 0;
        const negative = seconds < BigInt(0) || nanos < 0;
        const absolute = seconds < BigInt(0) ? -seconds : seconds;
        return `${negative ? "-" : ""}${absolute}${fractionDigits(Math.abs(nanos))}s`;
      }
      case "google.protobuf.Struct":
        return Object.fromEntries(Object.entries(message.fields || {}).map(([key, value]) => [key, wellKnownToJson({ typeName: "google.protobuf.Value" }, value)]));
      case "google.protobuf.ListValue":
        return (message.values || []).map(value => wellKnownToJson({ typeName: "google.protobuf.Value" }, value));
      case "google.protobuf.Value": {
        const kind = message.kind || {};
        if (kind.case === "structValue") return wellKnownToJson({ typeName: "google.protobuf.Struct" }, kind.value);
        if (kind.case === "listValue") return wellKnownToJson({ typeName: "google.protobuf.ListValue" }, kind.value);
        if (kind.case === "nullValue" || kind.case === undefined) return null;
        return kind.value;
      }
      case "google.protobuf.FieldMask":
        return (message.paths || []).map(path => path.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())).join(",");
      default:
        if (WRAPPERS.includes(desc.typeName)) return scalarToJson(fieldOf(desc, "value").scalar, message.value);
        return undefined;
    }
  }

  function v2ToJson(desc, message, emitDefaults) {
    if (message === undefined || message === null) return message;
    const wellKnown = wellKnownToJson(desc, message);
    if (wellKnown !== undefined) return wellKnown;
    const json = {};
    desc.fields.forEach(field => {
      let value;
      if (field.oneof) {
        const selected = message[field.oneof.localName];
        if (!selected || selected.case !== field.localName) return;
        value = selected.value;
      } else {
        value = message[field.localName];
      }
      if (value === undefined || value === null) return;
      if (!field.oneof && field.presence === IMPLICIT_PRESENCE && !emitDefaults && isImplicitZero(field, value)) return;
      if (!field.oneof && !emitDefaults && (field.fieldKind === "list" || field.fieldKind === "map") && isImplicitZero(field, value)) return;
      json[field.jsonName] = fieldValueToJson(field, field.fieldKind === "list" ? field.listKind : field.fieldKind === "map" ? field.mapKind : field.fieldKind, value, emitDefaults);
    });
    return json;
  }

  function fieldValueToJson(field, kind, value, emitDefaults) {
    if (field.fieldKind === "list") return value.map(item => singleToJson(field, kind, item, emitDefaults));
    if (field.fieldKind === "map") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, singleToJson(field, kind, item, emitDefaults)]));
    }
    return singleToJson(field, kind, value, emitDefaults);
  }

  // protobuf-es v2 unboxes two well-known types inside messages: a wrapper in a
  // singular, non-oneof field is its bare scalar, and a Struct anywhere except
  // inside google.protobuf.Value is a plain JSON object.
  function isUnboxedWrapper(field) {
    return field.fieldKind === "message" && !field.oneof && WRAPPERS.includes(field.message.typeName);
  }

  function isUnboxedStruct(field) {
    return field.message && field.message.typeName === "google.protobuf.Struct" && field.parent && field.parent.typeName !== "google.protobuf.Value";
  }

  function singleToJson(field, kind, value, emitDefaults) {
    if (kind === "message" && isUnboxedWrapper(field)) return scalarToJson(fieldOf(field.message, "value").scalar, value);
    if (kind === "message" && isUnboxedStruct(field) && isPlainObject(value) && !value.$typeName) return value;
    if (kind === "message") return v2ToJson(field.message, value, emitDefaults);
    if (kind === "enum") return enumToJson(field.enum, value);
    return scalarToJson(field.scalar, value);
  }

  function wellKnownFromJson(desc, json) {
    const make = fields => ({ $typeName: desc.typeName, ...fields });
    switch (desc.typeName) {
      case "google.protobuf.Any": {
        if (!isPlainObject(json) || Object.keys(json).length === 0) return make({ typeUrl: "", value: new Uint8Array(0) });
        const typeUrl = json["@type"];
        return make({ typeUrl, value: unresolvedAnyBytes(typeUrl, json) });
      }
      case "google.protobuf.Timestamp": {
        const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(String(json));
        if (!match) throw new Error(`Invalid google.protobuf.Timestamp "${json}".`);
        return make({ seconds: BigInt(Date.parse(`${match[1]}${match[3]}`) / 1000), nanos: parseFraction(match[2]) });
      }
      case "google.protobuf.Duration": {
        const match = /^(-)?(\d+)(?:\.(\d{1,9}))?s$/.exec(String(json));
        if (!match) throw new Error(`Invalid google.protobuf.Duration "${json}".`);
        const sign = match[1] ? -1 : 1;
        return make({ seconds: BigInt(sign * Number(match[2])), nanos: sign * parseFraction(match[3]) });
      }
      case "google.protobuf.Struct":
        if (!isPlainObject(json)) throw new Error("google.protobuf.Struct must be a JSON object.");
        return make({ fields: Object.fromEntries(Object.entries(json).map(([key, value]) => [key, wellKnownFromJson({ typeName: "google.protobuf.Value" }, value)])) });
      case "google.protobuf.ListValue":
        if (!Array.isArray(json)) throw new Error("google.protobuf.ListValue must be a JSON array.");
        return make({ values: json.map(value => wellKnownFromJson({ typeName: "google.protobuf.Value" }, value)) });
      case "google.protobuf.Value": {
        if (json === null) return make({ kind: { case: "nullValue", value: 0 } });
        if (typeof json === "number") return make({ kind: { case: "numberValue", value: json } });
        if (typeof json === "string") return make({ kind: { case: "stringValue", value: json } });
        if (typeof json === "boolean") return make({ kind: { case: "boolValue", value: json } });
        if (Array.isArray(json)) return make({ kind: { case: "listValue", value: wellKnownFromJson({ typeName: "google.protobuf.ListValue" }, json) } });
        return make({ kind: { case: "structValue", value: wellKnownFromJson({ typeName: "google.protobuf.Struct" }, json) } });
      }
      case "google.protobuf.FieldMask":
        return make({ paths: String(json).split(",").filter(Boolean).map(path => path.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)) });
      default:
        if (WRAPPERS.includes(desc.typeName)) {
          const valueField = fieldOf(desc, "value");
          return make({ value: scalarFromJson(valueField, valueField.scalar, json) });
        }
        return undefined;
    }
  }

  function v2FromJson(desc, json) {
    const wellKnown = wellKnownFromJson(desc, json);
    if (wellKnown !== undefined) return wellKnown;
    if (!isPlainObject(json)) throw new Error(`${desc.typeName} must be a JSON object.`);
    const message = { $typeName: desc.typeName };
    desc.fields.forEach(field => {
      if (field.oneof) {
        if (!message[field.oneof.localName]) message[field.oneof.localName] = { case: undefined };
      } else if (field.fieldKind === "list") {
        message[field.localName] = [];
      } else if (field.fieldKind === "map") {
        message[field.localName] = {};
      } else if (field.presence === IMPLICIT_PRESENCE && field.fieldKind !== "message") {
        message[field.localName] = field.fieldKind === "enum" ? 0 : scalarZero(field, field.scalar);
      }
    });
    desc.fields.forEach(field => {
      const key = [field.jsonName, field.name, field.localName].find(name => Object.prototype.hasOwnProperty.call(json, name));
      if (key === undefined) return;
      const value = json[key];
      const isValueMessage = field.fieldKind === "message" && field.message.typeName === "google.protobuf.Value";
      if (value === null && !isValueMessage) return;
      const kind = field.fieldKind === "list" ? field.listKind : field.fieldKind === "map" ? field.mapKind : field.fieldKind;
      let decoded;
      if (field.fieldKind === "list") {
        if (!Array.isArray(value)) throw new Error(`Field "${key}" must be a JSON array.`);
        decoded = value.map(item => singleFromJson(field, kind, item));
      } else if (field.fieldKind === "map") {
        if (!isPlainObject(value)) throw new Error(`Field "${key}" must be a JSON object.`);
        decoded = Object.fromEntries(Object.entries(value).map(([mapKey, item]) => [mapKey, singleFromJson(field, kind, item)]));
      } else {
        decoded = singleFromJson(field, kind, value);
      }
      if (field.oneof) message[field.oneof.localName] = { case: field.localName, value: decoded };
      else message[field.localName] = decoded;
    });
    return message;
  }

  function singleFromJson(field, kind, value) {
    if (kind === "message" && isUnboxedWrapper(field)) {
      const valueField = fieldOf(field.message, "value");
      return scalarFromJson(valueField, valueField.scalar, value);
    }
    if (kind === "message" && isUnboxedStruct(field)) {
      if (!isPlainObject(value)) throw new Error(`Field "${field.jsonName}" must be a JSON object.`);
      return value;
    }
    if (kind === "message") return v2FromJson(field.message, value);
    if (kind === "enum") return enumFromJson(field.enum, value);
    // Map values have no longAsString flag; protobuf-es v2 stores them as bigint.
    return scalarFromJson(field.fieldKind === "map" ? {} : field, field.scalar, value);
  }

  function messageToJson(value, desc, emitDefaults) {
    if (value && typeof value.toJson === "function") return v1ToJson(value, emitDefaults ? { emitDefaultValues: true } : undefined);
    if (isDescMessage(desc) && isPlainObject(value)) return v2ToJson(desc, value, emitDefaults);
    return value;
  }

  function serializeRequest(value, desc) {
    try { return messageToJson(value, desc, true); } catch (error) {
      return { __error: `Serialization failed for request: ${error && error.message || "unknown error"}` };
    }
  }

  function serializeResponse(value, desc) {
    try { return messageToJson(value, desc, false); } catch (error) {
      return { __error: `Serialization failed for response: ${error && error.message || "unknown error"}` };
    }
  }

  function serializeError(error) {
    const hasCode = error && (typeof error.code === "string" || typeof error.code === "number");
    const isNetworkError = !hasCode && error instanceof TypeError;
    return {
      code: error && error.code,
      message: error && error.message ? String(error.message) : String(error || "Unknown RPC error"),
      ...(isNetworkError ? { isNetworkError: true } : {}),
    };
  }

  function post(payload) {
    try {
      window.postMessage({ type: POST_TYPE, transport: TRANSPORT, ...payload }, "*");
    } catch (_) {
      // Debug instrumentation must never alter the application RPC (for
      // example a DataCloneError on an uncloneable payload).
    }
  }

  function randomToken() {
    const bytes = new Uint32Array(4);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 0xffffffff); });
    return Array.from(bytes, value => value.toString(36)).join("-");
  }

  function enforceReplayLimit() {
    while (state.registry.size > MAX_REPLAY_HANDLES) state.registry.delete(state.registry.keys().next().value);
  }

  function registerReplay(payload, invoke) {
    if (isPlainObject(payload) && payload.__error) {
      return { available: false, reason: "The captured request could not be serialized for replay." };
    }
    const serialized = safeStringify(payload);
    if (!serialized || byteLength(serialized) > MAX_PAYLOAD_BYTES) return { available: false, reason: "The captured request exceeds the 5 MiB replay limit." };
    enforceReplayLimit();
    let token;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = randomToken();
      if (!state.registry.has(candidate)) {
        token = candidate;
        break;
      }
    }
    if (!token) return { available: false, reason: "Unable to allocate a replay handle." };
    state.registry.set(token, { invoke });
    enforceReplayLimit();
    return { available: true, token };
  }

  function getReplay(token) {
    const handle = state.registry.get(token);
    if (!handle) return null;
    state.registry.delete(token);
    state.registry.set(token, handle);
    return handle;
  }

  function reconstruct(original, json, desc) {
    if (!isPlainObject(json)) throw new Error("Replay request JSON must be an object.");
    if (isDescMessage(desc) && !(original && typeof original.toJson === "function")) return v2FromJson(desc, json);
    const Constructor = original && original.constructor;
    if (!Constructor) throw new Error("Unable to reconstruct the original Connect request type.");
    if (typeof Constructor.fromJson === "function") {
      try { return Constructor.fromJson(json); } catch (error) {
        try { return Constructor.fromJson(json, { typeRegistry: V1_FALLBACK_REGISTRY }); } catch (_) { throw error; }
      }
    }
    if (typeof Constructor.fromJsonString === "function") return Constructor.fromJsonString(JSON.stringify(json));
    try { return new Constructor(json); } catch (_) {}
    const result = new Constructor();
    if (typeof result.fromJson === "function") { result.fromJson(json); return result; }
    if (typeof result.fromJsonString === "function") { result.fromJsonString(JSON.stringify(json)); return result; }
    throw new Error("This Connect request type does not expose a supported JSON constructor.");
  }

  function replayedFrom(command, requestId) {
    return { captureId: command.captureId, transport: TRANSPORT, requestId };
  }

  function freshReplayRequest(req, message) {
    const replayReq = { ...req, message };
    const hasSignal = !!req.signal || !!(req.init && req.init.signal);
    if (!hasSignal) return replayReq;
    if (typeof AbortController === "undefined") {
      if ((req.signal && req.signal.aborted) || (req.init && req.init.signal && req.init.signal.aborted)) throw new Error("The original request cancellation signal is already aborted.");
      return replayReq;
    }
    const signal = new AbortController().signal;
    replayReq.signal = signal;
    if (req.init) replayReq.init = { ...req.init, signal };
    return replayReq;
  }

  // Connect-ES v1 and v2 both number DEADLINE_EXCEEDED 4. A call timeout aborts
  // the call signal with it as the reason, and that is an error, not a cancel.
  const DEADLINE_EXCEEDED = 4;

  // How a stream whose call signal was aborted ended: the application
  // cancelled it, unless the abort was Connect enforcing the call's deadline.
  function abortedStreamOutcome(signal) {
    const reason = signal.reason;
    if (reason && reason.code === DEADLINE_EXCEEDED) return { phase: "error", fields: { error: serializeError(reason) } };
    return { phase: "cancelled", fields: {} };
  }

  function readStream(req, stream, requestId, requestTimestamp, elapsedStart, replayedFromValue) {
    let messageCount = 0;
    let firstMessageAt;
    let terminal = false;
    let listening = false;
    const signal = req.signal;
    const finish = (phase, fields) => {
      if (terminal) return;
      terminal = true;
      if (listening) {
        listening = false;
        try { signal.removeEventListener("abort", onAbort); } catch (_) {}
      }
      const completionTimestamp = Date.now();
      post({ phase, method: req.method.name, methodType: "server_streaming", requestId, replayedFrom: replayedFromValue, ...fields, timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, monotonicNow() - elapsedStart), messageCount, timeToFirstMessage: firstMessageAt == null ? null : Math.max(0, firstMessageAt - elapsedStart) } });
    };
    function onAbort() {
      const outcome = abortedStreamOutcome(signal);
      finish(outcome.phase, outcome.fields);
    }
    // Watch the call signal eagerly: Connect hides return() from the
    // application, and after an abort Connect-ES v2 never resumes this generator.
    if (signal && signal.aborted) {
      onAbort();
    } else if (signal && typeof signal.addEventListener === "function") {
      try {
        signal.addEventListener("abort", onAbort);
        listening = true;
      } catch (_) {}
    }
    async function* read() {
      try {
        for await (const message of stream) {
          // Still hand the application every message, but record none after the
          // call ended (a message already buffered when it was aborted).
          if (!terminal) {
            messageCount += 1;
            if (firstMessageAt == null) firstMessageAt = monotonicNow();
            post({ phase: "message", method: req.method.name, methodType: "server_streaming", requestId, replayedFrom: replayedFromValue, response: serializeResponse(message, req.method.output), timing: { requestTimestamp, messageCount, timeToFirstMessage: Math.max(0, firstMessageAt - elapsedStart) } });
          }
          yield message;
        }
        finish("complete");
      } catch (error) {
        if (signal && signal.aborted) onAbort();
        else finish("error", { error: serializeError(error) });
        throw error;
      } finally {
        // Connect's own clients never call return() on this iterator. Another
        // interceptor can, typically because it is failing the call, so this
        // is not a cancellation, but it must not stay pending either.
        finish("error", { error: { message: "The stream stopped being read before it ended; no final status was received." } });
      }
    }
    return read();
  }

  function isAsyncIterable(value) {
    return !!value && typeof value[Symbol.asyncIterator] === "function" && typeof value.toJson !== "function";
  }

  function asyncIterableOf(items) {
    return { async *[Symbol.asyncIterator]() { yield* items; } };
  }

  function isServerStreamingMethod(method) {
    // v2 DescMethod.methodKind, v1 MethodInfo.kind (MethodKind.ServerStreaming = 1)
    return !!method && (method.methodKind === "server_streaming" || method.kind === 1);
  }

  async function execute(next, originalReq, replayedFromValue) {
    const requestId = nextRequestId();
    const requestTimestamp = Date.now();
    const elapsedStart = monotonicNow();
    let req = originalReq;
    // Connect passes a streaming call's input as an AsyncIterable. For server
    // streaming it holds exactly one message: read it so the request can be
    // shown and replayed, and hand the transport an equivalent iterable.
    const streamInput = req.stream && isAsyncIterable(req.message) && isServerStreamingMethod(req.method);
    // Client-streaming and bidi inputs are open-ended: never consume them.
    const uncapturedStreamInput = req.stream && !streamInput && !!req.message && typeof req.message[Symbol.asyncIterator] === "function";
    let inputMessage = req.message;
    if (streamInput) {
      const inputs = [];
      try {
        for await (const message of req.message) inputs.push(message);
      } catch (error) {
        post({ phase: "error", method: req.method.name, methodType: "server_streaming", requestId, replayedFrom: replayedFromValue, error: serializeError(error), timing: { requestTimestamp, completionTimestamp: Date.now(), duration: Math.max(0, monotonicNow() - elapsedStart), messageCount: 0 } });
        throw error;
      }
      inputMessage = inputs[0];
      req = { ...req, message: asyncIterableOf(inputs) };
    }
    const wrapInput = message => (streamInput ? asyncIterableOf([message]) : message);
    const methodType = req.stream ? "server_streaming" : "unary";
    const backendUrl = typeof req.url === "string" && req.url ? req.url : undefined;
    const requestPayload = uncapturedStreamInput
      ? { __error: "Streaming request input is not captured for client-streaming or bidirectional calls." }
      : serializeRequest(inputMessage, req.method.input);
    const replay = registerReplay(requestPayload, (json, command) => {
      const message = wrapInput(reconstruct(inputMessage, json, req.method.input));
      const replayReq = freshReplayRequest(req, message);
      return execute(next, replayReq, replayedFrom(command, requestId)).then(response => {
        if (!response || !response.stream) return response;
        return (async () => { for await (const _ of response.message) {} return response; })();
      });
    });
    post({ phase: "start", method: req.method.name, methodType, requestId, request: requestPayload, replay, replayedFrom: replayedFromValue, ...(backendUrl ? { backendUrl } : {}), timing: { requestTimestamp } });
    try {
      const response = await next(req);
      if (response.stream) return { ...response, message: readStream(req, response.message, requestId, requestTimestamp, elapsedStart, replayedFromValue) };
      const completionTimestamp = Date.now();
      post({ phase: "complete", method: req.method.name, methodType, requestId, replayedFrom: replayedFromValue, response: serializeResponse(response.message, req.method.output), timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, monotonicNow() - elapsedStart), messageCount: 1 } });
      return response;
    } catch (error) {
      const completionTimestamp = Date.now();
      // A stream the application cancelled before the response arrived.
      const outcome = req.stream && req.signal && req.signal.aborted
        ? abortedStreamOutcome(req.signal)
        : { phase: "error", fields: { error: serializeError(error) } };
      post({ phase: outcome.phase, method: req.method.name, methodType, requestId, replayedFrom: replayedFromValue, ...outcome.fields, timing: { requestTimestamp, completionTimestamp, duration: Math.max(0, monotonicNow() - elapsedStart), messageCount: 0 } });
      throw error;
    }
  }

  window.__CONNECT_WEB_DEVTOOLS__ = next => req => execute(next, req);

  function rejectReplay(data, reason) {
    window.postMessage({ type: REPLAY_REJECTED_TYPE, transport: TRANSPORT, captureId: data && data.captureId, replayToken: data && data.replayToken, sourceEntryId: data && data.sourceEntryId, replayAttemptId: data && data.replayAttemptId, reason: String(reason) }, "*");
  }

  function onReplay(event) {
    const data = event.source === window && event.data;
    if (!data || data.type !== REPLAY_REQUEST_TYPE || data.transport !== TRANSPORT) return;
    const serialized = safeStringify(data.request);
    if (typeof data.replayToken !== "string" || !isPlainObject(data.request) || !serialized || byteLength(serialized) > MAX_PAYLOAD_BYTES) return rejectReplay(data, "The replay request is invalid or exceeds 5 MiB.");
    const handle = getReplay(data.replayToken);
    if (!handle) return rejectReplay(data, "This replay handle is no longer available.");
    try {
      const result = handle.invoke(data.request, data);
      if (result && typeof result.then === "function") result.catch(() => {});
      window.postMessage({ type: REPLAY_ACK_TYPE, transport: TRANSPORT, captureId: data.captureId, replayToken: data.replayToken, sourceEntryId: data.sourceEntryId, replayAttemptId: data.replayAttemptId }, "*");
    } catch (error) {
      rejectReplay(data, error && error.message || "Replay could not be started.");
    }
  }

  const previousListener = window[LISTENER_KEY];
  if (previousListener) {
    window.removeEventListener("message", previousListener.onReplay, false);
    window.removeEventListener("pagehide", previousListener.cleanup, false);
    window.removeEventListener("unload", previousListener.cleanup, false);
  }
  const cleanup = () => state.registry.clear();
  window.addEventListener("message", onReplay, false);
  window.addEventListener("pagehide", cleanup, false);
  window.addEventListener("unload", cleanup, false);
  Object.defineProperty(window, LISTENER_KEY, { configurable: true, value: { onReplay, cleanup } });
  window.dispatchEvent(new CustomEvent("connect-web-dev-tools-ready"));
})();
