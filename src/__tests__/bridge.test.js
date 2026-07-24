const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { TextEncoder } = require("util");

const listenerList = () => {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), removeListener: fn => listeners.splice(listeners.indexOf(fn), 1), emit: value => listeners.slice().forEach(fn => fn(value)) };
};

const makePort = (name, tabId) => ({
  name,
  sender: tabId == null ? {} : { tab: { id: tabId } },
  onMessage: listenerList(),
  onDisconnect: listenerList(),
  posted: [],
  postMessage(message) { this.posted.push(message); },
});

test("background keeps multiple frame ports and reports their health to the bound panel", () => {
  const onConnect = listenerList();
  const chrome = { runtime: { onConnect } };
  const source = fs.readFileSync(path.join(__dirname, "../../public/background.js"), "utf8");
  vm.runInNewContext(source, { chrome, Set, Object });
  const panel = makePort("panel");
  const frameA = makePort("content", 9);
  const frameB = makePort("content", 9);
  onConnect.emit(panel);
  panel.onMessage.emit({ action: "init", tabId: 9 });
  onConnect.emit(frameA);
  frameA.onMessage.emit({ action: "init", data: { captureId: "frame-a" } });
  onConnect.emit(frameB);
  frameB.onMessage.emit({ action: "init", data: { captureId: "frame-b" } });
  panel.onMessage.emit({ action: "heartbeat" });
  expect(panel.posted.at(-1)).toEqual({ action: "heartbeat_ack", data: { contentConnected: true } });
  frameA.onDisconnect.emit();
  expect(panel.posted.at(-1)).toEqual({ action: "content_state", data: { contentConnected: true } });
  frameB.onDisconnect.emit();
  expect(panel.posted.at(-1)).toEqual({ action: "content_state", data: { contentConnected: false } });
});

test("background routes a replay request only to its exact capture ID and relays its result", () => {
  const onConnect = listenerList();
  const chrome = { runtime: { onConnect } };
  const source = fs.readFileSync(path.join(__dirname, "../../public/background.js"), "utf8");
  vm.runInNewContext(source, { chrome, Set, Map, Object, Number, String });
  const panel = makePort("panel");
  const frameA = makePort("content", 9);
  const frameB = makePort("content", 9);
  const frameC = makePort("content", 9);
  onConnect.emit(panel);
  panel.onMessage.emit({ action: "init", tabId: 9 });
  [[frameA, "frame-a"], [frameB, "frame-b"], [frameC, "frame-c"]].forEach(([port, captureId]) => {
    onConnect.emit(port);
    port.onMessage.emit({ action: "init", data: { captureId } });
  });
  panel.onMessage.emit({
    action: "replay_request", target: "content",
    data: { captureId: "frame-b", replayToken: "token-b", sourceEntryId: 2, transport: "grpc-web", request: { value: 1 } },
  });
  expect(frameB.posted.at(-1)).toEqual(expect.objectContaining({ action: "replay_request", data: expect.objectContaining({ captureId: "frame-b" }) }));
  expect(frameA.posted.some(message => message.action === "replay_request")).toBe(false);
  expect(frameC.posted.some(message => message.action === "replay_request")).toBe(false);
  frameB.onMessage.emit({ action: "replay_ack", target: "panel", data: { captureId: "frame-b", replayToken: "token-b" } });
  expect(panel.posted.at(-1)).toEqual(expect.objectContaining({ action: "replay_ack", data: expect.objectContaining({ captureId: "frame-b" }) }));
});

test("background rejects malformed or stale replay targets and cleans disconnected mappings", () => {
  const onConnect = listenerList();
  const chrome = { runtime: { onConnect } };
  const source = fs.readFileSync(path.join(__dirname, "../../public/background.js"), "utf8");
  vm.runInNewContext(source, { chrome, Set, Map, Object, Number, String });
  const panel = makePort("panel");
  const frame = makePort("content", 9);
  onConnect.emit(panel);
  panel.onMessage.emit({ action: "init", tabId: 9 });
  onConnect.emit(frame);
  frame.onMessage.emit({ action: "init", data: { captureId: "frame-a" } });
  panel.onMessage.emit({ action: "replay_request", target: "content", data: {} });
  expect(panel.posted.at(-1)).toEqual(expect.objectContaining({ action: "replay_rejected", data: expect.objectContaining({ reason: expect.any(String) }) }));
  frame.onDisconnect.emit();
  panel.onMessage.emit({ action: "replay_request", target: "content", data: { captureId: "frame-a", replayToken: "token" } });
  expect(panel.posted.at(-1)).toEqual(expect.objectContaining({ action: "replay_rejected", data: expect.objectContaining({ captureId: "frame-a" }) }));
});

