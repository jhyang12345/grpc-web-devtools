import { buildResponseSource, formatDuration, formatTimestamp } from '../components/NetworkDetails';

test('response source renders stream messages, terminal errors, and status together', () => {
  expect(buildResponseSource(null, { message: 'after data' }, [{ item: 1 }], { code: 14, details: 'unavailable' }, false)).toEqual({
    messages: [{ item: 1 }],
    error: { message: 'after data' },
    status: { code: 14, details: 'unavailable' },
  });
});

test('evicted payload markers render an unavailable message instead of Redux booleans', () => {
  expect(buildResponseSource(true, true, true, true, true)).toEqual({ message: 'Full response payload is no longer available.' });
});

test('formats wall-clock times and monotonic elapsed values for detail metadata', () => {
  expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5, 6).getTime())).toBe('2026-01-02 03:04:05.006');
  expect(formatDuration(7.6)).toBe('8 ms');
  expect(formatDuration(1500)).toBe('1.50 s');
});
