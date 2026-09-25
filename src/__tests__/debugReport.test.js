import {
  buildDebugReport,
  formatDebugReportJson,
  formatDebugReportMarkdown,
} from '../utils/debugReport';

const fullEntry = {
  entryId: 42,
  captureId: 'frame-a',
  requestId: 7,
  method: '/demo.Service/GetThing',
  methodType: 'server_streaming',
  transport: 'connect-web',
  location: 'https://app.example.test/frame?token=exact-value',
  backendUrl: 'https://api.example.test?tenant=blue#result',
  timing: { duration: 1250 },
  status: { code: 13, details: 'internal' },
  request: { authorization: 'exact-secret', query: '```' },
  response: { ok: true },
  messages: [{ id: 1 }, { id: 2 }],
  replay: { available: true, token: 'must-not-be-copied' },
  replayedFrom: { token: 'also-secret' },
};

test('builds a report with only URL, Request, and Response', () => {
  const report = buildDebugReport(fullEntry);

  expect(report).toEqual({
    url: 'https://api.example.test/demo.Service/GetThing?tenant=blue#result',
    request: { authorization: 'exact-secret', query: '```' },
    response: { ok: true },
  });
  expect(Object.keys(report)).toEqual(['url', 'request', 'response']);
  expect(JSON.stringify(report)).not.toContain('must-not-be-copied');
  expect(JSON.stringify(report)).not.toContain('also-secret');
  expect(JSON.stringify(report)).not.toContain('duration');
  expect(JSON.stringify(report)).not.toContain('status');
});

test('does not duplicate a method already present in the captured URL', () => {
  const report = buildDebugReport({
    method: '/demo.Service/GetThing',
    backendUrl: 'https://api.example.test/demo.Service/GetThing?tenant=blue',
  });

  expect(report.url).toBe('https://api.example.test/demo.Service/GetThing?tenant=blue');
});

test('uses the RPC method as the URL fallback', () => {
  expect(buildDebugReport({ method: 'demo.Service/GetThing' }).url)
    .toBe('/demo.Service/GetThing');
  expect(buildDebugReport({ method: 'https://api.example.test/demo.Service/GetThing' }).url)
    .toBe('https://api.example.test/demo.Service/GetThing');
});

test('uses retained stream messages as the Response', () => {
  const report = buildDebugReport({
    method: '/demo.Service/Stream',
    request: { id: 1 },
    messages: [{ id: 2 }, { id: 3 }],
  });

  expect(report.response).toEqual([{ id: 2 }, { id: 3 }]);
});

test('includes a captured error inside Response', () => {
  const unaryError = buildDebugReport({
    method: '/demo.Service/Fail',
    request: { id: 1 },
    error: { code: 'INTERNAL', message: 'failed' },
  });
  expect(unaryError.response).toEqual({
    error: { code: 'INTERNAL', message: 'failed' },
  });

  const streamError = buildDebugReport({
    method: '/demo.Service/Stream',
    messages: [{ id: 2 }],
    error: { code: 'UNAVAILABLE' },
  });
  expect(streamError.response).toEqual({
    messages: [{ id: 2 }],
    error: { code: 'UNAVAILABLE' },
  });
});

test('keeps truncated payload descriptors and represents evicted payloads as null', () => {
  const truncated = buildDebugReport({
    method: '/demo.Service/GetThing',
    request: { __truncated: true, preview: '{"id":1}' },
    response: { __truncated: true, preview: '{"ok":true}' },
  });
  expect(truncated.request.preview).toBe('{"id":1}');
  expect(truncated.response.preview).toBe('{"ok":true}');

  const evicted = buildDebugReport({ request: true, response: true }, {
    requestPayloadMissing: true,
    responsePayloadMissing: true,
  });
  expect(evicted.request).toBeNull();
  expect(evicted.response).toBeNull();
});

test('formats deterministic JSON and minimal Markdown with safe fences', () => {
  const report = buildDebugReport(fullEntry);
  const json = formatDebugReportJson(report);
  const markdown = formatDebugReportMarkdown(report);

  expect(json).toBe(formatDebugReportJson(report));
  expect(json).toContain('"url": "https://api.example.test/demo.Service/GetThing?tenant=blue#result"');
  expect(json.endsWith('\n')).toBe(true);
  expect(markdown).not.toContain('# gRPC Debug Report');
  expect(markdown.startsWith('## URL\n')).toBe(true);
  expect(markdown).toContain('## URL');
  expect(markdown).toContain('## Request');
  expect(markdown).toContain('## Response');
  expect(markdown).toContain('````json');
  expect(markdown).not.toContain('## environment');
  expect(markdown).not.toContain('## timing');
  expect(markdown.endsWith('\n')).toBe(true);
});
