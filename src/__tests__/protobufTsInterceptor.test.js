const fs = require("fs");
const path = require("path");

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
  const runtime = loadRuntime();
  expect(runtime).toEqual(expect.objectContaining({
    protocolVersion: 1,
    interceptUnary: expect.any(Function),
    interceptServerStreaming: expect.any(Function),
  }));

  loadRuntime();
  expect(window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__).toBe(runtime);
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
