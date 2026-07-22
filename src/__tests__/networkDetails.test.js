import { buildResponseSource } from '../components/NetworkDetails';

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
