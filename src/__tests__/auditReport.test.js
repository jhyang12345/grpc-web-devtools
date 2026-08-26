import {
  MAX_AUDIT_REPORT_BYTES,
  MAX_AUDIT_REQUESTS,
  analyzeAuditEntry,
  buildAuditReport,
  formatBoundedJson,
  getAuditReportFilename,
  getDiagnosticClue,
  normalizeGrpcCode,
  utf8ByteLength,
} from '../utils/auditReport';

const NOW = Date.parse('2026-08-25T14:30:00.000Z');

function summary(entry) {
  return {
    entryId: entry.entryId,
    method: entry.method,
    methodType: entry.methodType,
    transport: entry.transport,
    backendUrl: entry.backendUrl,
    location: entry.location,
    requestId: entry.requestId,
    request: entry.request != null,
    response: entry.response != null,
    error: entry.error != null,
    isNetworkError: entry.error?.isNetworkError === true || entry.isNetworkError === true,
    status: entry.status != null,
    messages: !!entry.messages?.length,
    terminalPhase: entry.terminalPhase,
    errorCode: entry.error?.code,
    statusCode: entry.status?.code,
    payloadBytes: entry.payloadBytes,
    payloadTruncated: false,
    messageCount: entry.messageCount,
    droppedMessageCount: entry.droppedMessageCount,
    timing: entry.timing,
  };
}

function build(entries, options = {}) {
  const cache = new Map(entries.map(entry => [entry.entryId, entry]));
  return buildAuditReport({
    allEntries: entries.map(summary),
    filteredEntries: (options.filteredEntries || []).map(summary),
    filterValue: options.filterValue || '',
    getEntry: entryId => cache.get(entryId),
    now: new Date(NOW),
    version: '1.6.0-test',
  });
}

test('normalizes numeric and string gRPC codes and provides cautious clues', () => {
  expect(normalizeGrpcCode(14)).toBe('UNAVAILABLE');
  expect(normalizeGrpcCode('code-deadline-exceeded')).toBe('DEADLINE_EXCEEDED');
  expect(normalizeGrpcCode('canceled')).toBe('CANCELLED');
  expect(getDiagnosticClue('UNAUTHENTICATED')).toMatch(/credential/i);
  expect(getDiagnosticClue(null, 'network connection failed')).toMatch(/backend health/i);
});

test('detects errors, slow calls, partial streams, dropped messages, and pending requests', () => {
  const failed = analyzeAuditEntry(summary({
    entryId: 1,
    method: '/demo.Service/Stream',
    error: { code: 14, message: 'down' },
    terminalPhase: 'error',
    messages: [{ value: 1 }],
    messageCount: 4,
    droppedMessageCount: 3,
    payloadBytes: 2 * 1024 * 1024,
    timing: { requestTimestamp: NOW - 5000, completionTimestamp: NOW - 1000, duration: 4000 },
  }), { now: NOW, fullEntry: {
    error: { code: 14, message: 'down' }, terminalPhase: 'error', messages: [{ value: 1 }],
    messageCount: 4, droppedMessageCount: 3, payloadBytes: 2 * 1024 * 1024,
    timing: { requestTimestamp: NOW - 5000, completionTimestamp: NOW - 1000, duration: 4000 },
  } });
  expect(failed.signals.map(signal => signal.id)).toEqual(expect.arrayContaining([
    'rpc_error', 'partial_stream', 'slow', 'messages_dropped', 'large_payload',
  ]));

  const pending = analyzeAuditEntry(summary({
    entryId: 2, method: '/demo.Service/Wait', timing: { requestTimestamp: NOW - 31000 },
  }), { now: NOW, fullEntry: null });
  expect(pending.signals.map(signal => signal.id)).toContain('pending');
});

