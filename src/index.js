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
import { createPanelConnection } from './panelConnection';

var panelConnection = null
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

function _cleanupListeners() {
  if (panelConnection) panelConnection.stop();
  panelConnection = null;
  disconnectReplayBridge("Replay connection was closed.");
  try {
    if (chrome && chrome.devtools && chrome.devtools.network) {
      chrome.devtools.network.onNavigated.removeListener(_onNavigated);
    }
  } catch (error) {
    // no-op: devtools panel may not exist
  }
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
    const tabId = chrome.devtools.inspectedWindow.tabId;
    panelConnection = createPanelConnection({
      tabId,
      connect: () => chrome.runtime.connect(null, { name: "panel" }),
      onMessage: _onMessageRecived,
      onStateChange: status => store.dispatch(setConnectionStatus(status)),
      onPortChange: nextPort => {
        if (nextPort) configureReplayBridge(nextPort);
        else disconnectReplayBridge("Replay connection was disconnected.");
      },
    });
    panelConnection.start();

    if (chrome.devtools && chrome.devtools.network) {
      chrome.devtools.network.onNavigated.addListener(_onNavigated);
    }

    refreshInspectedUrl();

    window.addEventListener('unload', _cleanupListeners);

    // Export a manual reset while automatic recovery continues in the background.
    window.setupPanelPortIfNeeded = () => panelConnection && panelConnection.reconnectNow();

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

