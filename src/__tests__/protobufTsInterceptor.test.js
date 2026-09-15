const fs = require("fs");
const path = require("path");
global.TextEncoder = global.TextEncoder || require('util').TextEncoder;

const EVENT_TYPE = "__GRPCWEB_DEVTOOLS__";
const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
const REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
const REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";
const TRANSPORT = "protobuf-ts";
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

const loadRuntime = () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../public/protobuf-ts-interceptor.js"),
    "utf8"
  );
  window.eval(source);
  return window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__;
};

const loadSnoop = () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../public/request-metadata-snoop.js"),
    "utf8"
  );
  window.eval(source);
};

const capturePostedMessages = () => {
  const messages = [];
  jest.spyOn(window, "postMessage").mockImplementation(message => messages.push(message));
  return messages;
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const makeMethod = (name = "GetThing") => ({
  service: { typeName: "demo.Service" },
  name,
  I: {
    toJson: jest.fn(message => ({ ...message })),
    fromJson: jest.fn(json => ({ ...json })),
  },
  O: {
    toJson: jest.fn(message => ({ ...message })),
    fromJson: jest.fn(json => ({ ...json })),
  },
});

const makeUnaryCall = (method, request) => {
  const outcome = deferred();
  return {
    call: {
      method,
      request,
      then: outcome.promise.then.bind(outcome.promise),
    },
    resolve(response, status = { code: "OK", detail: "" }) {
      outcome.resolve({ method, request, response, status });
    },
    reject: outcome.reject,
  };
};

const makeStreamingCall = (method, request) => {
  let onMessage = () => {};
  let onError = () => {};
  let onComplete = () => {};
  const status = deferred();
  return {
    call: {
      method,
      request,
      status: status.promise,
      responses: {
        onMessage(callback) {
          onMessage = callback;
          return () => {};
        },
        onError(callback) {
          onError = callback;
          return () => {};
        },
        onComplete(callback) {
          onComplete = callback;
          return () => {};
        },
      },
    },
    message: message => onMessage(message),
    error: error => onError(error),
    complete: () => onComplete(),
    resolveStatus: status.resolve,
    rejectStatus: status.reject,
  };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  jest.restoreAllMocks();
});

test("installs one stable versioned protobuf-ts runtime", () => {
  const listener = jest.fn();
  window.addEventListener("grpc-web-dev-tools-protobuf-ts-ready", listener);
  const runtime = loadRuntime();
  expect(runtime).toEqual(expect.objectContaining({
    protocolVersion: 1,
    interceptUnary: expect.any(Function),
    interceptServerStreaming: expect.any(Function),
  }));

  loadRuntime();
  expect(window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__).toBe(runtime);
  expect(listener).toHaveBeenCalledTimes(2);
  window.removeEventListener("grpc-web-dev-tools-protobuf-ts-ready", listener);
});

test("emits unary start before the backend and completes with timing and status", async () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod();
  const unary = makeUnaryCall(method, { value: "original" });
  const order = [];
  window.postMessage.mockImplementation(message => {
    messages.push(message);
    if (message.type === EVENT_TYPE) order.push(message.phase);
  });
  const next = jest.fn(() => {
    order.push("backend");
    return unary.call;
  });

  const returned = runtime.interceptUnary({
    baseUrl: "https://api.example.test/",
    next,
    method,
    input: { value: "original" },
    options: { debug: true, meta: { authorization: "bearer token" } },
  });

  expect(returned).toBe(unary.call);
  expect(order).toEqual(["start", "backend"]);
  expect(messages[0]).toMatchObject({
    type: EVENT_TYPE,
    transport: TRANSPORT,
    phase: "start",
    method: "https://api.example.test/demo.Service/GetThing",
    backendUrl: "https://api.example.test/demo.Service/GetThing",
    methodType: "unary",
    request: { value: "original" },
    replay: { available: true, token: expect.any(String) },
    timing: { requestTimestamp: expect.any(Number) },
  });

  unary.resolve({ result: "ok" });
  await flushPromises();

  const rpcEvents = messages.filter(message => message.type === EVENT_TYPE);
  expect(rpcEvents.map(event => event.phase)).toEqual(["start", "complete"]);
  expect(rpcEvents[1]).toMatchObject({
    requestId: rpcEvents[0].requestId,
    response: { result: "ok" },
    status: { code: "OK", details: "" },
    timing: {
      requestTimestamp: expect.any(Number),
      completionTimestamp: expect.any(Number),
      duration: expect.any(Number),
      messageCount: 1,
    },
  });
});

