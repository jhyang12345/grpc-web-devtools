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
    console.log('[gRPC DevTools] Reconnecting panel port...');
    tabId = chrome.devtools.inspectedWindow.tabId;
    port = chrome.runtime.connect(null, { name: "panel" });
    port.postMessage({ tabId, action: "init" });
    port.onMessage.addListener(_onMessageRecived);
    port.onDisconnect.addListener(_onPortDisconnect);

    // Don't set connection status to true yet - wait for heartbeat_ack or pong
    // to verify the connection actually works. The existing message handlers
    // (lines 150 and 152) will set it to true when we receive a response.

    // Send heartbeat to verify connection - status will be set to true when ack received
    setTimeout(() => {
      if (port) {
        try {
          port.postMessage({ action: 'heartbeat' });
          console.log('[gRPC DevTools] Panel port created, waiting for heartbeat_ack...');
        } catch (error) {
          console.warn('[gRPC DevTools] Heartbeat failed after reconnection:', error);
          // If heartbeat send failed, port is dead
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
  console.log('[gRPC DevTools] Port disconnected');
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

    // Don't set connection status to true immediately - wait for verification
    // Connection status will be set when first heartbeat_ack or gRPCNetworkCall arrives
    // Send immediate heartbeat to verify connection quickly
    setTimeout(() => {
      if (port) {
        try {
          port.postMessage({ action: 'heartbeat' });
          console.log('[gRPC DevTools] Panel port created, sent initial heartbeat');
        } catch (error) {
          console.warn('[gRPC DevTools] Initial heartbeat failed:', error);
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
    // With Fix #1, this is mainly for detecting disconnection when no messages flow
    setInterval(() => {
      if (port) {
        try {
          port.postMessage({ action: 'heartbeat' });
        } catch (error) {
          // Port is dead
          console.warn('[gRPC DevTools] Heartbeat failed, port appears dead');
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
    // Reconnection successful
    console.log('[gRPC DevTools] Pong received - connection restored');
    store.dispatch(setConnectionStatus(true));
  } else if (action === "heartbeat_ack") {
    // Heartbeat acknowledged - connection is alive
    store.dispatch(setConnectionStatus(true));
  } else if (action === "gRPCReplayResult") {
    store.dispatch(showToast({
      message: data?.message || (data?.ok ? 'Replay started.' : 'Replay failed.'),
      type: data?.ok ? 'success' : 'error',
      autoDismiss: data?.ok ? 2000 : 5000,
    }));
  }
}

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')
);

