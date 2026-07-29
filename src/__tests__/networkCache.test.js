import { addNetworkEntry, clearNetworkCache, getCacheDebugState } from '../state/networkCache';

afterEach(() => clearNetworkCache());

test('bounds each payload before cache storage', () => {
  const entry = addNetworkEntry({ captureId: 'frame', transport: 'grpc-web', requestId: 1, phase: 'start', request: { body: 'x'.repeat(5 * 1024 * 1024 + 1) } });
  expect(entry.request).toEqual(expect.objectContaining({ __truncated: true, __originalSizeBytes: expect.any(Number) }));
  expect(entry.request.preview).toHaveLength(2000);
});

test('retains bounded ordered stream history and terminal error within aggregate budget', () => {
  addNetworkEntry({ captureId: 'frame', transport: 'connect-web', requestId: 1, phase: 'start', request: { input: true } });
  let entry;
  for (let index = 1; index <= 110; index += 1) {
    entry = addNetworkEntry({ captureId: 'frame', transport: 'connect-web', requestId: 1, phase: 'message', response: { index, body: 'x'.repeat(60000) }, timing: { messageCount: index } });
  }
  entry = addNetworkEntry({ captureId: 'frame', transport: 'connect-web', requestId: 1, phase: 'error', error: { message: 'after data' } });
  expect(entry.messages.length).toBeGreaterThan(0);
  expect(entry.messages.length).toBeLessThanOrEqual(100);
  expect(entry.messages[0].index).toBeGreaterThan(1);
  expect(entry.messageCount).toBe(110);
  expect(entry.droppedMessageCount).toBeGreaterThan(0);
  expect(entry.error).toEqual({ message: 'after data' });
  expect(entry.payloadBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
});

test('uses frame-aware cache identities and prunes mappings on eviction', () => {
  addNetworkEntry({ captureId: 'frame-a', transport: 'grpc-web', requestId: 1, phase: 'start' });
  addNetworkEntry({ captureId: 'frame-b', transport: 'grpc-web', requestId: 1, phase: 'start' });
  expect(getCacheDebugState()).toEqual({ size: 2, mappings: 2 });
  for (let index = 0; index < 500; index += 1) addNetworkEntry({ captureId: 'extra', transport: 'grpc-web', requestId: index + 2, phase: 'start' });
  expect(getCacheDebugState()).toEqual({ size: 500, mappings: 500 });
});

test('retains only clone-safe replay metadata with the bounded request entry', () => {
  const replay = { available: true, token: 'opaque-token' };
  const replayedFrom = { captureId: 'frame-a', transport: 'grpc-web', requestId: 4 };
  const backendUrl = 'https://api.example.test/demo.Service/GetThing';
  let entry = addNetworkEntry({ captureId: 'frame-b', transport: 'grpc-web', requestId: 5, phase: 'start', backendUrl, replay, replayedFrom });
  entry = addNetworkEntry({ captureId: 'frame-b', transport: 'grpc-web', requestId: 5, phase: 'complete', response: { ok: true }, replayedFrom });
  expect(entry.backendUrl).toBe(backendUrl);
  expect(entry.replay).toEqual(replay);
  expect(entry.replayedFrom).toEqual(replayedFrom);
  expect(JSON.stringify(entry)).not.toContain('function');
});