test("captures only the allowlisted app-version/service-name metadata, never authorization or anything else", () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod();
  const unary = makeUnaryCall(method, { value: "original" });

  runtime.interceptUnary({
    baseUrl: "https://api.example.test",
    next: jest.fn(() => unary.call),
    method,
    input: { value: "original" },
    options: {
      debug: true,
      meta: {
        authorization: "bearer super-secret-token",
        "instance-id": "instance-42",
        "App-Version": "qa-af32a43", // case should not matter
        "Service-Type": "example-test16", // a different key entirely — must be ignored
        "service-name": "example-service",
      },
    },
  });

  const startEvent = messages.find(message => message.phase === "start");
  expect(startEvent.meta).toEqual({ "app-version": "qa-af32a43", "service-name": "example-service" });
  expect(JSON.stringify(startEvent)).not.toContain("super-secret-token");
  expect(JSON.stringify(startEvent)).not.toContain("instance-42");
  expect(JSON.stringify(startEvent)).not.toContain("example-test16");
});

test("omits the meta field entirely from the start event when no allowlisted keys are present", () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod();
  const unary = makeUnaryCall(method, { value: "original" });

  runtime.interceptUnary({
    baseUrl: "https://api.example.test",
    next: jest.fn(() => unary.call),
    method,
    input: { value: "original" },
    options: { debug: true, meta: { authorization: "bearer token" } },
  });

  const startEvent = messages.find(message => message.phase === "start");
  expect(startEvent.meta).toBeUndefined();
});

test("fills in app-version at the terminal event from the real wire request even when options.meta didn't carry it", async () => {
  window.fetch = jest.fn().mockResolvedValue({ ok: true });
  loadSnoop();

  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod();
  const unary = makeUnaryCall(method, { value: "original" });
  const methodName = "https://api.example.test/demo.Service/GetThing";

  runtime.interceptUnary({
    baseUrl: "https://api.example.test",
    // Simulates a transport whose own internal metadata-building happens
    // closer to the real dispatch than options.meta reflects here.
    next: jest.fn(() => {
      window.fetch(methodName, { headers: { "app-version": "qa-af32a43" } });
      return unary.call;
    }),
    method,
    input: { value: "original" },
    options: { debug: true },
  });
  unary.resolve({ result: "ok" });
  await flushPromises();

  const startEvent = messages.find(message => message.phase === "start");
  const completeEvent = messages.find(message => message.phase === "complete");
  expect(startEvent.meta).toBeUndefined();
  expect(completeEvent.meta).toEqual({ "app-version": "qa-af32a43" });
});

test("captures protobuf-ts request defaults without changing response JSON options", async () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod("DefaultValue");
  method.I.toJson.mockImplementation((message, options) => (
    options?.emitDefaultValues ? { countryCode: message.countryCode } : {}
  ));
  const unary = makeUnaryCall(method, { countryCode: "" });

  runtime.interceptUnary({
    baseUrl: "https://api.example.test",
    next: jest.fn(() => unary.call),
    method,
    input: { countryCode: "" },
    options: { debug: true, jsonOptions: { useProtoFieldName: true } },
  });

  expect(messages.find(message => message.phase === "start").request).toEqual({ countryCode: "" });
  expect(method.I.toJson).toHaveBeenCalledWith(
    { countryCode: "" },
    { useProtoFieldName: true, emitDefaultValues: true }
  );

  unary.resolve({ countryCode: "" });
  await flushPromises();
  expect(method.O.toJson).toHaveBeenCalledWith(
    { countryCode: "" },
    { useProtoFieldName: true }
  );
});

