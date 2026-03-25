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
import toastReducer, { showToast } from './state/toast';

var port, tabId

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
    port.postMessage({ tabId, action: "init" });
    port.onMessage.addListener(_onMessageRecived);
    port.onDisconnect.addListener(_onPortDisconnect);

    setTimeout(() => {
      if (port) {
        try {
          port.postMessage({ action: 'heartbeat' });
        } catch (error) {
          if (store) {
            store.dispatch(setConnectionStatus(false));
          }
        }
      }
    }, 100);
  } catch (error) {
    console.error('[gRPC DevTools] Failed to reconnect panel port:', error);
    port = null;
  }
}

function _cleanupListeners() {
  try {
    if (port) {
      port.onMessage.removeListener(_onMessageRecived);
    }
    if (chrome && chrome.devtools && chrome.devtools.network) {
      chrome.devtools.network.onNavigated.removeListener(_onNavigated);
    }
  } catch (error) {
    // no-op: devtools panel may not exist
  }
}

function _onPortDisconnect() {
  if (store) {
    store.dispatch(setConnectionStatus(false));
  }
  _cleanupListeners();
  // Set port to null to allow reconnection attempts
  // Note: We don't auto-reconnect here because user may have intentionally closed DevTools
  port = null;
}

function _onNavigated() {
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
    port.postMessage({ tabId, action: "init" });
    port.onMessage.addListener(_onMessageRecived);
    port.onDisconnect.addListener(_onPortDisconnect);

    // Send heartbeat to verify connection - status set to true when ack or network call arrives
    setTimeout(() => {
      if (port) {
        try {
          port.postMessage({ action: 'heartbeat' });
        } catch (error) {
          store.dispatch(setConnectionStatus(false));
        }
      }
    }, 100);

    if (chrome.devtools && chrome.devtools.network) {
      chrome.devtools.network.onNavigated.addListener(_onNavigated);
    }

    window.addEventListener('unload', _cleanupListeners);

    // Export setupPanelPortIfNeeded for manual reconnection from Toolbar
    window.setupPanelPortIfNeeded = setupPanelPortIfNeeded;

    // Periodically check connection status with heartbeat
    setInterval(() => {
      if (port) {
        try {
          port.postMessage({ action: 'heartbeat' });
        } catch (error) {
          store.dispatch(setConnectionStatus(false));
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
      store.dispatch(logNetworkEntry(data));

      // If we're receiving messages, the connection is alive
      // This provides instant connection verification instead of waiting for heartbeat
      store.dispatch(setConnectionStatus(true));
    } catch (error) {
      console.error('[gRPC DevTools] Failed to dispatch network entry:', error, 'data:', data);
      // Don't crash the message handler - continue processing future messages
    }
  } else if (action === "pong") {
    store.dispatch(setConnectionStatus(true));
  } else if (action === "heartbeat_ack") {
    // Heartbeat acknowledged - connection is alive
    store.dispatch(setConnectionStatus(true));
  }
}

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')
);

