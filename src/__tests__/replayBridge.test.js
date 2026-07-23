import { createReplayBridge, MAX_REPLAY_BYTES, validateReplayRequest } from '../replayBridge';

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