test("replays edited JSON through the original pipeline and records provenance", () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod();
  const original = makeUnaryCall(method, { value: "original" });
  const replayed = makeUnaryCall(method, { value: "edited" });
  const next = jest.fn()
    .mockReturnValueOnce(original.call)
    .mockReturnValueOnce(replayed.call);

  runtime.interceptUnary({
    baseUrl: "https://api.example.test",
    next,
    method,
    input: { value: "original" },
    options: {
      debug: true,
      abort: { aborted: false },
      meta: { authorization: "bearer token" },
    },
  });
  const originalStart = messages.find(message => message.phase === "start");

  window.dispatchEvent(new MessageEvent("message", {
    source: window,
    data: {
      type: REPLAY_REQUEST_TYPE,
      transport: TRANSPORT,
      captureId: "frame-a",
      replayToken: originalStart.replay.token,
      replayAttemptId: "attempt-a",
      request: { value: "edited" },
    },
  }));

  expect(next).toHaveBeenCalledTimes(2);
  expect(next.mock.calls[1][1]).toEqual({ value: "edited" });
  expect(next.mock.calls[1][2]).toMatchObject({
    debug: true,
    meta: { authorization: "bearer token" },
  });
  expect(next.mock.calls[1][2].abort).toBeUndefined();
  expect(messages.filter(message => message.phase === "start").at(-1)).toMatchObject({
    replayedFrom: {
      captureId: "frame-a",
      transport: TRANSPORT,
      requestId: originalStart.requestId,
    },
  });
  expect(messages).toContainEqual(expect.objectContaining({
    type: REPLAY_ACK_TYPE,
    transport: TRANSPORT,
    replayAttemptId: "attempt-a",
  }));
});

test("keeps replay handles available regardless of elapsed time", () => {
  const messages = capturePostedMessages();
  const clock = jest.spyOn(window.performance, "now").mockReturnValue(0);
  const runtime = loadRuntime();
  const method = makeMethod();
  const original = makeUnaryCall(method, { value: "original" });
  const replayed = makeUnaryCall(method, { value: "late" });
  const next = jest.fn()
    .mockReturnValueOnce(original.call)
    .mockReturnValueOnce(replayed.call);

  runtime.interceptUnary({
    baseUrl: "https://api.example.test",
    next,
    method,
    input: { value: "original" },
    options: {},
  });
  const token = messages.find(message => message.phase === "start").replay.token;

  clock.mockReturnValue(24 * 60 * 60 * 1000);
  window.dispatchEvent(new MessageEvent("message", {
    source: window,
    data: {
      type: REPLAY_REQUEST_TYPE,
      transport: TRANSPORT,
      captureId: "frame-a",
      replayToken: token,
      replayAttemptId: "late-attempt",
      request: { value: "late" },
    },
  }));

  expect(next).toHaveBeenCalledTimes(2);
  expect(messages).toContainEqual(expect.objectContaining({
    type: REPLAY_ACK_TYPE,
    replayAttemptId: "late-attempt",
  }));
});

test("keeps stream messages under one identity and emits a terminal status", async () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod("WatchThings");
  const streaming = makeStreamingCall(method, { filter: "all" });

  runtime.interceptServerStreaming({
    baseUrl: "https://api.example.test",
    next: jest.fn(() => streaming.call),
    method,
    input: { filter: "all" },
    options: { debug: true },
  });
  streaming.message({ value: 1 });
  streaming.message({ value: 2 });
  streaming.complete();
  streaming.resolveStatus({ code: "OK", detail: "finished" });
  await flushPromises();

  const rpcEvents = messages.filter(message => message.type === EVENT_TYPE);
  expect(rpcEvents.map(event => event.phase)).toEqual(["start", "message", "message", "complete"]);
  expect(new Set(rpcEvents.map(event => event.requestId)).size).toBe(1);
  expect(rpcEvents.at(-1)).toMatchObject({
    status: { code: "OK", details: "finished" },
    timing: {
      completionTimestamp: expect.any(Number),
      duration: expect.any(Number),
      messageCount: 2,
      timeToFirstMessage: expect.any(Number),
    },
  });
});

