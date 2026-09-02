export const PANEL_HEARTBEAT_INTERVAL_MS = 20000;
export const PANEL_ACK_TIMEOUT_MS = 5000;
export const PANEL_RECONNECT_INITIAL_MS = 250;
export const PANEL_RECONNECT_MAX_MS = 10000;

export function createPanelConnection({
  connect,
  tabId,
  onMessage,
  onStateChange,
  onPortChange,
  heartbeatIntervalMs = PANEL_HEARTBEAT_INTERVAL_MS,
  ackTimeoutMs = PANEL_ACK_TIMEOUT_MS,
  reconnectInitialMs = PANEL_RECONNECT_INITIAL_MS,
  reconnectMaxMs = PANEL_RECONNECT_MAX_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let port = null;
  let stopped = true;
  let reconnectTimer = null;
  let ackTimer = null;
  let heartbeatTimer = null;
  let reconnectDelay = reconnectInitialMs;

  const changeState = status => {
    if (typeof onStateChange === "function") onStateChange(status);
  };

  const changePort = nextPort => {
    port = nextPort;
    if (typeof onPortChange === "function") onPortChange(nextPort);
  };

  const clearAckTimer = () => {
    if (ackTimer != null) clearTimeoutFn(ackTimer);
    ackTimer = null;
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer != null) clearTimeoutFn(reconnectTimer);
    reconnectTimer = null;
  };

  const removePortListeners = currentPort => {
    try { currentPort.onMessage.removeListener(handleMessage); } catch (_) {}
  };

  const scheduleReconnect = (delay = reconnectDelay) => {
    if (stopped || reconnectTimer != null || port) return;
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      connectNow();
    }, delay);
    reconnectDelay = Math.min(Math.max(reconnectInitialMs, reconnectDelay * 2), reconnectMaxMs);
  };

  const disconnectPort = currentPort => {
    if (!currentPort || currentPort !== port) return;
    clearAckTimer();
    removePortListeners(currentPort);
    changePort(null);
    changeState("disconnected");
    try { currentPort.disconnect(); } catch (_) {}
    scheduleReconnect();
  };

  const armAckTimeout = currentPort => {
    clearAckTimer();
    ackTimer = setTimeoutFn(() => {
      ackTimer = null;
      disconnectPort(currentPort);
    }, ackTimeoutMs);
  };

  const post = (currentPort, message) => {
    if (!currentPort || currentPort !== port) return false;
    try {
      currentPort.postMessage(message);
      return true;
    } catch (_) {
      disconnectPort(currentPort);
      return false;
    }
  };

  function handleMessage(message) {
    if (message && (message.action === "init_ack" || message.action === "heartbeat_ack")) {
      clearAckTimer();
      reconnectDelay = reconnectInitialMs;
    }
    onMessage(message);
  }

  function connectNow() {
    if (stopped || port) return;
    let nextPort;
    try {
      nextPort = connect();
      changePort(nextPort);
      changeState("pending");
      nextPort.onMessage.addListener(handleMessage);
      nextPort.onDisconnect.addListener(() => disconnectPort(nextPort));
      if (!post(nextPort, { tabId, action: "init" })) return;
      if (!post(nextPort, { action: "heartbeat" })) return;
      armAckTimeout(nextPort);
    } catch (_) {
      if (nextPort === port) {
        removePortListeners(nextPort);
        changePort(null);
      }
      changeState("disconnected");
      scheduleReconnect();
    }
  }

  const heartbeat = () => {
    if (stopped) return;
    if (!port) return scheduleReconnect(0);
    const currentPort = port;
    if (post(currentPort, { action: "heartbeat" })) armAckTimeout(currentPort);
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      reconnectDelay = reconnectInitialMs;
      connectNow();
      heartbeatTimer = setIntervalFn(heartbeat, heartbeatIntervalMs);
    },

    reconnectNow() {
      if (stopped) return;
      clearReconnectTimer();
      if (port) disconnectPort(port);
      clearReconnectTimer();
      reconnectDelay = reconnectInitialMs;
      scheduleReconnect(0);
    },

    stop() {
      if (stopped) return;
      stopped = true;
      clearReconnectTimer();
      clearAckTimer();
      if (heartbeatTimer != null) clearIntervalFn(heartbeatTimer);
      heartbeatTimer = null;
      if (port) {
        const currentPort = port;
        removePortListeners(currentPort);
        changePort(null);
        try { currentPort.disconnect(); } catch (_) {}
      }
    },

    getPort() {
      return port;
    },
  };
}
