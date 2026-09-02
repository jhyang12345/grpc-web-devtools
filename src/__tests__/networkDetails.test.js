jest.mock('../replayBridge', () => ({
  ...jest.requireActual('../replayBridge'),
  sendReplayRequest: jest.fn(),
}));

import { buildResponseSource, formatDuration, formatTimestamp, formatEditedRequest, formatReplayProvenance, getBackendRequestUrl, getJsonViewerTheme, getReplayDisabledReason, getRequestEditorPaneSizes, NetworkDetails, parseEditedRequest } from '../components/NetworkDetails';
import { renderToStaticMarkup } from 'react-dom/server';
import { sendReplayRequest } from '../replayBridge';

beforeEach(() => {
  sendReplayRequest.mockReset();
  localStorage.clear();
});

function makeReplayEditor() {
  const component = new NetworkDetails({ showToast: jest.fn() });
  component._isMounted = true;
  component.setState = (next, callback) => {
    const update = typeof next === 'function' ? next(component.state) : next;
    component.state = { ...component.state, ...update };
    if (callback) callback();
  };
  component.requestEditorInputRef.current = { value: '{"value":1}', focus: jest.fn() };
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

test('metadata exposes the backend URL and leaves an obvious control when collapsed', () => {
  expect(getBackendRequestUrl({ backendUrl: 'https://api.example.test/demo.Service/GetThing' }))
    .toBe('https://api.example.test/demo.Service/GetThing');
  expect(getBackendRequestUrl({ method: '/demo.Service/GetThing' })).toBe('/demo.Service/GetThing');
  expect(getBackendRequestUrl({ method: 'Demo/GetThing' })).toBe('');

  const component = makeReplayEditor();
  const entry = {
    method: 'demo.Service/GetThing',
    backendUrl: 'https://api.example.test/demo.Service/GetThing',
    location: 'https://app.example.test/frame',
    transport: 'connect-web',
    timing: { requestTimestamp: 1000 },
  };
  const expandedMarkup = renderToStaticMarkup(component._renderMetadata(entry));
  expect(expandedMarkup).toContain('aria-expanded="true"');
  expect(expandedMarkup).toContain('Backend URL');
  expect(expandedMarkup).toContain('https://api.example.test/demo.Service/GetThing');

  component._toggleMetadata();
  const collapsedMarkup = renderToStaticMarkup(component._renderMetadata(entry));
  expect(collapsedMarkup).toContain('aria-expanded="false"');
  expect(collapsedMarkup).toContain('Show details');
  expect(collapsedMarkup).not.toContain('Backend URL');
  expect(localStorage.getItem('grpc-devtools-detailsMetadataExpanded')).toBe('false');
});

test('maps live color-scheme changes to the matching JSON viewer theme', () => {
  expect(getJsonViewerTheme(false)).toBe('rjv-default');
  expect(getJsonViewerTheme(true)).toBe('twilight');

  const component = makeReplayEditor();
  component._handleThemeChange({ matches: true });
  expect(component.state.jsonViewerTheme).toBe('twilight');
});

test('validates and formats locally edited replay JSON without accepting arrays or invalid text', () => {
  expect(parseEditedRequest('{')).toEqual({ error: 'Request body must contain valid JSON.' });
  expect(parseEditedRequest('[]')).toEqual({ error: 'Request body must be a JSON object.' });
  expect(formatEditedRequest('{"b":2,"a":1}')).toEqual({ request: { b: 2, a: 1 }, text: '{\n  "b": 2,\n  "a": 1\n}' });
});

test('request edit mode keeps actions above the editor and temporarily expands its pane', () => {
  expect(getRequestEditorPaneSizes([33, 67])).toEqual([70, 30]);
  expect(getRequestEditorPaneSizes([80, 20])).toEqual([80, 20]);
  expect(getRequestEditorPaneSizes(null)).toEqual([70, 30]);

  const component = makeReplayEditor();
  component.state = { ...component.state, paneSizes: [33, 67] };
  component._closeRequestSearch = jest.fn();
  component._clearRequestHighlights = jest.fn();
  component._openRequestEditor();

  expect(component.state.isEditingRequest).toBe(true);
  expect(component.state.paneSizes).toEqual([70, 30]);
  expect(component.requestEditorInputRef.current.focus).toHaveBeenCalled();

  const markup = renderToStaticMarkup(component._renderRequestPane(
    '{\n  "value": 1\n}',
    false,
    replayEntry(7)
  ));
  expect(markup).toContain('class="details-pane request-pane is-editing"');
  expect(markup).toContain('aria-label="Request editor actions"');
  expect(markup.indexOf('Send request')).toBeLessThan(markup.indexOf('Editable request JSON'));

  component._cancelRequestEditor();
  expect(component.state.isEditingRequest).toBe(false);
  expect(component.state.paneSizes).toEqual([33, 67]);
});

test('explains replay disabled states and renders plain provenance labels', () => {
  const entry = { request: { value: 1 }, replay: { available: true, token: 'opaque' }, captureId: 'frame-a', transport: 'grpc-web' };
  expect(getReplayDisabledReason(entry, false)).toBeNull();
  expect(getReplayDisabledReason({ ...entry, request: { __truncated: true } }, false)).toMatch(/truncated/);
  expect(getReplayDisabledReason({ ...entry, replay: { available: false, reason: 'Unavailable replay handle' } }, false)).toBe('Unavailable replay handle');
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
