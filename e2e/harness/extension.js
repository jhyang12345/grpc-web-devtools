// Boots the real extension inside the current jsdom window:
//   page interceptors -> content-script.js -> background.js -> src/index.js panel
//
// Chrome's runtime ports are simulated with asynchronous, structured-clone
// delivery, and window.postMessage is replaced with a spec-shaped async version
// that sets event.source (jsdom leaves it null). Payloads that Chrome could not
// clone therefore fail here exactly as they would in the browser.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PUBLIC_DIR = path.join(__dirname, "../../public");
const EVENT_TYPE = "__GRPCWEB_DEVTOOLS__";
const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
const REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
const REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";

function listenerList() {
  const listeners = [];
  return {
    addListener: fn => listeners.push(fn),
    removeListener: fn => {
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    },
    hasListeners: () => listeners.length > 0,
    emit: (...args) => listeners.slice().forEach(fn => fn(...args)),
  };
}

function createPortPair(name, sender) {
  const makeEnd = endSender => {
    const end = {
      name,
      sender: endSender,
      connected: true,
      onMessage: listenerList(),
      onDisconnect: listenerList(),
      postMessage(message) {
        if (!end.connected) throw new Error("Attempting to use a disconnected port object");
        const clone = structuredClone(message);
        setTimeout(() => {
          if (end.peer.connected) end.peer.onMessage.emit(clone, end.peer);
        }, 0);
      },
      disconnect() {
        if (!end.connected) return;
        end.connected = false;
        const peer = end.peer;
        setTimeout(() => {
          if (!peer.connected) return;
          peer.connected = false;
          peer.onDisconnect.emit(peer);
        }, 0);
      },
    };
    return end;
  };
  const client = makeEnd({});
  const background = makeEnd(sender);
  client.peer = background;
  background.peer = client;
  return { client, background };
}

function installSpecPostMessage(window) {
  window.postMessage = function postMessage(message) {
    // Throws DataCloneError synchronously for uncloneable data, like browsers.
    const data = structuredClone(message);
    setTimeout(() => {
      window.dispatchEvent(new window.MessageEvent("message", { data, source: window, origin: window.location.origin }));
    }, 0);
  };
}

function evalPublicScript(window, name) {
  window.eval(fs.readFileSync(path.join(PUBLIC_DIR, name), "utf8"));
}