test("content retries only until an init acknowledgement is received", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/content-script.js"), "utf8");
  const ticks = [];
  const ports = [];
  const chrome = {
    runtime: {
      getURL: name => name,
      connect: () => {
        const port = makePort("content");
        port.disconnect = () => port.onDisconnect.emit();
        ports.push(port);
        return port;
      },
      onMessage: listenerList(),
    },
  };
  const window = {
    location: { href: "https://example.test/frame" },
    crypto: { getRandomValues: values => values.fill(1) },
    addEventListener: jest.fn(),
  };
  const document = { createElement: () => ({ remove: jest.fn() }), head: { appendChild: jest.fn() } };
  vm.runInNewContext(source, {
    chrome,
    window,
    document,
    Uint32Array,
    Date,
    Math,
    String,
    setInterval: fn => { ticks.push(fn); return ticks.length; },
    clearInterval: jest.fn(),
  });
  expect(document.head.appendChild.mock.calls.map(([script]) => script.src)).toEqual([
    "protobuf-ts-interceptor.js",
    "grpc-web-interceptor.js",
    "connect-web-interceptor.js",
  ]);
  for (let index = 0; index < 7; index += 1) ticks[0]();
  expect(ports).toHaveLength(6); // one initial attempt plus five capped retries
  ports.at(-1).onMessage.emit({ action: "init_ack" });
  ticks[0]();
  expect(ports).toHaveLength(6);
});

test("content truncates oversized payloads before the extension bridge", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/content-script.js"), "utf8");
  const ports = [];
  const eventListeners = {};
  const chrome = {
    runtime: {
      getURL: name => name,
      connect: () => { const port = makePort("content"); ports.push(port); return port; },
      onMessage: listenerList(),
    },
  };
  const window = {
    location: { href: "https://example.test/frame" },
    crypto: { getRandomValues: values => values.fill(1) },
    addEventListener: (name, listener) => { eventListeners[name] = listener; },
  };
  const document = { createElement: () => ({ remove: jest.fn() }), head: { appendChild: jest.fn() } };
  vm.runInNewContext(source, {
    chrome, window, document, Uint32Array, TextEncoder, Date, Math, String,
    setInterval: () => 1, clearInterval: jest.fn(),
  });
  ports[0].onMessage.emit({ action: "init_ack" });
  eventListeners.message({ source: window, data: { type: "__GRPCWEB_DEVTOOLS__", requestId: 7, request: { body: 'x'.repeat(5 * 1024 * 1024 + 1) } } });
  const delivered = ports[0].posted.at(-1).data;
  expect(delivered).toEqual(expect.objectContaining({ captureId: expect.any(String), location: "https://example.test/frame" }));
  expect(delivered.request).toEqual(expect.objectContaining({ __truncated: true, __originalSizeBytes: expect.any(Number) }));
  expect(delivered.request.preview).toHaveLength(2000);
});

test("content forwards only matching replay commands and relays page acknowledgements", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/content-script.js"), "utf8");
  const ports = [];
  const eventListeners = {};
  const chrome = {
    runtime: {
      getURL: name => name,
      connect: () => { const port = makePort("content"); ports.push(port); return port; },
      onMessage: listenerList(),
    },
  };
  const window = {
    location: { href: "https://example.test/frame" },
    crypto: { getRandomValues: values => values.fill(1) },
    addEventListener: (name, listener) => { eventListeners[name] = listener; },
    postMessage: jest.fn(),
  };
  const document = { createElement: () => ({ remove: jest.fn() }), head: { appendChild: jest.fn() } };
  vm.runInNewContext(source, {
    chrome, window, document, Uint32Array, TextEncoder, Date, Math, String, Number,
    setInterval: () => 1, clearInterval: jest.fn(),
  });
  const captureId = ports[0].posted[0].data.captureId;
  ports[0].onMessage.emit({ action: "init_ack" });
  ports[0].onMessage.emit({ action: "replay_request", target: "content", data: { captureId: "other-frame", replayToken: "nope" } });
  expect(window.postMessage).not.toHaveBeenCalled();
  ports[0].onMessage.emit({ action: "replay_request", target: "content", data: { captureId, replayToken: "token", type: "spoofed" } });
  expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", captureId, replayToken: "token" }), "*");
  eventListeners.message({ source: window, data: {
    type: "__GRPCWEB_DEVTOOLS_REPLAY_ACK__", captureId,
    replayToken: "t".repeat(600), replayAttemptId: "a".repeat(600), reason: "r".repeat(600), message: "m".repeat(600),
  } });
  expect(ports[0].posted.at(-1)).toEqual(expect.objectContaining({ action: "replay_ack", target: "panel", data: expect.objectContaining({ captureId }) }));
  const result = ports[0].posted.at(-1).data;
  expect(result.replayToken).toHaveLength(512);
  expect(result.replayAttemptId).toHaveLength(512);
  expect(result.reason).toHaveLength(512);
  expect(result.message).toHaveLength(512);
});
