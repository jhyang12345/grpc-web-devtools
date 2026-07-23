jest.mock('../replayBridge', () => ({
  ...jest.requireActual('../replayBridge'),
  sendReplayRequest: jest.fn(),
}));

import { buildResponseSource, formatDuration, formatTimestamp, formatEditedRequest, formatReplayProvenance, getReplayDisabledReason, NetworkDetails, parseEditedRequest } from '../components/NetworkDetails';
import { sendReplayRequest } from '../replayBridge';

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

test('validates and formats locally edited replay JSON without accepting arrays or invalid text', () => {
  expect(parseEditedRequest('{')).toEqual({ error: 'Request body must contain valid JSON.' });
  expect(parseEditedRequest('[]')).toEqual({ error: 'Request body must be a JSON object.' });
  expect(formatEditedRequest('{"b":2,"a":1}')).toEqual({ request: { b: 2, a: 1 }, text: '{\n  "b": 2,\n  "a": 1\n}' });
});

test('explains replay disabled states and renders plain provenance labels', () => {
  const entry = { request: { value: 1 }, replay: { available: true, token: 'opaque' }, captureId: 'frame-a', transport: 'grpc-web' };
  expect(getReplayDisabledReason(entry, false)).toBeNull();
  expect(getReplayDisabledReason({ ...entry, request: { __truncated: true } }, false)).toMatch(/truncated/);
  expect(getReplayDisabledReason({ ...entry, replay: { available: false, reason: 'Expired replay handle' } }, false)).toBe('Expired replay handle');
  expect(getReplayDisabledReason(entry, true)).toMatch(/no longer available/);
  expect(formatReplayProvenance({ transport: 'connect-web', requestId: 12 })).toBe('Retry of connect-web request 12');
});

test('request editor handler validates before dispatch and ignores synchronous double submits', async () => {
  const showToast = jest.fn();
  const component = new NetworkDetails({ showToast });
  component.setState = (next) => {
    const update = typeof next === 'function' ? next(component.state) : next;
    component.state = { ...component.state, ...update };
  };
  component.requestEditorInputRef.current = { value: '{"value":1}' };
  component._activeReplayEntry = {
    entryId: 7, captureId: 'frame-a', transport: 'grpc-web', request: { value: 1 }, replay: { available: true, token: 'opaque' },
  };
  let resolveReplay;
  sendReplayRequest.mockImplementation(() => new Promise(resolve => { resolveReplay = resolve; }));
  const first = component._sendEditedRequest();
  const second = component._sendEditedRequest();
  expect(sendReplayRequest).toHaveBeenCalledTimes(1);
  resolveReplay({});
  await Promise.all([first, second]);
  expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Replay accepted; watch the new request entry', type: 'info' }));

  component.requestEditorInputRef.current.value = '[]';
  await component._sendEditedRequest();
  expect(sendReplayRequest).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
});
