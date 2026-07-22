import reducer, { clearLog, clearLogAndCache, networkLog, selectLogEntry, setPreserveLog, logNetworkEntry } from '../state/network';

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
