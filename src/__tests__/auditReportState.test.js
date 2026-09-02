import { configureStore } from '@reduxjs/toolkit';
import localizationReducer, { setLanguagePreference } from '../state/localization';
import networkReducer, { clearLogAndCache, logNetworkEntry } from '../state/network';
import auditReportReducer, { downloadAuditReport, setAuditReportPageLookbackAndPersist } from '../state/auditReport';
import toastReducer from '../state/toast';
import toolbarReducer from '../state/toolbar';

afterEach(() => {
  jest.useRealTimers();
  localStorage.clear();
});

test('defaults the page lookback to 2 and clamps and persists updates', () => {
  const store = configureStore({ reducer: { auditReport: auditReportReducer } });
  expect(store.getState().auditReport.pageLookback).toBe(2);

  store.dispatch(setAuditReportPageLookbackAndPersist(5));
  expect(store.getState().auditReport.pageLookback).toBe(5);
  expect(JSON.parse(localStorage.getItem('grpc-devtools-auditReportPageLookback'))).toBe(5);

  store.dispatch(setAuditReportPageLookbackAndPersist(99));
  expect(store.getState().auditReport.pageLookback).toBe(5);

  store.dispatch(setAuditReportPageLookbackAndPersist(0));
  expect(store.getState().auditReport.pageLookback).toBe(1);
});

test('a fresh store reloads the persisted page lookback', () => {
  localStorage.setItem('grpc-devtools-auditReportPageLookback', '4');
  jest.resetModules();
  const { default: freshAuditReportReducer } = require('../state/auditReport');
  const store = configureStore({ reducer: { auditReport: freshAuditReportReducer } });
  expect(store.getState().auditReport.pageLookback).toBe(4);
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
    location: 'https://app.example.test/orders/123?session=private',
    error: { code: 14, message: 'unavailable' },
    timing: { requestTimestamp: Date.parse('2026-08-25T14:29:59Z'), completionTimestamp: Date.parse('2026-08-25T14:30:00Z'), duration: 1000 },
  }));
  store.dispatch(setLanguagePreference('ko'));
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
    expect.stringContaining('## 범위'),
    expect.objectContaining({
      filename: expect.stringMatching(/^grpc-audit-app-example-test-orders-123-session-2026-08-25T14-30-01-000Z-\d+\.md$/),
    }),
  );
  expect(downloadFile.mock.calls[0][0]).toContain('/demo.Service/ImmediateFailure');
  expect(downloadFile.mock.calls[0][0]).not.toContain('## Scope');
  expect(report.stats.included).toBe(1);
  expect(store.getState().toast).toEqual(expect.objectContaining({ visible: true, type: 'success' }));
  store.dispatch(clearLogAndCache({ force: true }));
});

