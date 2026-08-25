import reducer, { buildSummaryEntry, clearLog, clearLogAndCache, networkLog, selectLogEntry, setPreserveLog, logNetworkEntry } from '../state/network';
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

test('flags a CORS-style network failure distinctly from a real gRPC status error', () => {
  const blocked = buildSummaryEntry({ entryId: 1, method: 'Demo/Blocked', error: { message: 'Failed to fetch', isNetworkError: true } });
  const serverError = buildSummaryEntry({ entryId: 2, method: 'Demo/ServerError', error: { code: 13, message: 'internal' } });
  expect(blocked.isNetworkError).toBe(true);
  expect(serverError.isNetworkError).toBe(false);

  const state = reducer(undefined, networkLog(blocked));
  expect(state.log[0].isNetworkError).toBe(true);
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
    backendUrl: 'https://api.example.test/demo.Service/GetThing',
    replay: { available: true, token: 'opaque-token' },
    replayedFrom: { captureId: 'frame-a', transport: 'connect-web', requestId: 8 },
  })(dispatch);
  jest.runOnlyPendingTimers();
  const summary = dispatch.mock.calls[0][0].payload[0];
  expect(summary).toEqual(expect.objectContaining({ captureId: 'frame-b', backendUrl: 'https://api.example.test/demo.Service/GetThing', replay: { available: true, token: 'opaque-token' }, replayedFrom: expect.objectContaining({ requestId: 8 }) }));
  expect(Object.values(summary).some(value => typeof value === 'function')).toBe(false);
  jest.useRealTimers();
});

test('batched summaries retain bounded audit signals without retaining payload bodies', () => {
  jest.useFakeTimers();
  const dispatch = jest.fn();
  logNetworkEntry({
    captureId: 'frame-a', transport: 'grpc-web', requestId: 17, phase: 'error',
    request: { secret: 'body-is-cache-only' },
    error: { code: 14, message: 'unavailable' },
    timing: { duration: 2500, messageCount: 3 },
  })(dispatch);
  jest.runOnlyPendingTimers();
  const summary = dispatch.mock.calls[0][0].payload[0];
  expect(summary).toEqual(expect.objectContaining({
    terminalPhase: 'error',
    errorCode: '14',
    payloadBytes: expect.any(Number),
    messageCount: 3,
    request: true,
    error: true,
  }));
  expect(summary).not.toHaveProperty('request.secret');
  expect(JSON.stringify(summary)).not.toContain('body-is-cache-only');
  jest.useRealTimers();
});

test('batched summaries allowlist and bound untrusted metadata', () => {
  jest.useFakeTimers();
  const dispatch = jest.fn();
  logNetworkEntry({
    captureId: 'c'.repeat(1000),
    transport: 't'.repeat(1000),
    requestId: 23,
    phase: 'complete',
    method: 'm'.repeat(10000),
    location: 'l'.repeat(10000),
    backendUrl: 'b'.repeat(10000),
    response: { ok: true },
    timing: {
      requestTimestamp: 1,
      completionTimestamp: 2,
      duration: 1,
      messageCount: 1,
      timeToFirstMessage: 1,
      padding: 'never-retain-this'.repeat(100000),
    },
    arbitraryMetadata: 'also-never-retain-this'.repeat(100000),
  })(dispatch);
  jest.runOnlyPendingTimers();
  const summary = dispatch.mock.calls[0][0].payload[0];

  expect(summary.captureId).toHaveLength(256);
  expect(summary.transport).toHaveLength(128);
  expect(summary.method).toHaveLength(2048);
  expect(summary.location).toHaveLength(4096);
  expect(summary.backendUrl).toHaveLength(4096);
  expect(summary.timing).toEqual({
    requestTimestamp: 1,
    completionTimestamp: 2,
    duration: 1,
    messageCount: 1,
    timeToFirstMessage: 1,
  });
  expect(JSON.stringify(summary)).not.toContain('never-retain-this');
  expect(JSON.stringify(summary)).not.toContain('also-never-retain-this');
  jest.useRealTimers();
});
