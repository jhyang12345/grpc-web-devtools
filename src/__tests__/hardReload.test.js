import { isHardReloadEntry } from '../utils/hardReload';

function documentEntry(headers) {
  return { _resourceType: 'document', request: { headers } };
}

test('detects a hard reload via Cache-Control: no-cache on the document request', () => {
  expect(isHardReloadEntry(documentEntry([{ name: 'Cache-Control', value: 'no-cache' }]))).toBe(true);
});

test('detects a hard reload via Pragma: no-cache on the document request', () => {
  expect(isHardReloadEntry(documentEntry([{ name: 'Pragma', value: 'no-cache' }]))).toBe(true);
});

test('header name matching is case-insensitive', () => {
  expect(isHardReloadEntry(documentEntry([{ name: 'cache-control', value: 'no-cache' }]))).toBe(true);
});

test('a normal reload sends Cache-Control: max-age=0, not no-cache', () => {
  expect(isHardReloadEntry(documentEntry([{ name: 'Cache-Control', value: 'max-age=0' }]))).toBe(false);
});

test('ignores no-cache headers on non-document requests, e.g. gRPC XHR calls', () => {
  const entry = { _resourceType: 'xhr', request: { headers: [{ name: 'Cache-Control', value: 'no-cache' }] } };
  expect(isHardReloadEntry(entry)).toBe(false);
});

test('handles missing or malformed entries without throwing', () => {
  expect(isHardReloadEntry(null)).toBe(false);
  expect(isHardReloadEntry({})).toBe(false);
  expect(isHardReloadEntry(documentEntry(undefined))).toBe(false);
});
