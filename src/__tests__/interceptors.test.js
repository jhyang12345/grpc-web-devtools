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
