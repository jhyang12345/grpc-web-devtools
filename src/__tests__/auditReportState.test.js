import { configureStore } from '@reduxjs/toolkit';
import localizationReducer from '../state/localization';
import networkReducer, { clearLogAndCache, logNetworkEntry } from '../state/network';
import { downloadAuditReport } from '../state/auditReport';
import toastReducer from '../state/toast';
import toolbarReducer from '../state/toolbar';

afterEach(() => {
  jest.useRealTimers();
});

test('flushes a just-captured error before taking the downloadable snapshot', async () => {
  jest.useFakeTimers();
  const store = configureStore({
    reducer: {
      network: networkReducer,
      toolbar: toolbarReducer,
      toast: toastReducer,
      localization: localizationReducer,
    },
  });
  store.dispatch(logNetworkEntry({
    captureId: 'frame', transport: 'grpc-web', requestId: 1, phase: 'error',
    method: '/demo.Service/ImmediateFailure',
    error: { code: 14, message: 'unavailable' },
    timing: { requestTimestamp: Date.parse('2026-08-25T14:29:59Z'), completionTimestamp: Date.parse('2026-08-25T14:30:00Z'), duration: 1000 },
  }));
  expect(store.getState().network._allLog).toHaveLength(0);
  const downloadFile = jest.fn();

  const report = await store.dispatch(downloadAuditReport({
    now: new Date('2026-08-25T14:30:01Z'),
    version: 'test',
    scheduleTask: callback => callback(),
    downloadFile,
  }));

  expect(store.getState().network._allLog).toHaveLength(1);
  expect(downloadFile).toHaveBeenCalledWith(
    expect.stringContaining('/demo.Service/ImmediateFailure'),
    expect.objectContaining({ filename: 'grpc-web-audit-2026-08-25T14-30-01Z.md' }),
  );
  expect(report.stats.included).toBe(1);
  expect(store.getState().toast).toEqual(expect.objectContaining({ visible: true, type: 'success' }));
  store.dispatch(clearLogAndCache({ force: true }));
});

