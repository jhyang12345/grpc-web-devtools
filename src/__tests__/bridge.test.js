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

const timerQueue = () => {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(fn) {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    runNext() {
      const entry = timers.entries().next().value;
      if (!entry) return false;
      const [id, fn] = entry;
      timers.delete(id);
      fn();
      return true;
    },
    size() {
      return timers.size;
    },
  };
};

test("manifest loads the isolated bridge before page hooks without public script resources", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public/manifest.json"), "utf8"));
  expect(manifest.minimum_chrome_version).toBe("111");
  expect(manifest.web_accessible_resources).toBeUndefined();
  expect(manifest.permissions).toEqual([]);
  expect(manifest.content_scripts).toEqual([
    {
      matches: ["<all_urls>"], js: ["content-script.js"], world: "ISOLATED",
      run_at: "document_start", all_frames: true,
    },
    {
      matches: ["<all_urls>"],
      js: ["protobuf-ts-interceptor.js", "grpc-web-interceptor.js", "connect-web-interceptor.js"],
      world: "MAIN", run_at: "document_start", all_frames: true,
    },
  ]);
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

test("content retries until acknowledged and recovers again after a later disconnect", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/content-script.js"), "utf8");
  const timers = timerQueue();
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
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  expect(document.head.appendChild).not.toHaveBeenCalled();
  while (ports.length < 8) expect(timers.runNext()).toBe(true);
  expect(ports).toHaveLength(8);
  ports.at(-1).onMessage.emit({ action: "init_ack" });
  expect(timers.size()).toBe(0);
  ports.at(-1).onDisconnect.emit();
  expect(timers.runNext()).toBe(true);
  expect(ports).toHaveLength(9);
});

test("content truncates oversized payloads before the extension bridge", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/content-script.js"), "utf8");
  const timers = timerQueue();
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
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  });
  ports[0].onMessage.emit({ action: "init_ack" });
  eventListeners.message({ source: window, data: {
    type: "__GRPCWEB_DEVTOOLS__",
    requestId: 7,
    method: "m".repeat(10000),
    timing: { duration: 1, padding: "never-retain-this".repeat(10000) },
    arbitraryMetadata: "also-never-retain-this".repeat(10000),
    request: { body: 'x'.repeat(5 * 1024 * 1024 + 1) },
  } });
  const delivered = ports[0].posted.at(-1).data;
  expect(delivered).toEqual(expect.objectContaining({ captureId: expect.any(String), location: "https://example.test/frame" }));
  expect(delivered.method).toHaveLength(2048);
  expect(delivered.timing).toEqual({ duration: 1 });
  expect(delivered).not.toHaveProperty("arbitraryMetadata");
  expect(delivered.request).toEqual(expect.objectContaining({ __truncated: true, __originalSizeBytes: expect.any(Number) }));
  expect(delivered.request.preview).toHaveLength(2000);
});

test("content bounds the disconnected message queue by aggregate bytes", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/content-script.js"), "utf8");
  const timers = timerQueue();
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
    chrome, window, document, Uint32Array, TextEncoder, Date, Math, String, Number,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  });

  for (let requestId = 1; requestId <= 5; requestId += 1) {
    eventListeners.message({ source: window, data: {
      type: "__GRPCWEB_DEVTOOLS__",
      phase: "start",
      requestId,
      request: { requestId, body: "x".repeat(2 * 1024 * 1024) },
    } });
  }
  ports[0].onMessage.emit({ action: "init_ack" });
  const delivered = ports[0].posted.filter(message => message.action === "gRPCNetworkCall");
  const deliveredBytes = delivered.reduce((total, message) => total + new TextEncoder().encode(JSON.stringify(message)).length, 0);

  expect(delivered.length).toBeLessThan(5);
  expect(delivered.map(message => message.data.requestId)).not.toContain(1);
  expect(delivered.at(-1).data.requestId).toBe(5);
  expect(deliveredBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
});

test("content replaces unsupported structured-clone payloads before queueing", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/content-script.js"), "utf8");
  const timers = timerQueue();
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
    chrome, window, document, Uint32Array, TextEncoder, Date, Math, String, Number, Object, WeakSet,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  });
  const cyclic = { body: "x".repeat(1024 * 1024) };
  cyclic.self = cyclic;
  const payloads = [cyclic, { amount: BigInt(10) }, { bytes: new ArrayBuffer(16 * 1024 * 1024) }];

  payloads.forEach((request, index) => eventListeners.message({ source: window, data: {
    type: "__GRPCWEB_DEVTOOLS__",
    phase: "start",
    requestId: index + 1,
    request,
  } }));
  ports[0].onMessage.emit({ action: "init_ack" });
  const delivered = ports[0].posted.filter(message => message.action === "gRPCNetworkCall");

  expect(delivered).toHaveLength(3);
  delivered.forEach(message => {
    expect(message.data.request).toEqual(expect.objectContaining({
      __truncated: true,
      __originalSizeBytes: null,
      preview: expect.stringContaining("omitted"),
    }));
    expect(() => JSON.stringify(message)).not.toThrow();
  });
});

test("content preserves a message that discovers a stale port and flushes it after reconnect", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/content-script.js"), "utf8");
  const timers = timerQueue();
  const ports = [];
  const eventListeners = {};
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
    addEventListener: (name, listener) => { eventListeners[name] = listener; },
  };
  const document = { createElement: () => ({ remove: jest.fn() }), head: { appendChild: jest.fn() } };
  vm.runInNewContext(source, {
    chrome, window, document, Uint32Array, TextEncoder, Date, Math, String, Number,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  });
  ports[0].onMessage.emit({ action: "init_ack" });
  const originalPost = ports[0].postMessage.bind(ports[0]);
  ports[0].postMessage = message => {
    if (message.action === "gRPCNetworkCall") throw new Error("stale port");
    originalPost(message);
  };

  eventListeners.message({ source: window, data: { type: "__GRPCWEB_DEVTOOLS__", requestId: 7, request: { value: "retained" } } });
  expect(timers.runNext()).toBe(true);
  expect(ports).toHaveLength(2);
  ports[1].onMessage.emit({ action: "init_ack" });
  expect(ports[1].posted.at(-1)).toEqual(expect.objectContaining({
    action: "gRPCNetworkCall",
    data: expect.objectContaining({ requestId: 7, request: { value: "retained" } }),
  }));
});

test("content forwards only matching replay commands and relays page acknowledgements", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/content-script.js"), "utf8");
  const timers = timerQueue();
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
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
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
