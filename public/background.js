// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

// Map of Panel connections. The 'tabId' is used as key.
// There are two connections/ports for every tabId
// 1) Port to the panel script
// 2) Port to the content script
//
// Example:
// connections[1].panel => pane port
// connections[1].content => content port
var connections = {};

// Note: We don't need to manually clear connections on startup/reload
// The onDisconnect handlers will automatically clean up stale connections
// when ports become invalid. Clearing connections manually can cause
// race conditions where content scripts reconnect before we clear the registry.

chrome.runtime.onConnect.addListener(port => {
  if (port.name != "panel" && port.name != "content") {
    return;
  }

  var extensionListener = message => {
    var tabId = port.sender.tab && port.sender.tab.id >= 0 ? port.sender.tab.id : message.tabId;

    // The original connection event doesn't include the tab ID of the
    // DevTools page, so we need to send it explicitly (attached
    // to the 'init' event).
    if (message.action == "init") {
      if (!connections[tabId]) {
        connections[tabId] = {};
      }
      connections[tabId][port.name] = port;
      return;
    }

    // Handle heartbeat messages
    if (message.action === "heartbeat") {
      // Echo back to confirm connection
      if (connections[tabId] && connections[tabId][port.name]) {
        port.postMessage({ action: "heartbeat_ack" });
      }
      return;
    }

    // Other messages are relayed to specified target if any
    // and if the connection exists.
    if (message.target) {
      var conn = connections[tabId] && connections[tabId][message.target];
      if (conn) {
        conn.postMessage(message);
      } else {
        // Detailed logging when message relay fails
        var hasPanel = connections[tabId] && connections[tabId].panel ? 'yes' : 'no';
        var hasContent = connections[tabId] && connections[tabId].content ? 'yes' : 'no';
        console.error('[gRPC DevTools] Message relay failed:', {
          tabId: tabId,
          target: message.target,
          action: message.action,
          panelConnected: hasPanel,
          contentConnected: hasContent,
          reason: !connections[tabId] ? 'No connections for tab' : 'Target port not found'
        });
        // Message is dropped - this can happen when panel is closed but content script is still sending
      }
    }
  };

  // Listen to messages sent from the panel script.
  port.onMessage.addListener(extensionListener);

  // Remove panel connection on disconnect.
  port.onDisconnect.addListener(function (port) {
    port.onMessage.removeListener(extensionListener);

    var tabs = Object.keys(connections);
    for (var i = 0, len = tabs.length; i < len; i++) {
      if (connections[tabs[i]][port.name] === port) {
        delete connections[tabs[i]][port.name];

        // If there is not port associated to the tab, remove it
        // from the connections map.
        if (Object.keys(connections[tabs[i]]).length === 0) {
          delete connections[tabs[i]];
        }
        break;
      }
    }
  });
});
