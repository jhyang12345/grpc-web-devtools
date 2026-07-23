import { formatElapsed, formatFrameUrl } from '../components/NetworkListRow';

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
