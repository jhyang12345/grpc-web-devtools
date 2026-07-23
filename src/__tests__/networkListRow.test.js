import { formatElapsed, formatFrameUrl, formatReplayProvenance, formatReplayTiming } from '../components/NetworkListRow';

test('formats a compact frame URL while retaining a safe fallback for malformed values', () => {
  expect(formatFrameUrl('https://iframe.example.test:8443/api/v1/rpc?debug=1')).toBe('iframe.example.test:8443/api/v1/rpc?debug=1');
  expect(formatFrameUrl('not a URL')).toBe('not a URL');
  expect(formatFrameUrl()).toBe('Frame URL unavailable');
});

test('formats pending-completion elapsed values compactly', () => {
  expect(formatElapsed(42.2)).toBe('42 ms');
  expect(formatElapsed(1250)).toBe('1.25 s');
  expect(formatElapsed(-1)).toBe('0 ms');
});

test('formats replay provenance as a label rather than an entry link', () => {
  expect(formatReplayProvenance({ transport: 'grpc-web', requestId: 9 })).toBe('Retry of grpc-web request 9');
  expect(formatReplayProvenance({})).toBe('Retry of an earlier request');
});

test('keeps start time and duration alongside the compact replay marker', () => {
  expect(formatReplayTiming('12:34:56.789', '42 ms', { transport: 'grpc-web', requestId: 9 }))
    .toBe('↻ grpc-web #9 · 12:34:56.789 · 42 ms');
  expect(formatReplayTiming('12:34:56.789', 'Pending')).toBe('12:34:56.789 · Pending');
});
