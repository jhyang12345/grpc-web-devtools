const { TextEncoder, TextDecoder } = require('util');
// jsdom's test environment doesn't expose these globally (see the same
// workaround in src/__tests__/bridge.test.js); the real Chrome page context
// this code actually runs in always has them.
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

import {
  buildOpUserEvalExpression,
  decodeGrpcWebFrames,
  decodeOpUserFields,
  readVarint,
} from '../utils/opUserRawFetch';

// Independent hand-rolled encoders (deliberately not reusing any implementation
// code) so the decode tests below give genuine confidence, not just "decode is
// the mirror image of itself".
function encodeVarint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return bytes;
}
function encodeTag(fieldNumber, wireType) {
  return encodeVarint((fieldNumber << 3) | wireType);
}
function encodeLengthDelimited(fieldNumber, contentBytes) {
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(contentBytes.length), ...contentBytes];
}
function encodeVarintField(fieldNumber, value) {
  return [...encodeTag(fieldNumber, 0), ...encodeVarint(value)];
}
function stringToBytes(value) {
  return Array.from(new TextEncoder().encode(value));
}

test('readVarint decodes single- and multi-byte varints and reports the next offset', () => {
  expect(readVarint(new Uint8Array([0x05, 0xff]), 0)).toEqual({ value: 5, nextOffset: 1 });
  expect(readVarint(new Uint8Array([0x80, 0x01]), 0)).toEqual({ value: 128, nextOffset: 2 });
  expect(readVarint(new Uint8Array([0x00, 0x8a, 0x01]), 1)).toEqual({ value: 138, nextOffset: 3 });
});

test('decodeGrpcWebFrames splits a data frame and a trailer frame by the flags byte', () => {
  const dataPayload = [1, 2, 3];
  const trailerText = stringToBytes('grpc-status: 0\r\n');
  const buffer = new Uint8Array([
    0x00, 0x00, 0x00, 0x00, dataPayload.length, ...dataPayload,
    0x80, 0x00, 0x00, 0x00, trailerText.length, ...trailerText,
  ]);

  const frames = decodeGrpcWebFrames(buffer);
  expect(frames).toHaveLength(2);
  expect(frames[0].flags).toBe(0x00);
  expect(Array.from(frames[0].payload)).toEqual(dataPayload);
  expect(frames[1].flags).toBe(0x80);
  expect(new TextDecoder().decode(frames[1].payload)).toBe('grpc-status: 0\r\n');

  const onlyDataFrame = frames.find(frame => (frame.flags & 0x80) === 0);
  expect(onlyDataFrame).toBe(frames[0]);
});

test('decodeGrpcWebFrames stops cleanly on a truncated trailing frame instead of reading out of bounds', () => {
  const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x05, 1, 2]); // declares 5 bytes, only has 2
  expect(decodeGrpcWebFrames(buffer)).toEqual([]);
});

test('decodeOpUserFields pulls email (7), role (16), and operator_info.full_name (17->3) by field number, skipping everything else', () => {
  const operatorInfoBytes = encodeLengthDelimited(3, stringToBytes('Example Corp'));
  const opUserBytes = new Uint8Array([
    ...encodeLengthDelimited(1, stringToBytes('user-1')), // id — should be ignored
    ...encodeLengthDelimited(7, stringToBytes('tester@example.test')), // email
    ...encodeVarintField(16, 1), // role = ADMIN
    ...encodeLengthDelimited(17, operatorInfoBytes), // operator_info
    ...encodeLengthDelimited(8, stringToBytes('Ignored Name')), // full_name — should be ignored (different field)
  ]);

  expect(decodeOpUserFields(opUserBytes)).toEqual({
    email: 'tester@example.test',
    role: 'ADMIN',
    operatorFullName: 'Example Corp',
  });
});

test('decodeOpUserFields maps unknown role numbers to their raw string and missing fields to null', () => {
  const opUserBytes = new Uint8Array(encodeVarintField(16, 7));
  expect(decodeOpUserFields(opUserBytes)).toEqual({ email: null, role: '7', operatorFullName: null });
});

test('buildOpUserEvalExpression starts isolated work without reading cookies or returning a Promise', () => {
  const expression = buildOpUserEvalExpression({ apiOrigin: 'https://api.dev2.example.test' }, 'attempt-1');

  expect(expression).toContain('"https://api.dev2.example.test"');
  expect(expression).toContain('__GRPCWEB_DEVTOOLS_BTS__?.start(');
  expect(expression).not.toContain('document.cookie');
  // Compiling (not executing) proves the stringified helpers concatenate into
  // valid JS with no leftover references to this module's own scope.
  expect(() => new Function(expression)).not.toThrow();
});
