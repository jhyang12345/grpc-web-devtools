// Ports are keyed by tab. A tab may have many content ports because content
// scripts run in every frame, while it has at most one DevTools panel port.
var connections = {};

function getConnection(tabId) {
  if (!connections[tabId]) {
    connections[tabId] = { panel: null, contents: new Set() };
  }
  return connections[tabId];
}

function contentConnected(connection) {
  return connection && connection.contents.size > 0;
}

function notifyPanel(tabId) {
  var connection = connections[tabId];
  if (connection && connection.panel) {
    try {
      connection.panel.postMessage({ action: "content_state", data: { contentConnected: contentConnected(connection) } });
    } catch (_) {
      // The disconnect listener will clean up an invalid port.
    }
  }
}

function removePort(port) {
  Object.keys(connections).forEach(tabId => {
    var connection = connections[tabId];
    var changed = false;
    if (connection.panel === port) {
      connection.panel = null;
      changed = true;
    }
    if (connection.contents.delete(port)) changed = true;
    if (changed) notifyPanel(tabId);
    if (!connection.panel && connection.contents.size === 0) delete connections[tabId];
  });
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "panel" && port.name !== "content") return;
  var tabId = port.name === "content" && port.sender && port.sender.tab ? port.sender.tab.id : null;

  var listener = message => {
    if (!message) return;
    if (message.action === "init") {
      // A panel has no sender tab, so it binds itself once and heartbeats do
      // not need to trust a caller-provided tab id afterwards.
      if (port.name === "panel") tabId = message.tabId;
      if (typeof tabId !== "number" || tabId < 0) return;
      var connection = getConnection(tabId);
      if (port.name === "panel") connection.panel = port;
      else connection.contents.add(port);
      try {
        port.postMessage({ action: "init_ack", data: { contentConnected: contentConnected(connection) } });
      } catch (_) {}
      if (port.name === "content") notifyPanel(tabId);
      return;
    }

    if (typeof tabId !== "number" || tabId < 0) return;
    var connection = connections[tabId];
    if (!connection) return;
    if (message.action === "heartbeat") {
      try {
        port.postMessage({ action: "heartbeat_ack", data: { contentConnected: contentConnected(connection) } });
      } catch (_) {}
      return;
    }

    if (message.target === "panel" && connection.panel) {
      try { connection.panel.postMessage(message); } catch (_) {}
    } else if (message.target === "content") {
      connection.contents.forEach(contentPort => {
        try { contentPort.postMessage(message); } catch (_) {}
      });
    }
  };

  port.onMessage.addListener(listener);
  port.onDisconnect.addListener(() => {
    port.onMessage.removeListener(listener);
    removePort(port);
  });
});