test("keeps streamed data before a clone-safe terminal error", async () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod("WatchThings");
  const streaming = makeStreamingCall(method, { filter: "all" });
  const rpcError = Object.assign(new Error("stream failed"), { code: "UNAVAILABLE" });

  runtime.interceptServerStreaming({
    baseUrl: "https://api.example.test",
    next: jest.fn(() => streaming.call),
    method,
    input: { filter: "all" },
    options: { debug: true },
  });
  streaming.message({ value: 1 });
  streaming.error(rpcError);
  streaming.rejectStatus(rpcError);
  await flushPromises();

  const rpcEvents = messages.filter(message => message.type === EVENT_TYPE);
  expect(rpcEvents.map(event => event.phase)).toEqual(["start", "message", "error"]);
  expect(new Set(rpcEvents.map(event => event.requestId)).size).toBe(1);
  expect(rpcEvents.at(-1)).toMatchObject({
    error: { name: "Error", message: "stream failed", code: "UNAVAILABLE" },
    timing: { messageCount: 1, completionTimestamp: expect.any(Number) },
  });
});

test("observes a unary rejection without replacing the original error", async () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod();
  const unary = makeUnaryCall(method, { value: "original" });
  const rpcError = Object.assign(new Error("backend failed"), {
    code: "INTERNAL",
    unsupported: () => {},
  });

  const returned = runtime.interceptUnary({
    baseUrl: "https://api.example.test",
    next: jest.fn(() => unary.call),
    method,
    input: { value: "original" },
    options: { debug: true },
  });
  const originalOutcome = Promise.resolve(returned);
  unary.reject(rpcError);

  await expect(originalOutcome).rejects.toBe(rpcError);
  await flushPromises();
  const errorEvent = messages.find(message => message.phase === "error");
  expect(errorEvent).toMatchObject({
    error: { name: "Error", message: "backend failed", code: "INTERNAL" },
    timing: {
      completionTimestamp: expect.any(Number),
      duration: expect.any(Number),
      messageCount: 0,
    },
  });
  expect(() => JSON.stringify(errorEvent)).not.toThrow();
});

test("tags a CORS-style fetch failure as a network error, not a real RPC status", async () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod();
  const unary = makeUnaryCall(method, { value: "original" });

  const returned = runtime.interceptUnary({
    baseUrl: "https://api.example.test",
    next: jest.fn(() => unary.call),
    method,
    input: { value: "original" },
    options: { debug: true },
  });
  const originalOutcome = Promise.resolve(returned);
  unary.reject(new TypeError("Failed to fetch"));

  await expect(originalOutcome).rejects.toThrow("Failed to fetch");
  await flushPromises();
  const errorEvent = messages.find(message => message.phase === "error");
  expect(errorEvent.error).toMatchObject({ isNetworkError: true });
  expect(errorEvent.error.code).toBeUndefined();
});

test("truncates oversized requests before posting and disables replay", () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod();
  const request = { body: "x".repeat(MAX_PAYLOAD_BYTES + 1) };
  const unary = makeUnaryCall(method, request);

  runtime.interceptUnary({
    baseUrl: "https://api.example.test",
    next: jest.fn(() => unary.call),
    method,
    input: request,
    options: { debug: true },
  });

  expect(messages[0]).toMatchObject({
    phase: "start",
    request: {
      __truncated: true,
      __originalSizeBytes: expect.any(Number),
      preview: expect.any(String),
    },
    replay: {
      available: false,
      reason: expect.stringMatching(/5 MiB/),
    },
  });
  expect(messages[0].request.preview).toHaveLength(2000);
});

