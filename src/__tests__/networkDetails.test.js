jest.mock('../replayBridge', () => ({
  ...jest.requireActual('../replayBridge'),
  sendReplayRequest: jest.fn(),
}));

import { buildResponseSource, formatDuration, formatTimestamp, formatEditedRequest, formatReplayProvenance, getReplayDisabledReason, NetworkDetails, parseEditedRequest } from '../components/NetworkDetails';
import { sendReplayRequest } from '../replayBridge';

beforeEach(() => {
  sendReplayRequest.mockReset();
});

function makeReplayEditor() {
  const component = new NetworkDetails({ showToast: jest.fn() });
  component._isMounted = true;
  component.setState = (next) => {
    const update = typeof next === 'function' ? next(component.state) : next;
    component.state = { ...component.state, ...update };
  };
  component.requestEditorInputRef.current = { value: '{"value":1}' };
  return component;
}

function replayEntry(entryId, value = 1) {
  return {
    entryId, captureId: `frame-${entryId}`, transport: 'grpc-web', request: { value }, replay: { available: true, token: `opaque-${entryId}` },
  };
}

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
  const component = makeReplayEditor();
  const { showToast } = component.props;
  component._activeReplayEntry = replayEntry(7);
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

test('stale replay settlement cannot clear a newer entry submission and unmount ignores settlement', async () => {
  const component = makeReplayEditor();
  component._activeReplayEntry = replayEntry('a');
  let resolveA;
  let resolveB;
  sendReplayRequest
    .mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveB = resolve; }));

  const replayA = component._sendEditedRequest();
  component._clearRequestHighlights = jest.fn();
  component._clearResponseHighlights = jest.fn();
  component.props = { ...component.props, entry: replayEntry('b', 2) };
  component.state = { ...component.state, lastEntryId: 'a' };
  component.componentDidUpdate({ entry: replayEntry('a') });
  component._activeReplayEntry = replayEntry('b', 2);
  component.requestEditorInputRef.current.value = '{"value":2}';
  const replayB = component._sendEditedRequest();
  await component._sendEditedRequest();
  expect(sendReplayRequest).toHaveBeenCalledTimes(2);
  expect(component.state.isReplaySending).toBe(true);

  resolveA({});
  await replayA;
  expect(component.state.isReplaySending).toBe(true);
  await component._sendEditedRequest();
  expect(sendReplayRequest).toHaveBeenCalledTimes(2);

  const setState = jest.fn(component.setState);
  component.setState = setState;
  component._clearRequestHighlights = jest.fn();
  component._clearResponseHighlights = jest.fn();
  component.componentWillUnmount();
  resolveB({});
  await replayB;
  expect(setState).not.toHaveBeenCalled();
});
