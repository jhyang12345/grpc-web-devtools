import { createPanelConnection } from '../panelConnection';

const listenerList = () => {
  const listeners = [];
  return {
    addListener: listener => listeners.push(listener),
    removeListener: listener => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    emit: value => listeners.slice().forEach(listener => listener(value)),
  };
};

const makePort = () => {
  const port = {
    onMessage: listenerList(),
    onDisconnect: listenerList(),
    postMessage: jest.fn(),
  };
  port.disconnect = jest.fn(() => port.onDisconnect.emit(port));
  return port;
};

const createHarness = () => {
  const ports = [];
  const onMessage = jest.fn();
  const onStateChange = jest.fn();
  const onPortChange = jest.fn();
  const manager = createPanelConnection({
    tabId: 9,
    connect: jest.fn(() => {
      const port = makePort();
      ports.push(port);
      return port;
    }),
    onMessage,
    onStateChange,
    onPortChange,
    heartbeatIntervalMs: 100,
    ackTimeoutMs: 20,
    reconnectInitialMs: 10,
    reconnectMaxMs: 40,
  });
  return { manager, ports, onMessage, onStateChange, onPortChange };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('panel reconnects automatically after its MV3 port disconnects', () => {
  const { manager, ports, onStateChange } = createHarness();
  manager.start();
  expect(ports).toHaveLength(1);
  expect(ports[0].postMessage.mock.calls.map(([message]) => message)).toEqual([
    { tabId: 9, action: 'init' },
    { action: 'heartbeat' },
  ]);
  ports[0].onMessage.emit({ action: 'init_ack', data: { contentConnected: true } });

  ports[0].onDisconnect.emit(ports[0]);
  expect(onStateChange).toHaveBeenLastCalledWith('disconnected');
  jest.advanceTimersByTime(10);
  expect(ports).toHaveLength(2);
  expect(onStateChange).toHaveBeenLastCalledWith('pending');
  manager.stop();
});

test('panel replaces a silent port when its heartbeat is not acknowledged', () => {
  const { manager, ports } = createHarness();
  manager.start();
  ports[0].onMessage.emit({ action: 'init_ack', data: { contentConnected: true } });

  jest.advanceTimersByTime(100);
  expect(ports[0].postMessage).toHaveBeenLastCalledWith({ action: 'heartbeat' });
  jest.advanceTimersByTime(20);
  expect(ports[0].disconnect).toHaveBeenCalled();
  jest.advanceTimersByTime(10);
  expect(ports).toHaveLength(2);
  manager.stop();
});

test('panel stop cancels recovery work when DevTools really closes', () => {
  const { manager, ports } = createHarness();
  manager.start();
  ports[0].onMessage.emit({ action: 'init_ack', data: { contentConnected: true } });
  manager.stop();
  jest.advanceTimersByTime(1000);
  expect(ports).toHaveLength(1);
  expect(manager.getPort()).toBeNull();
});
