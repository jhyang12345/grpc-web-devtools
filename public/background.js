// Ports are keyed by tab. A tab may have many content ports because content
// scripts run in every frame, while it has at most one DevTools panel port.
var connections = {};

function getConnection(tabId) {
  if (!connections[tabId]) {
    connections[tabId] = { panel: null, contents: new Set(), capturePorts: new Map() };
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
    connection.capturePorts.forEach((mappedPort, captureId) => {
      if (mappedPort === port) connection.capturePorts.delete(captureId);
    });
    if (changed) notifyPanel(tabId);
    if (!connection.panel && connection.contents.size === 0) delete connections[tabId];
  });
}

function isCaptureId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function rejectReplay(connection, data, reason) {
  if (!connection || !connection.panel) return;
  const safeData = data && typeof data === "object" ? data : {};
  try {
    connection.panel.postMessage({
      action: "replay_rejected",
      data: {
        captureId: isCaptureId(safeData.captureId) ? safeData.captureId : undefined,
        replayToken: typeof safeData.replayToken === "string" ? safeData.replayToken : undefined,
        sourceEntryId: Number.isFinite(safeData.sourceEntryId) ? safeData.sourceEntryId : undefined,
        reason: String(reason),
      },
    });
  } catch (_) {}
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
      if (port.name === "panel") {
        connection.panel = port;
      } else {
        connection.contents.add(port);
        const captureId = message.data && message.data.captureId;
        if (isCaptureId(captureId)) {
          const previousPort = connection.capturePorts.get(captureId);
          if (previousPort && previousPort !== port) connection.capturePorts.delete(captureId);
          connection.capturePorts.set(captureId, port);
        }
      }
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

    if (message.action === "replay_request") {
      // Replay is a panel-originated, frame-addressed command. Never fan it
      // out to every iframe when the requested capture ID is stale or absent.
      if (port !== connection.panel) return;
      const data = message.data;
      if (message.target !== "content" || !data || !isCaptureId(data.captureId)) {
        rejectReplay(connection, data, "A valid frame capture ID is required.");
        return;
      }
      const contentPort = connection.capturePorts.get(data.captureId);
      if (!contentPort) {
        rejectReplay(connection, data, "The originating frame is no longer connected.");
        return;
      }
      try {
        contentPort.postMessage({ action: "replay_request", target: "content", data });
      } catch (_) {
        if (connection.capturePorts.get(data.captureId) === contentPort) connection.capturePorts.delete(data.captureId);
        rejectReplay(connection, data, "The originating frame is no longer available.");
      }
    } else if (message.target === "panel" && connection.panel) {
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
