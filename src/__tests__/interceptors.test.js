const fs = require("fs");
const path = require("path");

const loadInterceptor = name => {
  const source = fs.readFileSync(path.join(__dirname, "../../public", name), "utf8");
  window.eval(source);
};

const capturedEvents = () => {
  const events = [];
  jest.spyOn(window, "postMessage").mockImplementation(message => events.push(message));
  return events;
};

afterEach(() => jest.restoreAllMocks());

test.each([
  ["grpc-web-interceptor.js", "connect-web-interceptor.js"],
  ["connect-web-interceptor.js", "grpc-web-interceptor.js"],
])("interceptors load without global collisions in either order", (first, second) => {
  loadInterceptor(first);
  loadInterceptor(second);
  expect(typeof window.__GRPCWEB_DEVTOOLS__).toBe("function");
  expect(typeof window.__CONNECT_WEB_DEVTOOLS__).toBe("function");
});

test.each([
  ["grpc-web-interceptor.js", "grpc-web-dev-tools-ready", "__GRPCWEB_DEVTOOLS__"],
  ["connect-web-interceptor.js", "connect-web-dev-tools-ready", "__CONNECT_WEB_DEVTOOLS__"],
])("%s announces when its page API is ready", (script, eventName, apiName) => {
  const listener = jest.fn();
  window.addEventListener(eventName, listener, { once: true });
  loadInterceptor(script);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(typeof window[apiName]).toBe("function");
});

test("gRPC-Web enablement is idempotent and emits start before completion", () => {
  const events = capturedEvents();
  const client = { client_: {} };
  client.client_.rpcCall = jest.fn((method, request, metadata, info, callback) => {
    expect(events.at(-1).phase).toBe("start");
    callback(null, { toObject: () => ({ answer: 42 }) });
  });
  client.client_.serverStreaming = jest.fn();
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  const wrapped = client.client_.rpcCall;
  window.__GRPCWEB_DEVTOOLS__([client]);
  expect(client.client_.rpcCall).toBe(wrapped);
  client.client_.rpcCall("Demo/Unary", { toObject: () => ({ question: true }) }, {}, {}, jest.fn());
  expect(events.map(event => event.phase)).toEqual(["start", "complete"]);
  expect(events[1].timing.duration).toEqual(expect.any(Number));
});

test("gRPC lifecycle keeps wall-clock timestamps while using monotonic elapsed time", () => {
  const events = capturedEvents();
  const client = { client_: {
    rpcCall: jest.fn((method, request, metadata, info, callback) => callback(null, { toObject: () => ({ ok: true }) })),
    serverStreaming: jest.fn(),
  } };
  jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(500);
  jest.spyOn(window.performance, 'now')
    .mockReturnValueOnce(10).mockReturnValueOnce(11).mockReturnValueOnce(12)
    .mockReturnValueOnce(13).mockReturnValueOnce(35);
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  client.client_.rpcCall("Demo/Monotonic", { toObject: () => ({}) }, {}, {}, jest.fn());
  expect(events[1].timing).toEqual(expect.objectContaining({ requestTimestamp: 1000, completionTimestamp: 500, duration: 25 }));
});

test("gRPC callback and PromiseClient unary calls capture success and failure once", async () => {
  const events = capturedEvents();
  const client = { client_: {} };
  client.client_.rpcCall = jest.fn((method, request, metadata, info, callback) => callback(Object.assign(new Error("callback failed"), { code: 13 })));
  client.client_.serverStreaming = jest.fn();
  client.client_.unaryCall = jest.fn(function unaryCall(method, request, options) {
    expect(options).toEqual({ signal: "native" });
    return request.fail ? Promise.reject(Object.assign(new Error("promise failed"), { code: 14 })) : Promise.resolve({ toObject: () => ({ promise: true }) });
  });
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  client.client_.rpcCall("Demo/Callback", { toObject: () => ({}) }, {}, {}, jest.fn());
  const nativePromise = client.client_.unaryCall("Demo/Promise", { fail: false }, { signal: "native" });
  expect(nativePromise).toBeInstanceOf(Promise);
  await nativePromise;
  await expect(client.client_.unaryCall("Demo/Promise", { fail: true }, { signal: "native" })).rejects.toThrow("promise failed");
  await Promise.resolve();
  expect(events.filter(event => event.phase === "start")).toHaveLength(3);
  expect(events.filter(event => event.phase === "error").map(event => event.error.message)).toEqual(["callback failed", "promise failed"]);
  expect(events.filter(event => event.phase === "complete")).toHaveLength(1);
});