test('builds a chronological paste-ready audit with filter context and repeated failure clues', () => {
  const entries = [
    {
      entryId: 1, requestId: 1, method: '/demo.Service/Watched', methodType: 'unary', transport: 'connect-web',
      backendUrl: 'https://api.example.test?tenant=blue#secret', location: 'https://app.example.test/page?session=abc',
      request: { query: 'safe', authorization: 'Bearer exact-secret' }, response: { ok: true }, terminalPhase: 'complete',
      timing: { requestTimestamp: NOW - 9000, completionTimestamp: NOW - 8000, duration: 1000 }, payloadBytes: 80,
    },
    {
      entryId: 2, requestId: 2, method: '/demo.Service/Fail', methodType: 'unary', transport: 'grpc-web',
      backendUrl: 'https://api.example.test', request: { token: 'must-not-leak', id: 7 },
      error: { code: 14, message: 'backend unavailable' }, terminalPhase: 'error',
      replay: { token: 'replay-capability-must-not-leak' },
      timing: { requestTimestamp: NOW - 7000, completionTimestamp: NOW - 6000, duration: 1000 }, payloadBytes: 100,
    },
    {
      entryId: 3, requestId: 3, method: '/demo.Service/Fail', methodType: 'unary', transport: 'grpc-web',
      backendUrl: 'https://api.example.test', request: { id: 8 },
      error: { code: 'UNAVAILABLE', message: 'still unavailable' }, terminalPhase: 'error',
      timing: { requestTimestamp: NOW - 4000, completionTimestamp: NOW - 3000, duration: 1000 }, payloadBytes: 100,
    },
  ];
  const report = build(entries, { filterValue: 'Watched', filteredEntries: [entries[0]] });

  expect(report.text).toMatch(/^# gRPC-Web Audit Report/);
  expect(report.text).toContain('Repeated failure: 2 × `UNAVAILABLE`');
  expect(report.text).toContain('Check backend health');
  expect(report.text).toContain('Source page: `https://app.example.test/page?session=%5Bredacted%5D`');
  expect(report.text).toContain('/demo.Service/Watched');
  expect(report.text.indexOf('/demo.Service/Watched')).toBeLessThan(report.text.lastIndexOf('/demo.Service/Fail'));
  expect(report.text).toContain('%5Bredacted%5D');
  expect(report.text).toContain('[redacted]');
  expect(report.text).not.toContain('exact-secret');
  expect(report.text).not.toContain('must-not-leak');
  expect(report.stats).toEqual(expect.objectContaining({ matched: 3, included: 3 }));
});

test('selects only the newest bounded set of failures and keeps the total file bounded', () => {
  const entries = Array.from({ length: MAX_AUDIT_REQUESTS + 5 }, (_, index) => ({
    entryId: index + 1,
    requestId: index + 1,
    method: `/demo.Service/Fail${index + 1}`,
    transport: 'grpc-web',
    request: { body: 'x'.repeat(50000) },
    error: { code: 13, message: 'internal' },
    terminalPhase: 'error',
    timing: { requestTimestamp: NOW - 100000 + index * 1000, completionTimestamp: NOW - 99000 + index * 1000, duration: 1000 },
    payloadBytes: 50000,
  }));
  const report = build(entries);
  const detailedRequests = report.text.slice(report.text.indexOf('## Detailed requests'));

  expect(report.stats.matched).toBe(MAX_AUDIT_REQUESTS + 5);
  expect(report.stats.included).toBe(MAX_AUDIT_REQUESTS);
  expect(detailedRequests).not.toContain('· /demo.Service/Fail1\n');
  expect(detailedRequests).toContain(`/demo.Service/Fail${MAX_AUDIT_REQUESTS + 5}`);
  expect(report.bytes).toBeLessThanOrEqual(MAX_AUDIT_REPORT_BYTES);
  expect(utf8ByteLength(report.text)).toBe(report.bytes);
});

test('marks evicted evidence explicitly and never serializes summary booleans as payloads', () => {
  const evictedSummary = summary({
    entryId: 99, requestId: 99, method: '/demo.Service/Evicted', transport: 'grpc-web',
    request: { existed: true }, error: { code: 13 }, terminalPhase: 'error',
    timing: { requestTimestamp: NOW - 2000, completionTimestamp: NOW - 1000, duration: 1000 },
  });
  const report = buildAuditReport({
    allEntries: [evictedSummary],
    getEntry: () => undefined,
    now: new Date(NOW),
    version: 'test',
  });
  expect(report.text).toContain('evicted from the bounded inspector cache');
  expect(report.text).not.toContain('```json\ntrue\n```');
});

test('bounded JSON handles cycles, deep values, UTF-8, truncation previews, and source immutability', () => {
  const source = {
    authorization: 'Bearer private-token',
    authToken: 'opaque-auth-secret',
    auth: 'opaque-short-auth-secret',
    'x-api-key': 'opaque-api-secret',
    secretAccessKey: 'opaque-cloud-secret',
    secretKey: 'opaque-secret-key',
    passphrase: 'opaque-passphrase',
    truncated: { __truncated: true, __originalSizeBytes: 900000, preview: 'private-preview' },
  };
  source.self = source;
  source.nested = { emoji: '🐈'.repeat(5000) };
  const formatted = formatBoundedJson(source, 2048);

  expect(utf8ByteLength(formatted)).toBeLessThanOrEqual(2048);
  expect(formatted).toContain('[redacted]');
  expect(formatted).toContain('circular');
  expect(formatted).not.toContain('private-token');
  expect(formatted).not.toContain('opaque-auth-secret');
  expect(formatted).not.toContain('opaque-short-auth-secret');
  expect(formatted).not.toContain('opaque-api-secret');
  expect(formatted).not.toContain('opaque-cloud-secret');
  expect(formatted).not.toContain('opaque-secret-key');
  expect(formatted).not.toContain('opaque-passphrase');
  expect(formatted).not.toContain('private-preview');
  expect(source.authorization).toBe('Bearer private-token');
  expect(source.truncated.preview).toBe('private-preview');
});

test('redacts URL userinfo as well as query values and fragments', () => {
  const entry = {
    entryId: 1, requestId: 1, method: '/demo.Service/Fail', transport: 'grpc-web',
    backendUrl: 'https://alice:supersecret@example.test/rpc?apiKey=value#private-fragment-value',
    error: { code: 13, message: 'failed' }, terminalPhase: 'error',
    timing: { requestTimestamp: NOW - 2000, completionTimestamp: NOW - 1000, duration: 1000 },
  };
  const report = build([entry]);
  expect(report.text).not.toContain('alice');
  expect(report.text).not.toContain('supersecret');
  expect(report.text).not.toContain('private-fragment-value');
  expect(report.text).toContain('redacted');
});

test('redacts URL secrets in methods, payload text, errors, status details, and filter context', () => {
  const entry = {
    entryId: 1,
    requestId: 1,
    method: 'https://api.test/Call?access_token=METHOD_LEAK#METHOD_FRAGMENT_LEAK',
    transport: 'grpc-web',
    request: {
      note: 'fetch https://api.test/input?api_key=PAYLOAD_URL_LEAK#PAYLOAD_FRAGMENT_LEAK',
      relative: 'failed /api/input?access_token=RELATIVE_URL_LEAK#RELATIVE_FRAGMENT_LEAK',
      bareRelative: 'failed api/input?token=BARE_RELATIVE_LEAK#BARE_FRAGMENT_LEAK',
      dotRelative: 'failed ./api/input?token=DOT_RELATIVE_LEAK#DOT_FRAGMENT_LEAK',
      parentRelative: 'failed ../api/input?token=PARENT_RELATIVE_LEAK#PARENT_FRAGMENT_LEAK',
      singleSegment: 'failed login?token=SINGLE_SEGMENT_LEAK#SINGLE_FRAGMENT_LEAK',
      queryOnly: 'failed ?token=QUERY_ONLY_LEAK#QUERY_FRAGMENT_LEAK',
    },
    error: { code: 13, message: 'failed at https://api.test/output?token=ERROR_URL_LEAK#ERROR_FRAGMENT_LEAK' },
    status: { code: 13, details: 'see https://api.test/status?secret=STATUS_URL_LEAK#STATUS_FRAGMENT_LEAK' },
    terminalPhase: 'error',
    timing: { requestTimestamp: NOW - 2000, completionTimestamp: NOW - 1000, duration: 1000 },
  };
  const report = build([entry], {
    filterValue: 'token=FILTER_LEAK',
    filteredEntries: [entry],
  });

  [
    'METHOD_LEAK', 'METHOD_FRAGMENT_LEAK', 'PAYLOAD_URL_LEAK', 'PAYLOAD_FRAGMENT_LEAK',
    'ERROR_URL_LEAK', 'ERROR_FRAGMENT_LEAK', 'STATUS_URL_LEAK', 'STATUS_FRAGMENT_LEAK',
    'RELATIVE_URL_LEAK', 'RELATIVE_FRAGMENT_LEAK', 'BARE_RELATIVE_LEAK', 'BARE_FRAGMENT_LEAK',
    'DOT_RELATIVE_LEAK', 'DOT_FRAGMENT_LEAK', 'PARENT_RELATIVE_LEAK', 'PARENT_FRAGMENT_LEAK',
    'SINGLE_SEGMENT_LEAK', 'SINGLE_FRAGMENT_LEAK', 'QUERY_ONLY_LEAK', 'QUERY_FRAGMENT_LEAK',
    'FILTER_LEAK',
  ].forEach(secret => expect(report.text).not.toContain(secret));
  expect(report.text).toContain('filter text omitted');
});

test('does not rewrite ordinary question-mark prose as a relative URL', () => {
  const formatted = formatBoundedJson({
    first: 'Why? retry later',
    second: 'failed? try again',
    third: 'question ? retry',
  });

  expect(formatted).toContain('Why? retry later');
  expect(formatted).toContain('failed? try again');
  expect(formatted).toContain('question ? retry');
});

test('enforces the total UTF-8 byte cap even when metadata-only timeline text is multibyte', () => {
  const entries = Array.from({ length: 50 }, (_, index) => ({
    entryId: index + 1,
    requestId: index + 1,
    method: '/demo.Service/Complete',
    transport: 'ࠀ'.repeat(4000),
    terminalPhase: 'complete',
    response: { ok: true },
    timing: {
      requestTimestamp: NOW - 100000 + index * 1000,
      completionTimestamp: NOW - 99500 + index * 1000,
      duration: 500,
    },
  }));
  const report = build(entries);

  expect(report.stats.included).toBe(0);
  expect(report.bytes).toBeLessThanOrEqual(MAX_AUDIT_REPORT_BYTES);
  expect(report.text).toContain('Report body truncated');
});

test('bounds oversized error codes before analysis without dropping the request evidence', () => {
  const entry = {
    entryId: 1,
    requestId: 1,
    method: '/demo.Service/Fail',
    transport: 'grpc-web',
    error: { code: 'X'.repeat(600000), message: 'failed' },
    terminalPhase: 'error',
    timing: { requestTimestamp: NOW - 2000, completionTimestamp: NOW - 1000, duration: 1000 },
  };
  const report = build([entry]);

  expect(report.stats.included).toBe(1);
  expect(report.bytes).toBeLessThanOrEqual(MAX_AUDIT_REPORT_BYTES);
});

test('contains untrusted method and status text inside Markdown-safe inline code', () => {
  const entry = {
    entryId: 1,
    requestId: 1,
    method: '/demo.Service/Fail\n\nFake diagnosis',
    transport: 'grpc-web',
    error: { code: 13, message: 'failed' },
    status: { code: 13, details: 'server detail\n\n# Fake status section' },
    terminalPhase: 'error',
    timing: { requestTimestamp: NOW - 2000, completionTimestamp: NOW - 1000, duration: 1000 },
  };
  const report = build([entry]);

  expect(report.text).not.toContain('\nFake diagnosis');
  expect(report.text).not.toContain('\n# Fake status section');
  expect(report.text).toContain('`/demo.Service/Fail Fake diagnosis`');
  expect(report.text).toContain('`server detail # Fake status section`');
});

test('selects the newest timeline entries by capture time rather than arrival order', () => {
  const newest = {
    entryId: 1,
    requestId: 1,
    method: '/demo.Service/ActualNewest',
    transport: 'grpc-web',
    response: { ok: true },
    terminalPhase: 'complete',
    timing: { requestTimestamp: NOW - 1, completionTimestamp: NOW, duration: 1 },
  };
  const older = Array.from({ length: 50 }, (_, index) => ({
    entryId: index + 2,
    requestId: index + 2,
    method: `/demo.Service/Old${index}`,
    transport: 'grpc-web',
    response: { ok: true },
    terminalPhase: 'complete',
    timing: {
      requestTimestamp: NOW - 100000 + index * 1000,
      completionTimestamp: NOW - 99500 + index * 1000,
      duration: 500,
    },
  }));
  const report = build([newest, ...older]);

  expect(report.text).toContain('/demo.Service/ActualNewest');
  expect(report.text).not.toContain('/demo.Service/Old0');
});

test('prioritizes RPC errors over newer warning-only requests', () => {
  const error = {
    entryId: 1,
    requestId: 1,
    method: '/demo.Service/OlderError',
    transport: 'grpc-web',
    error: { code: 13, message: 'failed' },
    terminalPhase: 'error',
    timing: { requestTimestamp: NOW - 100000, completionTimestamp: NOW - 99000, duration: 1000 },
  };
  const slow = Array.from({ length: MAX_AUDIT_REQUESTS }, (_, index) => ({
    entryId: index + 2,
    requestId: index + 2,
    method: `/demo.Service/Slow${index}`,
    transport: 'grpc-web',
    response: { ok: true },
    terminalPhase: 'complete',
    timing: {
      requestTimestamp: NOW - 50000 + index * 1000,
      completionTimestamp: NOW - 47000 + index * 1000,
      duration: 3000,
    },
  }));
  const report = build([error, ...slow]);
  const details = report.text.slice(report.text.indexOf('## Detailed requests'));

  expect(details).toContain('/demo.Service/OlderError');
});

test('reserves detail capacity for the active filter during a large unrelated error burst', () => {
  const errors = Array.from({ length: MAX_AUDIT_REQUESTS }, (_, index) => ({
    entryId: index + 1, requestId: index + 1, method: `/demo.Service/Fail${index + 1}`, transport: 'grpc-web',
    error: { code: 13, message: 'failed' }, terminalPhase: 'error',
    timing: { requestTimestamp: NOW - 100000 + index * 1000, completionTimestamp: NOW - 99000 + index * 1000, duration: 1000 },
  }));
  const watched = {
    entryId: 100, requestId: 100, method: '/demo.Service/WatchedSuccess', transport: 'connect-web',
    response: { ok: true }, terminalPhase: 'complete',
    timing: { requestTimestamp: NOW - 500, completionTimestamp: NOW - 100, duration: 400 },
  };
  const report = build([...errors, watched], { filterValue: 'Watched', filteredEntries: [watched] });
  const detailedRequests = report.text.slice(report.text.indexOf('## Detailed requests'));
  expect(report.stats.included).toBe(MAX_AUDIT_REQUESTS);
  expect(detailedRequests).toContain('/demo.Service/WatchedSuccess');
});

test('uses a filesystem-safe source URL, millisecond timestamp, and unique ID in the filename', () => {
  const filename = getAuditReportFilename(
    new Date(NOW),
    'https://alice:secret@app.example.test:8443/orders/123?token=private#fragment',
    '550e8400-e29b-41d4-a716-446655440000',
  );

  expect(filename).toBe('grpc-web-audit-app-example-test-8443-2026-08-25T14-30-00-000Z-550e8400-e29b-41d4-a716-446655440000.md');
  expect(filename).not.toMatch(/[<>:"/\\|?*]/);
  expect(filename).not.toContain('alice');
  expect(filename).not.toContain('orders');
  expect(filename).not.toContain('private');
});

test('distinguishes retained and evicted network failures from coded RPC errors', () => {
  const networkEntry = {
    entryId: 10,
    method: '/demo.Service/Blocked',
    error: { message: 'Failed to fetch', isNetworkError: true },
    terminalPhase: 'error',
    timing: { requestTimestamp: NOW - 2000, completionTimestamp: NOW - 1000, duration: 1000 },
  };
  const retained = analyzeAuditEntry(summary(networkEntry), { now: NOW, fullEntry: networkEntry });
  const evicted = analyzeAuditEntry(summary(networkEntry), { now: NOW, fullEntry: null });
  const codedEntry = {
    ...networkEntry,
    entryId: 11,
    error: { code: 14, message: 'unavailable', isNetworkError: true },
  };
  const coded = analyzeAuditEntry(summary(codedEntry), { now: NOW, fullEntry: codedEntry });

  [retained, evicted].forEach(analysis => {
    expect(analysis.isNetworkError).toBe(true);
    expect(analysis.signals.map(signal => signal.id)).toContain('network_error');
    expect(analysis.signals.map(signal => signal.id)).not.toContain('rpc_error');
  });
  expect(coded.isNetworkError).toBe(false);
  expect(coded.code).toBe('UNAVAILABLE');
  expect(coded.signals.map(signal => signal.id)).toContain('rpc_error');

  const report = build([networkEntry]);
  expect(report.text).toContain('Network failure (no gRPC status captured)');
  expect(report.text).toContain('NETWORK_ERROR (no gRPC status captured)');
  expect(report.text).not.toContain('RPC error');
  expect(report.text).not.toContain('UNMAPPED_ERROR');
});

test('falls back safely when source context is unavailable and gives same-millisecond reports distinct names', () => {
  const first = getAuditReportFilename(new Date(NOW), 'not a URL');
  const second = getAuditReportFilename(new Date(NOW), 'not a URL');

  expect(first).toMatch(/^grpc-web-audit-unknown-source-2026-08-25T14-30-00-000Z-[a-z0-9-]+\.md$/);
  expect(second).not.toBe(first);
});
