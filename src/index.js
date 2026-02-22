/* global chrome */

import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { configureStore } from "@reduxjs/toolkit";
import App from './App';
import './index.css';
import networkReducer, { logNetworkEntry, clearLogAndCache } from './state/network';
import toolbarReducer from './state/toolbar';
import clipboardReducer from './state/clipboard';

var port, tabId

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

function _onNavigated() {
  store.dispatch(clearLogAndCache());
}

// Setup port for communication with the background script
if (chrome) {
  try {
    tabId = chrome.devtools.inspectedWindow.tabId;
    port = chrome.runtime.connect(null, { name: "panel" });
    port.postMessage({ tabId, action: "init" });
    port.onMessage.addListener(_onMessageRecived);
    port.onDisconnect.addListener(_cleanupListeners);

    if (chrome.devtools && chrome.devtools.network) {
      chrome.devtools.network.onNavigated.addListener(_onNavigated);
    }

    window.addEventListener('unload', _cleanupListeners);

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

const store = configureStore({
  reducer: {
    network: networkReducer,
    toolbar: toolbarReducer,
    clipboard: clipboardReducer,
  }
});

function _onMessageRecived({ action, data }) {
  if (action === "gRPCNetworkCall") {
    store.dispatch(logNetworkEntry(data));
  }
}

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')
);