export async function waitFor(predicate, { timeout = 5000, interval = 5, message = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  let lastError;
  for (;;) {
    try {
      const value = predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${message}${lastError ? `: ${lastError.message}` : ""}`);
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

export function bootExtension({ tabId = 7 } = {}) {
  const window = global.window;
  installSpecPostMessage(window);

  // The "network-error" scenario destroys the socket on purpose; jsdom's XHR
  // reports that through console.error. Keep every other error visible.
  const consoleError = console.error;
  console.error = (...args) => {
    if (args.some(arg => /socket hang up/.test(String(arg && arg.message || arg)))) return;
    consoleError(...args);
  };

  const pageEvents = [];
  const replayResults = [];
  window.addEventListener("message", event => {
    const data = event.data;
    if (!data || event.source !== window) return;
    if (data.type === EVENT_TYPE) pageEvents.push(data);
    if (data.type === REPLAY_ACK_TYPE || data.type === REPLAY_REJECTED_TYPE) replayResults.push(data);
  });

  // Background service worker in its own realm. startBackground() is rerun to
  // simulate MV3 terminating and restarting the worker (all state is lost).
  let backgroundChrome;
  const startBackground = () => {
    backgroundChrome = { runtime: { onConnect: listenerList() } };
    vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, "background.js"), "utf8"), {
      chrome: backgroundChrome, Set, Map, Object, Number, String, console,
    });
  };
  startBackground();

  const ports = { panel: [], content: [] };
  const panelMessages = [];
  const connect = (first, second) => {
    const options = (second || first || {});
    const name = options.name;
    const sender = name === "content" ? { tab: { id: tabId }, frameId: 0 } : {};
    const pair = createPortPair(name, sender);
    ports[name === "panel" ? "panel" : "content"].push(pair);
    if (name === "panel") pair.client.onMessage.addListener(message => panelMessages.push(message));
    backgroundChrome.runtime.onConnect.emit(pair.background);
    return pair.client;
  };

  const devtoolsNetwork = { onNavigated: listenerList(), onRequestFinished: listenerList() };
  window.chrome = {
    runtime: {
      id: "inspector-e2e",
      connect,
      getURL: name => `chrome-extension://inspector-e2e/${name}`,
      onMessage: listenerList(),
    },
    devtools: {
      inspectedWindow: { tabId, eval: (expression, callback) => callback(window.location.href) },
      network: devtoolsNetwork,
    },
  };
  global.chrome = window.chrome;

  evalPublicScript(window, "content-script.js");
  // In Chrome these three are injected by the content script as web-accessible
  // <script src> tags; jsdom does not fetch them, so evaluate them directly.
  evalPublicScript(window, "protobuf-ts-interceptor.js");
  evalPublicScript(window, "grpc-web-interceptor.js");
  evalPublicScript(window, "connect-web-interceptor.js");

  const root = window.document.createElement("div");
  root.id = "root";
  window.document.body.appendChild(root);
  const panel = require("../../src/index");
  const networkCache = require("../../src/state/networkCache");
  const replayBridge = require("../../src/replayBridge");
  const networkState = require("../../src/state/network");

  const harness = {
    window,
    store: panel.store,
    pageEvents,
    replayResults,
    panelMessages,
    ports,
    devtoolsNetwork,
    getNetworkEntry: networkCache.getNetworkEntry,
    sendReplayRequest: replayBridge.sendReplayRequest,
    networkState,

    async ready() {
      await waitFor(() => harness.store.getState().toolbar.connectionStatus === "connected"
        || panelMessages.some(message => message.action === "content_state" && message.data.contentConnected), { message: "panel connection" });
    },

    eventsFor(requestId, transport) {
      return pageEvents.filter(event => event.requestId === requestId && (!transport || event.transport === transport));
    },

    /** Page events for every request started after `mark` (an index into pageEvents). */
    startsSince(mark) {
      return pageEvents.slice(mark).filter(event => event.phase === "start");
    },

    async waitForTerminal(requestId, transport) {
      return waitFor(() => harness.eventsFor(requestId, transport).find(event => ["complete", "error", "cancelled"].includes(event.phase)), { message: `terminal event for request ${requestId}` });
    },

    /** Resolves with the panel's summary and full cached entry for a page request id. */
    async panelEntry(requestId, transport, predicate = entry => !!entry.terminalPhase) {
      return waitFor(() => {
        harness.store.dispatch(networkState.flushPendingNetworkLog());
        const summary = harness.store.getState().network._allLog.find(item => item.requestId === requestId && item.transport === transport);
        if (!summary) return null;
        const full = networkCache.getNetworkEntry(summary.entryId);
        return full && predicate(full) ? { summary: harness.store.getState().network._allLog.find(item => item.entryId === summary.entryId), full } : null;
      }, { message: `panel entry for ${transport} request ${requestId}` });
    },

    /** Posts a replay command as the content script would, and waits for its page-level result. */
    async pageReplay({ transport, replayToken, request, captureId = "page-capture" }) {
      const replayAttemptId = `attempt-${Math.random().toString(36).slice(2)}`;
      window.postMessage({ type: REPLAY_REQUEST_TYPE, transport, replayToken, request, captureId, replayAttemptId, sourceEntryId: 1 }, "*");
      return waitFor(() => replayResults.find(result => result.replayAttemptId === replayAttemptId), { message: "page replay result" });
    },

    /** Terminates the background worker: every port drops and a fresh worker starts. */
    restartBackground() {
      [...ports.panel, ...ports.content].forEach(pair => pair.background.disconnect());
      startBackground();
    },

    reset() {
      harness.store.dispatch(networkState.clearLogAndCache({ force: true }));
      pageEvents.length = 0;
      replayResults.length = 0;
    },
  };
  return harness;
}
