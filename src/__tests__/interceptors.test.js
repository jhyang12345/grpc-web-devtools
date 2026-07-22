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