test("keeps the rest of a response intact when it embeds an Any of a type missing from the app's registry", async () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod("ListDemands");
  const unresolvedAny = {
    typeUrl: "type.googleapis.com/commonv1.ErrorInfo",
    value: new Uint8Array([1, 2, 3]),
  };
  const response = {
    demands: [{
      id: "d1",
      unmatchedStatus: { code: 5, message: "no match", details: [unresolvedAny] },
    }],
  };

  // A faithful stand-in for protobuf-ts's real toJson(): it throws unless every
  // Any it encounters resolves against options.typeRegistry, exactly like the
  // real runtime does.
  method.O.toJson.mockImplementation((message, options) => {
    const registry = (options && options.typeRegistry) || [];
    const detail = message.demands[0].unmatchedStatus.details[0];
    const typeName = detail.typeUrl.split("/").pop();
    const type = registry.find(candidate => candidate.typeName === typeName);
    if (!type) {
      throw new Error(
        `Unable to convert google.protobuf.Any with typeUrl '${detail.typeUrl}' to JSON. ` +
        `The specified type ${typeName} is not available in the type registry.`
      );
    }
    return {
      demands: [{
        id: message.demands[0].id,
        unmatchedStatus: {
          code: message.demands[0].unmatchedStatus.code,
          message: message.demands[0].unmatchedStatus.message,
          details: [type.internalJsonWrite(type.fromBinary(detail.value))],
        },
      }],
    };
  });
  const unary = makeUnaryCall(method, { serviceType: "example-test" });

  runtime.interceptUnary({
    baseUrl: "https://api.example.test",
    next: jest.fn(() => unary.call),
    method,
    input: { serviceType: "example-test" },
    options: { debug: true },
  });
  unary.resolve(response);
  await flushPromises();

  const completeEvent = messages.find(message => message.phase === "complete");
  expect(completeEvent.response.demands[0].id).toBe("d1");
  expect(completeEvent.response.demands[0].unmatchedStatus.message).toBe("no match");
  const detail = completeEvent.response.demands[0].unmatchedStatus.details[0];
  expect(detail).toMatchObject({
    __unresolvedAnyType: true,
    "@type": "type.googleapis.com/commonv1.ErrorInfo",
  });
  expect(typeof detail.valueBase64).toBe("string");
  expect(atob(detail.valueBase64)).toBe(String.fromCharCode(1, 2, 3));
});

test("evicts the oldest replay handle after the 100-handle bound", () => {
  const messages = capturePostedMessages();
  const runtime = loadRuntime();
  const method = makeMethod();
  const next = jest.fn((nextMethod, input) => makeUnaryCall(nextMethod, input).call);

  for (let index = 0; index < 101; index += 1) {
    runtime.interceptUnary({
      baseUrl: "https://api.example.test",
      next,
      method,
      input: { index },
      options: { debug: true },
    });
  }
  const starts = messages.filter(message => message.phase === "start");

  window.dispatchEvent(new MessageEvent("message", {
    source: window,
    data: {
      type: REPLAY_REQUEST_TYPE,
      transport: TRANSPORT,
      captureId: "frame-a",
      replayToken: starts[0].replay.token,
      replayAttemptId: "evicted-attempt",
      request: { index: 0 },
    },
  }));
  expect(messages).toContainEqual(expect.objectContaining({
    type: REPLAY_REJECTED_TYPE,
    replayAttemptId: "evicted-attempt",
  }));
  expect(next).toHaveBeenCalledTimes(101);

  window.dispatchEvent(new MessageEvent("message", {
    source: window,
    data: {
      type: REPLAY_REQUEST_TYPE,
      transport: TRANSPORT,
      captureId: "frame-a",
      replayToken: starts.at(-1).replay.token,
      replayAttemptId: "retained-attempt",
      request: { index: 100, edited: true },
    },
  }));
  expect(next).toHaveBeenCalledTimes(102);
  expect(next.mock.calls.at(-1)[1]).toEqual({ index: 100, edited: true });
  expect(messages).toContainEqual(expect.objectContaining({
    type: REPLAY_ACK_TYPE,
    replayAttemptId: "retained-attempt",
  }));
});
