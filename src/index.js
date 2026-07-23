/* global chrome */

import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { configureStore } from "@reduxjs/toolkit";
import App from './App';
import './index.css';
import networkReducer, { logNetworkEntry, clearLogAndCache } from './state/network';
import toolbarReducer, { setConnectionStatus } from './state/toolbar';
import clipboardReducer from './state/clipboard';
import toastReducer from './state/toast';
import { configureReplayBridge, disconnectReplayBridge, handleReplayBridgeMessage } from './replayBridge';

var port, tabId
var currentInspectedUrl = ''

function refreshInspectedUrl() {
  try {
    if (chrome && chrome.devtools && chrome.devtools.inspectedWindow) {
      chrome.devtools.inspectedWindow.eval('window.location.href', (result) => {
        if (result && typeof result === 'string') {
          currentInspectedUrl = result;
        }
      });
    }
  } catch (_) {}
}

function setupPanelPortIfNeeded() {
  // Check if port exists and is connected
  if (port) {
    return; // Already connected
  }

  if (!chrome || !chrome.runtime) {
    console.error('[gRPC DevTools] Chrome runtime not available');
    return;
  }

  try {
    tabId = chrome.devtools.inspectedWindow.tabId;
    port = chrome.runtime.connect(null, { name: "panel" });
    configureReplayBridge(port);
    port.postMessage({ tabId, action: "init" });
    port.onMessage.addListener(_onMessageRecived);
    port.onDisconnect.addListener(_onPortDisconnect);

    port.postMessage({ action: 'heartbeat' });
  } catch (error) {
    console.error('[gRPC DevTools] Failed to reconnect panel port:', error);
    port = null;
  }
}

function _cleanupListeners() {
  disconnectReplayBridge("Replay connection was closed.");
  try {
    if (port) port.onMessage.removeListener(_onMessageRecived);
    if (chrome && chrome.devtools && chrome.devtools.network) {
      chrome.devtools.network.onNavigated.removeListener(_onNavigated);
    }
  } catch (error) {
    // no-op: devtools panel may not exist
  }
}

function _onPortDisconnect() {
  disconnectReplayBridge("Replay connection was disconnected.");
  if (store) {
    store.dispatch(setConnectionStatus('disconnected'));
  }
  try { if (port) port.onMessage.removeListener(_onMessageRecived); } catch (_) {}
  // Set port to null to allow reconnection attempts
  // Note: We don't auto-reconnect here because user may have intentionally closed DevTools
  port = null;
}

function _onNavigated(url) {
  if (url) currentInspectedUrl = url;
  store.dispatch(clearLogAndCache());
}

const store = configureStore({
  reducer: {
    network: networkReducer,
    toolbar: toolbarReducer,
    clipboard: clipboardReducer,
    toast: toastReducer,
  }
});

// Setup port for communication with the background script
if (chrome) {
  try {
    tabId = chrome.devtools.inspectedWindow.tabId;
    port = chrome.runtime.connect(null, { name: "panel" });
    configureReplayBridge(port);
    port.postMessage({ tabId, action: "init" });
    port.onMessage.addListener(_onMessageRecived);
    port.onDisconnect.addListener(_onPortDisconnect);

    port.postMessage({ action: 'heartbeat' });

    if (chrome.devtools && chrome.devtools.network) {
      chrome.devtools.network.onNavigated.addListener(_onNavigated);
    }

    refreshInspectedUrl();

    window.addEventListener('unload', _cleanupListeners);

    // Export setupPanelPortIfNeeded for manual reconnection from Toolbar
    window.setupPanelPortIfNeeded = setupPanelPortIfNeeded;

    // Periodically check connection status with heartbeat
    setInterval(() => {
      if (port) {
        try {
          port.postMessage({ action: 'heartbeat' });
        } catch (error) {
          store.dispatch(setConnectionStatus('disconnected'));
        }
      }
    }, 2000); // Check every 2 seconds for faster disconnection detection

    // Global error handlers for resiliency
    window.onerror = (message, source, lineno, colno, error) => {
      console.error("Global error caught:", { message, source, lineno, colno, error });
    };
    window.onunhandledrejection = (event) => {
      console.error("Unhandled promise rejection:", event.reason);
    };

  } catch (error) {
    console.warn("not running app in chrome extension panel")
  }
}

function _onMessageRecived({ action, data }) {
  if (action === "gRPCNetworkCall") {
    try {
      if (!data.location && currentInspectedUrl) {
        data.location = currentInspectedUrl;
      }
      store.dispatch(logNetworkEntry(data));

      // If we're receiving messages, the connection is alive
      // This provides instant connection verification instead of waiting for heartbeat
      store.dispatch(setConnectionStatus('connected'));
    } catch (error) {
      console.error('[gRPC DevTools] Failed to dispatch network entry:', error, 'data:', data);
      // Don't crash the message handler - continue processing future messages
    }
  } else if (action === "init_ack" || action === "heartbeat_ack" || action === "content_state") {
    store.dispatch(setConnectionStatus(data && data.contentConnected ? 'connected' : 'pending'));
  } else if (action === "replay_ack" || action === "replay_rejected") {
    handleReplayBridgeMessage(action, data);
  }
}

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')
);

