import { createReplayBridge, MAX_REPLAY_BYTES, REPLAY_TRANSPORTS, validateReplayRequest, validateReplayRoute } from '../replayBridge';

const makePort = () => ({ postMessage: jest.fn() });

test('replay bridge posts an addressed command and resolves only its matching acknowledgement', async () => {
  const port = makePort();
  const bridge = createReplayBridge();
  bridge.configure(port);
  const pending = bridge.send({ captureId: 'frame-a', replayToken: 'token-a', sourceEntryId: 17, transport: 'grpc-web', request: { value: 1 } });
  const command = port.postMessage.mock.calls[0][0];
  expect(command).toEqual({
    action: 'replay_request', target: 'content',
    data: expect.objectContaining({ captureId: 'frame-a', replayToken: 'token-a', sourceEntryId: 17, transport: 'grpc-web', request: { value: 1 }, replayAttemptId: expect.any(String) }),
  });
  expect(bridge.handleMessage('replay_ack', { replayAttemptId: 'other-attempt' })).toBe(false);
  expect(bridge.pendingCount()).toBe(1);
  expect(bridge.handleMessage('replay_ack', { replayAttemptId: command.data.replayAttemptId, captureId: 'frame-a' })).toBe(true);
  await expect(pending).resolves.toEqual(expect.objectContaining({ captureId: 'frame-a' }));
});

test('replay bridge rejects matching rejections, timeouts, and disconnects', async () => {
  jest.useFakeTimers();
  const port = makePort();
  const bridge = createReplayBridge({ timeoutMs: 10 });
  bridge.configure(port);
  const rejected = bridge.send({ captureId: 'frame-a', replayToken: 'token-a', sourceEntryId: 1, transport: 'connect-web', request: { value: 1 } });
  const rejectedAttempt = port.postMessage.mock.calls[0][0].data.replayAttemptId;
  bridge.handleMessage('replay_rejected', { replayAttemptId: rejectedAttempt, reason: 'Token expired' });
  await expect(rejected).rejects.toThrow('Token expired');

  const timedOut = bridge.send({ captureId: 'frame-a', replayToken: 'token-b', sourceEntryId: 2, transport: 'connect-web', request: { value: 2 } });
  jest.advanceTimersByTime(10);
  await expect(timedOut).rejects.toThrow('timed out');

  const disconnected = bridge.send({ captureId: 'frame-a', replayToken: 'token-c', sourceEntryId: 3, transport: 'connect-web', request: { value: 3 } });
  bridge.disconnect();
  await expect(disconnected).rejects.toThrow('disconnected');
  jest.useRealTimers();
});

test('replay bridge enforces object shape, byte limit, and bounded pending commands before posting', async () => {
  const port = makePort();
  const bridge = createReplayBridge({ maxPending: 1 });
  bridge.configure(port);
  expect(validateReplayRequest([])).toBe('Request body must be a JSON object.');
  expect(validateReplayRequest({ value: 'x'.repeat(MAX_REPLAY_BYTES + 1) })).toBe('Request body exceeds the 5 MiB replay limit.');
  await expect(bridge.send({ captureId: 'frame-a', replayToken: 'token', sourceEntryId: 1, transport: 'grpc-web', request: [] })).rejects.toThrow('JSON object');
  expect(port.postMessage).not.toHaveBeenCalled();
  const first = bridge.send({ captureId: 'frame-a', replayToken: 'token', sourceEntryId: 1, transport: 'grpc-web', request: {} });
  await expect(bridge.send({ captureId: 'frame-a', replayToken: 'token', sourceEntryId: 2, transport: 'grpc-web', request: {} })).rejects.toThrow('Too many replay requests');
  bridge.disconnect();
  await expect(first).rejects.toThrow('disconnected');
});

test('replay bridge allocates collision-safe attempt IDs without overwriting pending callbacks', async () => {
  const port = makePort();
  const createAttemptId = jest.fn()
    .mockReturnValueOnce('same')
    .mockReturnValueOnce('same')
    .mockReturnValueOnce('next');
  const bridge = createReplayBridge({ createAttemptId });
  bridge.configure(port);
  const first = bridge.send({ captureId: 'frame-a', replayToken: 'token-a', sourceEntryId: 1, transport: 'grpc-web', request: {} });
  const second = bridge.send({ captureId: 'frame-a', replayToken: 'token-b', sourceEntryId: 2, transport: 'grpc-web', request: {} });
  expect(port.postMessage.mock.calls.map(([message]) => message.data.replayAttemptId)).toEqual(['same', 'next']);
  bridge.handleMessage('replay_ack', { replayAttemptId: 'same' });
  bridge.handleMessage('replay_ack', { replayAttemptId: 'next' });
  await expect(first).resolves.toEqual(expect.any(Object));
  await expect(second).resolves.toEqual(expect.any(Object));

  const exhaustedPort = makePort();
  const exhausted = createReplayBridge({ createAttemptId: () => 'same' });
  exhausted.configure(exhaustedPort);
  const pending = exhausted.send({ captureId: 'frame-a', replayToken: 'token-a', sourceEntryId: 1, transport: 'grpc-web', request: {} });
  await expect(exhausted.send({ captureId: 'frame-a', replayToken: 'token-b', sourceEntryId: 2, transport: 'grpc-web', request: {} })).rejects.toThrow('Unable to allocate');
  expect(exhaustedPort.postMessage).toHaveBeenCalledTimes(1);
  exhausted.disconnect();
  await expect(pending).rejects.toThrow('disconnected');
});

test('replay bridge rejects replaced-port work and invalid routing before posting', async () => {
  const firstPort = makePort();
  const secondPort = makePort();
  const bridge = createReplayBridge();
  bridge.configure(firstPort);
  const pending = bridge.send({ captureId: 'frame-a', replayToken: 'token-a', sourceEntryId: 1, transport: 'connect-web', request: {} });
  bridge.configure(secondPort);
  await expect(pending).rejects.toThrow('replaced');
  await expect(bridge.send({ captureId: '', replayToken: 'token', sourceEntryId: 1, transport: 'grpc-web', request: {} })).rejects.toThrow('originating frame');
  await expect(bridge.send({ captureId: 'frame-a', replayToken: '', sourceEntryId: 1, transport: 'grpc-web', request: {} })).rejects.toThrow('replay handle');
  await expect(bridge.send({ captureId: 'frame-a', replayToken: 'token', sourceEntryId: 1, transport: 'other', request: {} })).rejects.toThrow('transport');
  expect(secondPort.postMessage).not.toHaveBeenCalled();
  expect(validateReplayRoute({ captureId: 'frame-a', replayToken: 'token', transport: 'grpc-web' })).toBeNull();
  expect(validateReplayRoute({ captureId: 'frame-a', replayToken: 'token', transport: 'protobuf-ts' })).toBeNull();
  expect(REPLAY_TRANSPORTS).toEqual(['grpc-web', 'connect-web', 'protobuf-ts']);
});
