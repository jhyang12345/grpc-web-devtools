import reducer, { clearLog, clearLogAndCache, networkLog, selectLogEntry, setPreserveLog, logNetworkEntry } from '../state/network';
import { setFilterValue } from '../state/toolbar';

test('manual clear ignores Preserve Log', () => {
  let state = reducer(undefined, setPreserveLog(true));
  state = reducer(state, networkLog({ entryId: 1, method: 'Demo/Call' }));
  state = reducer(state, clearLog({ force: true }));
  expect(state.log).toEqual([]);
});

test('selection clears after the selected item is evicted from the 1,000 entry log', () => {
  let state = reducer(undefined, networkLog({ entryId: 1, method: 'Demo/First' }));
  state = reducer(state, selectLogEntry(0));
  for (let entryId = 2; entryId <= 1001; entryId += 1) {
    state = reducer(state, networkLog({ entryId, method: `Demo/${entryId}` }));
  }
  expect(state.log).toHaveLength(1000);
  expect(state.selectedEntry).toBeNull();
  expect(state.selectedIdx).toBeNull();
});

test('a real clear cancels queued log batches', () => {
  jest.useFakeTimers();
  const dispatch = jest.fn();
  const getState = () => ({ network: { preserveLog: false } });
  logNetworkEntry({ captureId: 'frame', transport: 'grpc-web', requestId: 1, phase: 'start' })(dispatch);
  clearLogAndCache({ force: true })(dispatch, getState);
  jest.runOnlyPendingTimers();
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch).toHaveBeenCalledWith(clearLog({ force: true }));
  jest.useRealTimers();
});

test('filter matches the full frame URL', () => {
  let state = reducer(undefined, networkLog({ entryId: 1, method: 'Demo/Call', location: 'https://iframe.example.test:8443/rpc?tenant=blue' }));
  state = reducer(state, setFilterValue('tenant=blue'));
  expect(state.log).toHaveLength(1);
  state = reducer(state, setFilterValue('not-present'));
  expect(state.log).toHaveLength(0);
});

test('batched summaries retain replay descriptors and provenance, never replay closures', () => {
  jest.useFakeTimers();
  const dispatch = jest.fn();
  logNetworkEntry({
    captureId: 'frame-b', transport: 'connect-web', requestId: 9, phase: 'start',
    replay: { available: true, token: 'opaque-token' },
    replayedFrom: { captureId: 'frame-a', transport: 'connect-web', requestId: 8 },
  })(dispatch);
  jest.runOnlyPendingTimers();
  const summary = dispatch.mock.calls[0][0].payload[0];
  expect(summary).toEqual(expect.objectContaining({ captureId: 'frame-b', replay: { available: true, token: 'opaque-token' }, replayedFrom: expect.objectContaining({ requestId: 8 }) }));
  expect(Object.values(summary).some(value => typeof value === 'function')).toBe(false);
  jest.useRealTimers();
});
