import {
  DEBUG_REPORT_SCHEMA,
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
  backendUrl: 'https://api.example.test/demo.Service/GetThing?tenant=blue',
  timing: {
    requestTimestamp: Date.UTC(2026, 7, 8, 1, 2, 3, 4),
    completionTimestamp: Date.UTC(2026, 7, 8, 1, 2, 4, 254),
    duration: 1250,
    timeToFirstMessage: 50,
    messageCount: 3,
  },
  terminalPhase: 'error',
  status: { code: 13, details: 'internal' },
  request: { authorization: 'exact-secret', query: '```' },
  response: { partial: true },
  messages: [{ id: 1 }, { id: 2 }],
  error: { code: 'INTERNAL' },
  messageCount: 3,
  droppedMessageCount: 1,
  payloadBytes: 512,
  replay: { available: true, token: 'must-not-be-copied' },
  replayedFrom: { captureId: 'frame-z', transport: 'connect-web', requestId: 6, token: 'also-secret' },
};

test('builds a full locale-neutral transaction without replay capability tokens', () => {
  const report = buildDebugReport(fullEntry, {
    inspectorVersion: '1.6.0',
    userAgent: 'Test Browser/1.0',
  });

  expect(report.schema).toBe(DEBUG_REPORT_SCHEMA);
  expect(report.environment).toEqual({ inspector_version: '1.6.0', user_agent: 'Test Browser/1.0' });
  expect(report.rpc).toEqual(expect.objectContaining({
    method: '/demo.Service/GetThing',
    transport: 'connect-web',
    frame_url: 'https://app.example.test/frame?token=exact-value',
    backend_url: 'https://api.example.test/demo.Service/GetThing?tenant=blue',
  }));
  expect(report.timing).toEqual({
    started_at: '2026-08-08T01:02:03.004Z',
    completed_at: '2026-08-08T01:02:04.254Z',
    duration_ms: 1250,
    time_to_first_message_ms: 50,
  });
  expect(report.result).toEqual(expect.objectContaining({
    terminal_phase: 'error',
    message_count: 3,
    retained_message_count: 2,
    dropped_message_count: 1,
  }));
  expect(report.capture_state).toEqual({
    payload_bytes: 512,
    request_payload: 'available',
    response_payload: 'available',
  });
  expect(report.request.authorization).toBe('exact-secret');
  expect(report.messages).toEqual([{ id: 1 }, { id: 2 }]);
  expect(report.replayed_from).toEqual({ capture_id: 'frame-z', transport: 'connect-web', request_id: 6 });
  expect(JSON.stringify(report)).not.toContain('must-not-be-copied');
  expect(JSON.stringify(report)).not.toContain('also-secret');
});

test('represents truncated and evicted payloads without reconstructing summary booleans', () => {
  const truncated = buildDebugReport({
    request: { __truncated: true, preview: '{"id":1}' },
    response: { __truncated: true, preview: '{"ok":true}' },
  }, { inspectorVersion: null, userAgent: null });
  expect(truncated.capture_state.request_payload).toBe('truncated');
  expect(truncated.capture_state.response_payload).toBe('truncated');
  expect(truncated.request.preview).toBe('{"id":1}');

  const evicted = buildDebugReport({ request: true, response: true, status: true }, {
    requestPayloadMissing: true,
    responsePayloadMissing: true,
    inspectorVersion: null,
    userAgent: null,
  });
  expect(evicted.capture_state.request_payload).toBe('evicted');
  expect(evicted.capture_state.response_payload).toBe('evicted');
  expect(evicted.request).toBeNull();
  expect(evicted.response).toBeNull();
  expect(evicted.result.status).toBeNull();
});

test('formats deterministic JSON and readable Markdown with safe fences', () => {
  const report = buildDebugReport(fullEntry, { inspectorVersion: '1.6.0', userAgent: 'Browser' });
  const json = formatDebugReportJson(report);
  const markdown = formatDebugReportMarkdown(report);

  expect(json).toBe(formatDebugReportJson(report));
  expect(json.endsWith('\n')).toBe(true);
  expect(markdown).toContain('# gRPC Debug Report');
  expect(markdown).toContain('| method | /demo.Service/GetThing |');
  expect(markdown).toContain('## request');
  expect(markdown).toContain('````json');
  expect(markdown).toContain('"authorization": "exact-secret"');
  expect(markdown.endsWith('\n')).toBe(true);
});

test('marks pending captures as missing without inventing result values', () => {
  const report = buildDebugReport({
    method: '/demo.Service/Pending',
    request: { id: 1 },
    timing: { requestTimestamp: 1000 },
  }, { inspectorVersion: null, userAgent: null });

  expect(report.capture_state.request_payload).toBe('available');
  expect(report.capture_state.response_payload).toBe('missing');
  expect(report.timing.completed_at).toBeNull();
  expect(report.result.terminal_phase).toBeNull();
  expect(report.result.status).toBeNull();
});