test("gRPC streams retain lifecycle timing for completion and status failure", () => {
  const events = capturedEvents();
  const streams = [];
  const client = { client_: {
    rpcCall: jest.fn(),
    serverStreaming: jest.fn(() => {
      const handlers = {};
      const stream = { on: (name, handler) => { handlers[name] = handler; return stream; }, handlers };
      streams.push(stream);
      return stream;
    }),
  } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  client.client_.serverStreaming("Demo/Stream", { toObject: () => ({}) }, {}, {});
  streams[0].handlers.data({ toObject: () => ({ part: 1 }) });
  streams[0].handlers.status({ code: 0 });
  client.client_.serverStreaming("Demo/Stream", { toObject: () => ({}) }, {}, {});
  streams[1].handlers.status({ code: 14, details: "unavailable" });
  const terminal = events.filter(event => event.phase === "complete" || event.phase === "error");
  expect(terminal[0].timing).toEqual(expect.objectContaining({ completionTimestamp: expect.any(Number), duration: expect.any(Number), messageCount: 1, timeToFirstMessage: expect.any(Number) }));
  expect(terminal[1].error.message).toBe("unavailable");
});

test("Connect stream records iteration failure clone-safely and rethrows the original error", async () => {
  const events = capturedEvents();
  loadInterceptor("connect-web-interceptor.js");
  const originalError = Object.assign(new Error("stream failed"), { code: "unavailable" });
  async function* failingStream() {
    yield { toJson: () => ({ part: 1 }) };
    throw originalError;
  }
  const interceptor = window.__CONNECT_WEB_DEVTOOLS__(async () => ({ stream: true, message: failingStream() }));
  const result = await interceptor({ stream: true, method: { name: "Demo/Stream" }, message: { toJson: () => ({ input: 1 }) } });
  const iterator = result.message[Symbol.asyncIterator]();
  await iterator.next();
  await expect(iterator.next()).rejects.toBe(originalError);
  expect(events.map(event => event.phase)).toEqual(["start", "message", "error"]);
  expect(events.at(-1).error).toEqual({ code: "unavailable", message: "stream failed" });
});

test("Connect unary success and failure report terminal lifecycle events", async () => {
  const events = capturedEvents();
  loadInterceptor("connect-web-interceptor.js");
  const request = { stream: false, method: { name: "Demo/Unary" }, message: { toJson: () => ({ input: 1 }) } };
  const success = window.__CONNECT_WEB_DEVTOOLS__(async () => ({ stream: false, message: { toJson: () => ({ output: 1 }) } }));
  await success(request);
  const failure = window.__CONNECT_WEB_DEVTOOLS__(async () => { throw Object.assign(new Error("unavailable"), { code: 14 }); });
  await expect(failure(request)).rejects.toThrow("unavailable");
  expect(events.map(event => event.phase)).toEqual(["start", "complete", "start", "error"]);
});

test("captures backend request URLs exposed by gRPC-Web and Connect-Web", async () => {
  const events = capturedEvents();
  const client = { client_: {
    rpcCall: jest.fn((method, request, metadata, info, callback) => callback(null, { toObject: () => ({ ok: true }) })),
    serverStreaming: jest.fn(),
  } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  client.client_.rpcCall("https://api.example.test/demo.Service/GetThing", { toObject: () => ({}) }, {}, {}, jest.fn());

  loadInterceptor("connect-web-interceptor.js");
  const connect = window.__CONNECT_WEB_DEVTOOLS__(async () => ({
    stream: false,
    message: { toJson: () => ({ ok: true }) },
  }));
  await connect({
    stream: false,
    url: "https://connect.example.test/demo.Service/GetThing",
    method: { name: "GetThing" },
    message: { toJson: () => ({}) },
  });

  expect(events.filter(event => event.phase === "start").map(event => event.backendUrl)).toEqual([
    "https://api.example.test/demo.Service/GetThing",
    "https://connect.example.test/demo.Service/GetThing",
  ]);
});

test("Connect request capture keeps default-valued scalar fields", async () => {
  const events = capturedEvents();
  loadInterceptor("connect-web-interceptor.js");
  const requestMessage = {
    countryCode: "",
    toJson: jest.fn(options => options?.emitDefaultValues ? { countryCode: "" } : {}),
  };
  const interceptor = window.__CONNECT_WEB_DEVTOOLS__(async () => ({
    stream: false,
    message: { toJson: () => ({ ok: true }) },
  }));

  await interceptor({
    stream: false,
    method: { name: "Demo/DefaultValue" },
    message: requestMessage,
  });

  expect(requestMessage.toJson).toHaveBeenCalledWith({ emitDefaultValues: true });
  expect(events.find(event => event.phase === "start").request).toEqual({ countryCode: "" });
});

test("Connect stream completion is terminal after messages", async () => {
  const events = capturedEvents();
  loadInterceptor("connect-web-interceptor.js");
  async function* stream() { yield { toJson: () => ({ part: 1 }) }; }
  const interceptor = window.__CONNECT_WEB_DEVTOOLS__(async () => ({ stream: true, message: stream() }));
  const result = await interceptor({ stream: true, method: { name: "Demo/Stream" }, message: { toJson: () => ({}) } });
  for await (const _ of result.message) {}
  expect(events.map(event => event.phase)).toEqual(["start", "message", "complete"]);
  expect(events.at(-1).timing).toEqual(expect.objectContaining({ completionTimestamp: expect.any(Number), duration: expect.any(Number), messageCount: 1 }));
});

test("gRPC replay invokes the original transport once with a fresh lifecycle and provenance", () => {
  const events = capturedEvents();
  class Request {
    constructor(value = "initial") { this.value = value; }
    toObject() { return { value: this.value }; }
    setValue(value) { this.value = value; }
  }
  const originalRpc = jest.fn((method, request, metadata, info, callback) => callback(null, { toObject: () => ({ value: request.value }) }));
  const client = { client_: {
    rpcCall: originalRpc,
    serverStreaming: jest.fn(),
  } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  client.client_.rpcCall("Demo/Replay", new Request(), {}, {}, jest.fn());
  const originalStart = events.find(event => event.phase === "start");
  expect(originalStart.replay).toEqual(expect.objectContaining({ available: true, token: expect.any(String) }));
  window.dispatchEvent(new MessageEvent("message", { source: window, data: {
    type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", captureId: "frame-a",
    replayToken: originalStart.replay.token, replayAttemptId: "attempt-a", request: { value: "edited" },
  } }));
  expect(originalRpc).toHaveBeenCalledTimes(2);
  const replayStart = events.filter(event => event.phase === "start").at(-1);
  expect(replayStart).toEqual(expect.objectContaining({ requestId: originalStart.requestId + 1, replayedFrom: { captureId: "frame-a", transport: "grpc-web", requestId: originalStart.requestId } }));
  expect(events.at(-1)).toEqual(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_ACK__", replayAttemptId: "attempt-a" }));
});

test("gRPC replay adapter and unsupported nested fallback reject before backend invocation", () => {
  const events = capturedEvents();
  class Request {
    toObject() { return { nested: { value: 1 } }; }
    getNested() { return null; }
  }
  const originalRpc = jest.fn((method, request, metadata, info, callback) => callback(null, {}));
  const client = { client_: { rpcCall: originalRpc, serverStreaming: jest.fn() } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  client.client_.rpcCall("Demo/Nested", new Request(), {}, {}, jest.fn());
  const token = events.find(event => event.phase === "start").replay.token;
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", replayToken: token, request: { nested: { value: 2 } } } }));
  expect(originalRpc).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toEqual(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__" }));
  window.__GRPCWEB_DEVTOOLS__.registerMethod("Demo/Nested", { fromJson: json => ({ adapted: json.nested.value }) });
  const nextToken = events.find(event => event.phase === "start").replay.token;
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", replayToken: nextToken, request: { nested: { value: 3 } } } }));
  expect(originalRpc).toHaveBeenCalledTimes(2);
});

test("Connect replay drains streaming responses and reports provenance", async () => {
  const events = capturedEvents();
  class Message {
    constructor(json = {}) { this.value = json.value; }
    static fromJson(json) { return new Message(json); }
    toJson() { return { value: this.value }; }
  }
  async function* stream() { yield new Message({ value: "part" }); }
  const next = jest.fn(async () => ({ stream: true, message: stream() }));
  loadInterceptor("connect-web-interceptor.js");
  const interceptor = window.__CONNECT_WEB_DEVTOOLS__(next);
  await interceptor({ stream: true, method: { name: "Demo/Stream" }, message: new Message({ value: "initial" }) });
  const originalStart = events.find(event => event.phase === "start");
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "connect-web", captureId: "frame-c", replayToken: originalStart.replay.token, request: { value: "replayed" } } }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(next).toHaveBeenCalledTimes(2);
  expect(events.some(event => event.phase === "message" && event.replayedFrom?.captureId === "frame-c")).toBe(true);
  expect(events.some(event => event.phase === "complete" && event.replayedFrom?.captureId === "frame-c")).toBe(true);
});

test("gRPC Promise and server-streaming replays invoke their original backends once", async () => {
  const events = capturedEvents();
  class Request { constructor(value = "one") { this.value = value; } toObject() { return { value: this.value }; } setValue(value) { this.value = value; } }
  const unaryBackend = jest.fn((method, request) => Promise.resolve({ toObject: () => ({ value: request.value }) }));
  const streams = [];
  const streamBackend = jest.fn(() => { const handlers = {}; const stream = { on: (name, fn) => { handlers[name] = fn; return stream; }, handlers }; streams.push(stream); return stream; });
  const client = { client_: { rpcCall: jest.fn(), unaryCall: unaryBackend, serverStreaming: streamBackend } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  await client.client_.unaryCall("Demo/Promise", new Request(), { metadata: true });
  const promiseStart = events.find(event => event.method === "Demo/Promise" && event.phase === "start");
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", captureId: "frame", replayToken: promiseStart.replay.token, request: { value: "two" } } }));
  await Promise.resolve();
  expect(unaryBackend).toHaveBeenCalledTimes(2);
  client.client_.serverStreaming("Demo/Stream", new Request(), {}, {});
  const streamStart = events.filter(event => event.method === "Demo/Stream" && event.phase === "start").at(-1);
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", captureId: "frame", replayToken: streamStart.replay.token, request: { value: "three" } } }));
  expect(streamBackend).toHaveBeenCalledTimes(2);
  streams[1].handlers.data({ toObject: () => ({ value: "three" }) });
  streams[1].handlers.status({ code: 0 });
  expect(events.some(event => event.method === "Demo/Stream" && event.phase === "complete" && event.replayedFrom?.captureId === "frame")).toBe(true);
});

test("replay handles expire, evict by LRU limit, clear on pagehide, and reject oversized requests", () => {
  const events = capturedEvents();
  class Request { constructor(value = "ok") { this.value = value; } toObject() { return { value: this.value }; } setValue(value) { this.value = value; } }
  const backend = jest.fn((method, request, metadata, info, callback) => callback(null, {}));
  const client = { client_: { rpcCall: backend, serverStreaming: jest.fn() } };
  const clock = jest.spyOn(window.performance, "now").mockReturnValue(0);
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  client.client_.rpcCall("Demo/TTL", new Request(), {}, {}, jest.fn());
  const ttlToken = events.find(event => event.method === "Demo/TTL" && event.phase === "start").replay.token;
  clock.mockReturnValue(10 * 60 * 1000 + 1);
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", replayToken: ttlToken, request: { value: "late" } } }));
  expect(events.at(-1)).toEqual(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__" }));
  clock.mockReturnValue(0);
  for (let index = 0; index < 101; index += 1) client.client_.rpcCall(`Demo/LRU${index}`, new Request(String(index)), {}, {}, jest.fn());
  const firstToken = events.find(event => event.method === "Demo/LRU0" && event.phase === "start").replay.token;
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", replayToken: firstToken, request: { value: "evicted" } } }));
  expect(events.at(-1)).toEqual(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__" }));
  const retainedToken = events.filter(event => event.method === "Demo/LRU100" && event.phase === "start").at(-1).replay.token;
  window.dispatchEvent(new Event("pagehide"));
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", replayToken: retainedToken, request: { value: "cleared" } } }));
  expect(events.at(-1)).toEqual(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__" }));
  client.client_.rpcCall("Demo/Large", { toObject: () => ({ value: "x".repeat(5 * 1024 * 1024 + 1) }) }, {}, {}, jest.fn());
  expect(events.filter(event => event.method === "Demo/Large" && event.phase === "start").at(-1).replay).toEqual(expect.objectContaining({ available: false }));
});

test("existing gRPC clients and Connect interceptors retain shared replay handles after script re-evaluation", async () => {
  const events = capturedEvents();
  class Request { constructor(value = "one") { this.value = value; } toObject() { return { value: this.value }; } setValue(value) { this.value = value; } }
  const grpcBackend = jest.fn((method, request, metadata, info, callback) => callback(null, {}));
  const client = { client_: { rpcCall: grpcBackend, serverStreaming: jest.fn() } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  loadInterceptor("grpc-web-interceptor.js");
  client.client_.rpcCall("Demo/Reeval", new Request(), {}, {}, jest.fn());
  const grpcToken = events.find(event => event.method === "Demo/Reeval" && event.phase === "start").replay.token;
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", replayToken: grpcToken, request: { value: "two" } } }));
  expect(grpcBackend).toHaveBeenCalledTimes(2);

  class Message { constructor(json = {}) { this.value = json.value; } static fromJson(json) { return new Message(json); } toJson() { return { value: this.value }; } }
  const connectNext = jest.fn(async () => ({ stream: false, message: new Message({ value: "ok" }) }));
  loadInterceptor("connect-web-interceptor.js");
  const oldInterceptor = window.__CONNECT_WEB_DEVTOOLS__(connectNext);
  loadInterceptor("connect-web-interceptor.js");
  await oldInterceptor({ stream: false, method: { name: "Demo/ConnectReeval" }, message: new Message({ value: "one" }) });
  const connectToken = events.find(event => event.method === "Demo/ConnectReeval" && event.phase === "start").replay.token;
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "connect-web", replayToken: connectToken, request: { value: "two" } } }));
  await Promise.resolve();
  expect(connectNext).toHaveBeenCalledTimes(2);
  const acknowledgements = events.filter(event => event.type === "__GRPCWEB_DEVTOOLS_REPLAY_ACK__" && (event.transport === "grpc-web" || event.transport === "connect-web"));
  expect(acknowledgements).toHaveLength(2);
  window.dispatchEvent(new Event("pagehide"));
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", replayToken: grpcToken, request: { value: "three" } } }));
  expect(events.at(-1)).toEqual(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__" }));
});

test("serializes each gRPC request once and rejects edited oversized replay payloads before invocation", () => {
  const events = capturedEvents();
  const request = { toObject: jest.fn(() => ({ value: "one" })) };
  const backend = jest.fn((method, value, metadata, info, callback) => callback(null, {}));
  const client = { client_: { rpcCall: backend, serverStreaming: jest.fn() } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  client.client_.rpcCall("Demo/Once", request, {}, {}, jest.fn());
  expect(request.toObject).toHaveBeenCalledTimes(1);
  const token = events.find(event => event.method === "Demo/Once" && event.phase === "start").replay.token;
  window.dispatchEvent(new MessageEvent("message", { source: window, data: {
    type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", replayToken: token,
    replayAttemptId: "large-edit", request: { value: "x".repeat(5 * 1024 * 1024 + 1) },
  } }));
  expect(backend).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toEqual(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__", replayAttemptId: "large-edit" }));
});

test("Connect replay replaces both cancellation signals and records a stream failure without completion", async () => {
  const events = capturedEvents();
  class Message { constructor(json = {}) { this.value = json.value; } static fromJson(json) { return new Message(json); } toJson() { return { value: this.value }; } }
  const sourceController = new AbortController();
  const initController = new AbortController();
  const replayFailure = new Error("replay iterator failed");
  async function* originalStream() { yield new Message({ value: "original" }); }
  async function* failingStream() { yield new Message({ value: "replayed" }); throw replayFailure; }
  const next = jest.fn(async () => ({ stream: true, message: next.mock.calls.length === 1 ? originalStream() : failingStream() }));
  loadInterceptor("connect-web-interceptor.js");
  const interceptor = window.__CONNECT_WEB_DEVTOOLS__(next);
  await interceptor({ stream: true, method: { name: "Demo/ConnectFailure" }, message: new Message({ value: "one" }), signal: sourceController.signal, init: { signal: initController.signal, timeoutMs: 250 } });
  const token = events.find(event => event.method === "Demo/ConnectFailure" && event.phase === "start").replay.token;
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "connect-web", captureId: "frame-f", replayToken: token, request: { value: "two" } } }));
  await new Promise(resolve => setTimeout(resolve, 0));
  const replayCall = next.mock.calls[1][0];
  expect(replayCall.signal).not.toBe(sourceController.signal);
  expect(replayCall.init.signal).toBe(replayCall.signal);
  expect(replayCall.init.timeoutMs).toBe(250);
  const replayEvents = events.filter(event => event.replayedFrom?.captureId === "frame-f");
  expect(replayEvents.map(event => event.phase).filter(Boolean)).toEqual(["start", "message", "error"]);
  expect(replayEvents.some(event => event.phase === "complete")).toBe(false);
  expect(events.some(event => event.type === "__GRPCWEB_DEVTOOLS_REPLAY_ACK__")).toBe(true);
});

test("replay access refreshes true LRU order before the next handle is registered", () => {
  const events = capturedEvents();
  window.dispatchEvent(new Event("pagehide"));
  class Request { constructor(value) { this.value = value; } toObject() { return { value: this.value }; } setValue(value) { this.value = value; } }
  const backend = jest.fn((method, request, metadata, info, callback) => callback(null, {}));
  const client = { client_: { rpcCall: backend, serverStreaming: jest.fn() } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  for (let index = 0; index < 100; index += 1) client.client_.rpcCall(`Demo/Order${index}`, new Request(index), {}, {}, jest.fn());
  const firstToken = events.find(event => event.method === "Demo/Order0" && event.phase === "start").replay.token;
  const secondToken = events.find(event => event.method === "Demo/Order1" && event.phase === "start").replay.token;
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", replayToken: firstToken, request: { value: "refresh" } } }));
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", replayToken: secondToken, request: { value: "evicted" } } }));
  expect(events.at(-1)).toEqual(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__" }));
});

test("Connect rejects an aborted replay source when no fresh signal constructor is available", async () => {
  const events = capturedEvents();
  const originalAbortController = global.AbortController;
  global.AbortController = undefined;
  try {
    class Message { constructor(json = {}) { this.value = json.value; } static fromJson(json) { return new Message(json); } toJson() { return { value: this.value }; } }
    const next = jest.fn(async () => ({ stream: false, message: new Message({ value: "ok" }) }));
    loadInterceptor("connect-web-interceptor.js");
    const interceptor = window.__CONNECT_WEB_DEVTOOLS__(next);
    await interceptor({ stream: false, method: { name: "Demo/Aborted" }, message: new Message({ value: "one" }), signal: { aborted: true } });
    const token = events.find(event => event.method === "Demo/Aborted" && event.phase === "start").replay.token;
    window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "connect-web", replayToken: token, request: { value: "two" } } }));
    expect(next).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__" }));
  } finally {
    global.AbortController = originalAbortController;
  }
});

test("delegated unary calls reuse their active rpc capture and replay once", () => {
  const events = capturedEvents();
  class Request {
    constructor(value = "one") { this.value = value; this.toObject = jest.fn(() => ({ value: this.value })); }
    setValue(value) { this.value = value; }
  }
  const originalRpc = jest.fn((method, request, metadata, info, callback) => callback(null, { toObject: () => ({ value: request.value }) }));
  const client = { client_: {
    rpcCall: originalRpc,
    serverStreaming: jest.fn(),
    unaryCall(method, request, metadata, info) { return this.rpcCall(method, request, metadata, info, () => {}); },
  } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  const request = new Request();
  client.client_.unaryCall("Demo/Delegated", request, {}, {});
  const initialEvents = events.filter(event => event.method === "Demo/Delegated");
  const originalStart = initialEvents.find(event => event.phase === "start");
  expect(request.toObject).toHaveBeenCalledTimes(1);
  expect(initialEvents.filter(event => event.phase === "start")).toHaveLength(1);
  expect(initialEvents.filter(event => event.phase === "complete")).toHaveLength(1);
  window.dispatchEvent(new MessageEvent("message", { source: window, data: {
    type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", transport: "grpc-web", captureId: "frame-delegated",
    replayToken: originalStart.replay.token, replayAttemptId: "delegated-attempt", request: { value: "edited" },
  } }));
  expect(originalRpc).toHaveBeenCalledTimes(2);
  expect(request.toObject).toHaveBeenCalledTimes(1);
  const replayEvents = events.filter(event => event.method === "Demo/Delegated" && event.replayedFrom?.captureId === "frame-delegated");
  expect(replayEvents.map(event => event.phase)).toEqual(["start", "complete"]);
  expect(events.filter(event => event.type === "__GRPCWEB_DEVTOOLS_REPLAY_ACK__" && event.replayAttemptId === "delegated-attempt")).toHaveLength(1);
});

test("serialization errors advertise replay as unavailable without retaining a handle", () => {
  const events = capturedEvents();
  const request = { toObject: jest.fn(() => { throw new Error("cannot serialize"); }) };
  const backend = jest.fn((method, value, metadata, info, callback) => callback(null, {}));
  const client = { client_: { rpcCall: backend, serverStreaming: jest.fn() } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  client.client_.rpcCall("Demo/SerializationFailure", request, {}, {}, jest.fn());
  const start = events.find(event => event.method === "Demo/SerializationFailure" && event.phase === "start");
  expect(request.toObject).toHaveBeenCalledTimes(1);
  expect(start.replay).toEqual({ available: false, reason: "The captured request could not be serialized for replay." });
  expect(backend).toHaveBeenCalledTimes(1);
});

test("replay token allocation does not overwrite colliding handles for either transport", async () => {
  const events = capturedEvents();
  window.dispatchEvent(new Event("pagehide"));
  jest.spyOn(Math, "random").mockReturnValue(0);
  const grpcBackend = jest.fn((method, request, metadata, info, callback) => callback(null, {}));
  const client = { client_: { rpcCall: grpcBackend, serverStreaming: jest.fn() } };
  loadInterceptor("grpc-web-interceptor.js");
  window.__GRPCWEB_DEVTOOLS__([client]);
  client.client_.rpcCall("Demo/CollisionOne", { toObject: () => ({ value: 1 }) }, {}, {}, jest.fn());
  client.client_.rpcCall("Demo/CollisionTwo", { toObject: () => ({ value: 2 }) }, {}, {}, jest.fn());
  const grpcStarts = events.filter(event => event.transport === "grpc-web" && event.phase === "start");
  expect(grpcStarts[0].replay.available).toBe(true);
  expect(grpcStarts[1].replay).toEqual({ available: false, reason: "Unable to allocate a replay handle." });

  class Message { constructor(value) { this.value = value; } toJson() { return { value: this.value }; } }
  const next = jest.fn(async () => ({ stream: false, message: new Message("ok") }));
  loadInterceptor("connect-web-interceptor.js");
  const interceptor = window.__CONNECT_WEB_DEVTOOLS__(next);
  await interceptor({ stream: false, method: { name: "Demo/ConnectCollisionOne" }, message: new Message("one") });
  await interceptor({ stream: false, method: { name: "Demo/ConnectCollisionTwo" }, message: new Message("two") });
  const connectStarts = events.filter(event => event.transport === "connect-web" && event.phase === "start");
  expect(connectStarts[0].replay.available).toBe(true);
  expect(connectStarts[1].replay).toEqual({ available: false, reason: "Unable to allocate a replay handle." });
});
