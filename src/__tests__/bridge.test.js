const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
  frameA.onMessage.emit({ action: "init" });
  onConnect.emit(frameB);
  frameB.onMessage.emit({ action: "init" });
  panel.onMessage.emit({ action: "heartbeat" });
  expect(panel.posted.at(-1)).toEqual({ action: "heartbeat_ack", data: { contentConnected: true } });
  frameA.onDisconnect.emit();
  expect(panel.posted.at(-1)).toEqual({ action: "content_state", data: { contentConnected: true } });
  frameB.onDisconnect.emit();
  expect(panel.posted.at(-1)).toEqual({ action: "content_state", data: { contentConnected: false } });
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
  ports[0].onDisconnect.emit();
  for (let index = 0; index < 7; index += 1) ticks[0]();
  expect(ports).toHaveLength(6); // one initial attempt plus five capped retries
  ports.at(-1).onMessage.emit({ action: "init_ack" });
  ticks[0]();
  expect(ports).toHaveLength(6);
});
