import { createBrowserBoundAccount } from '../utils/browserBoundAccount';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder, TextDecoder } = require('util');

const ORIGIN = 'https://app.example.test';
const API = 'https://api.example.test';
const event = () => {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: value => Promise.all([...listeners].map(fn => fn(value))) };
};
function record(url = `${API}/opgwv1.OpGw/ListZones`, token = 'Bearer observed-token') {
  return { startedDateTime: new Date().toISOString(), request: { method: 'POST', url, headers: [
    { name: 'Authorization', value: token }, { name: 'Origin', value: ORIGIN },
    { name: 'Content-Type', value: 'application/grpc-web+proto' },
  ] }, response: { status: 200, _fetchedViaServiceWorker: false } };
}
function response() {
  const email = new TextEncoder().encode('tester@example.test');
  const bytes = new Uint8Array([0, 0, 0, 0, email.length + 2, 58, email.length, ...email]);
  let read = false;
  return { ok: true, body: { getReader: () => ({
    read: async () => { if (read) return { done: true }; read = true; return { done: false, value: bytes }; },
    cancel: jest.fn(), releaseLock: jest.fn(),
  }) } };
}
let client, devtools, sandbox, pageEvents, fetchMock;
beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date('2026-09-16T00:00:00Z'));
  pageEvents = {};
  let documentNumber = 0;
  fetchMock = jest.fn().mockImplementation(async () => response());
  sandbox = { location: { origin: ORIGIN }, crypto: { getRandomValues: values => values.fill(++documentNumber) },
    fetch: fetchMock, Date, URL, TextEncoder, TextDecoder, Uint8Array, AbortController,
    setTimeout, clearTimeout, addEventListener: (name, fn) => { pageEvents[name] = fn; },
    document: { get cookie() { throw new Error('Cookie access forbidden'); } },
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/bts-context.js'), 'utf8'), sandbox);
  devtools = { network: { onRequestFinished: event(), onNavigated: event() }, inspectedWindow: {
    eval: jest.fn((expression, options, callback) => {
      expect(options).toEqual({ useContentScriptContext: true });
      try { callback(vm.runInContext(expression, sandbox), null); } catch (_) { callback(null, { isException: true }); }
    }),
  } };
  client = createBrowserBoundAccount(devtools);
  client.start();
});
afterEach(() => { client.stop(); jest.useRealTimers(); });
async function finishFetch() {
  const result = client.fetch();
  for (let i = 0; i < 15; i += 1) await Promise.resolve();
  jest.advanceTimersByTime(100);
  return result;
}

test('browser-observed pair fetches the fixed RPC in isolation with no cookies or redirects', async () => {
  await devtools.network.onRequestFinished.emit(record());
  expect(await finishFetch()).toEqual({ email: 'tester@example.test', role: null, operatorFullName: null });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(`${API}/opgwv1.OpGw/GetOpUser`, expect.objectContaining({
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    headers: { authorization: 'Bearer observed-token', 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' },
  }));
});

test('forged capture/metadata-shaped input cannot seed the fallback', async () => {
  await devtools.network.onRequestFinished.emit({ backendUrl: 'https://attacker.example/rpc', meta: { authorization: 'Bearer fake' } });
  expect(await client.fetch()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([
  ['cross-origin iframe', r => { r.request.headers[1].value = 'https://iframe.example.test'; }],
  ['missing Origin', r => { r.request.headers.splice(1, 1); }],
  ['missing authorization', r => { r.request.headers.shift(); }],
  ['duplicate authorization', r => { r.request.headers.push({ name: 'AUTHORIZATION', value: 'Bearer other' }); }],
  ['oversized credential', r => { r.request.headers[0].value = `Bearer ${'x'.repeat(8192)}`; }],
  ['HTTP API', r => { r.request.url = r.request.url.replace('https:', 'http:'); }],
  ['userinfo URL', r => { r.request.url = r.request.url.replace('https://', 'https://user:pass@'); }],
  ['unrelated endpoint', r => { r.request.url = `${API}/unrelated`; }],
  ['cached request', r => { r._fromCache = 'memory'; }],
  ['service-worker response', r => { r.response._fetchedViaServiceWorker = true; }],
  ['unknown service-worker provenance', r => { delete r.response._fetchedViaServiceWorker; }],
  ['failed request', r => { r.response._error = 'failed'; }],
  ['redirect', r => { r.response.status = 302; }],
  ['old request', r => { r.startedDateTime = new Date(Date.now() - 1).toISOString(); }],
])('rejects %s', async (_, mutate) => {
  const entry = record(); mutate(entry);
  await devtools.network.onRequestFinished.emit(entry);
  expect(await client.fetch()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('never mixes tokens from one API origin into another (including different ports)', async () => {
  await devtools.network.onRequestFinished.emit(record());
  await devtools.network.onRequestFinished.emit(record('https://api.example.test:9443/opgwv1.OpGw/ListZones', 'Bearer second-token'));
  await finishFetch();
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test:9443/opgwv1.OpGw/GetOpUser');
  expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer second-token');
});

test('can use another gRPC service on the same API origin without needing an earlier GetOpUser', async () => {
  await devtools.network.onRequestFinished.emit(record(`${API}/other.v1.Service/ListItems`));
  expect((await finishFetch()).email).toBe('tester@example.test');
  expect(fetchMock.mock.calls[0][0]).toBe(`${API}/opgwv1.OpGw/GetOpUser`);
});

test('clears credentials on navigation and rejects late completion from the previous document', async () => {
  const old = record();
  await devtools.network.onRequestFinished.emit(old);
  jest.advanceTimersByTime(10);
  await devtools.network.onNavigated.emit(ORIGIN);
  await devtools.network.onRequestFinished.emit(old);
  expect(await client.fetch()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('rechecks document identity even without a delivered DevTools navigation event (BFCache)', async () => {
  await devtools.network.onRequestFinished.emit(record());
  pageEvents.pagehide();
  pageEvents.pageshow({ persisted: true });
  expect(await client.fetch()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('fallback traffic cannot renew the five-minute credential lease', async () => {
  await devtools.network.onRequestFinished.emit(record());
  jest.advanceTimersByTime(299000);
  await devtools.network.onRequestFinished.emit(record(`${API}/opgwv1.OpGw/GetOpUser`));
  jest.advanceTimersByTime(1000);
  expect(await client.fetch()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('rejects oversized streamed responses without reading the rest', async () => {
  const cancel = jest.fn();
  fetchMock.mockResolvedValue({ ok: true, body: { getReader: () => ({
    read: async () => ({ done: false, value: new Uint8Array(256 * 1024 + 1) }), cancel, releaseLock: jest.fn(),
  }) } });
  await devtools.network.onRequestFinished.emit(record());
  expect(await finishFetch()).toBeNull();
  expect(cancel).toHaveBeenCalled();
});
