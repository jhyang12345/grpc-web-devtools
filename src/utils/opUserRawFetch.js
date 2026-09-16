// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.
//
// Closure-free helpers evaluated ONLY with useContentScriptContext:true.
// Credentials come from browser-observed network records, never page messages
// or document.cookie. The fixed RPC may change the path, not the API origin.

// Serialize the entire self-contained factory, not separately named helpers:
// production minification is allowed to rename all internal functions.
export function createOpUserFetcher() {
  function readVarint(bytes, offset) {
    let result = 0;
    let shift = 0;
    let position = offset;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const byte = bytes[position];
      position += 1;
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 63 || position > bytes.length) break;
    }
    return { value: result >>> 0, nextOffset: position };
  }

  function decodeGrpcWebFrames(bytes) {
    const frames = [];
    let offset = 0;
    while (offset + 5 <= bytes.length) {
      const flags = bytes[offset];
      const length = ((bytes[offset + 1] << 24) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 8) | bytes[offset + 4]) >>> 0;
      const start = offset + 5;
      const end = start + length;
      if (end > bytes.length) break;
      frames.push({ flags, payload: bytes.slice(start, end) });
      offset = end;
    }
    return frames;
  }

  // Decodes only what the hidden BTS shortcut needs from an opgwv1.OpUser
  // message, by field number (there are no field names on the wire):
  //   7  = email (string)
  //   16 = role (enum: 0=UNSPECIFIED, 1=ADMIN, 2=MEMBER)
  //   17 = operator_info (submessage), field 3 inside it = full_name (string)
  // Every other field is skipped by wire type rather than interpreted.
  function decodeOpUserFields(bytes) {
    const result = { email: null, role: null, operatorFullName: null };
    let offset = 0;
    while (offset < bytes.length) {
      const tag = readVarint(bytes, offset);
      offset = tag.nextOffset;
      const fieldNumber = tag.value >>> 3;
      const wireType = tag.value & 0x7;

      if (wireType === 0) {
        const varint = readVarint(bytes, offset);
        offset = varint.nextOffset;
        if (fieldNumber === 16) {
          result.role = ['UNSPECIFIED', 'ADMIN', 'MEMBER'][varint.value] || String(varint.value);
        }
      } else if (wireType === 2) {
        const lengthInfo = readVarint(bytes, offset);
        offset = lengthInfo.nextOffset;
        const slice = bytes.slice(offset, offset + lengthInfo.value);
        offset += lengthInfo.value;

        if (fieldNumber === 7) {
          result.email = new TextDecoder().decode(slice);
        } else if (fieldNumber === 17) {
          let subOffset = 0;
          while (subOffset < slice.length) {
            const subTag = readVarint(slice, subOffset);
            subOffset = subTag.nextOffset;
            const subField = subTag.value >>> 3;
            const subWire = subTag.value & 0x7;
            if (subWire === 2) {
              const subLength = readVarint(slice, subOffset);
              subOffset = subLength.nextOffset;
              const subSlice = slice.slice(subOffset, subOffset + subLength.value);
              subOffset += subLength.value;
              if (subField === 3) result.operatorFullName = new TextDecoder().decode(subSlice);
            } else if (subWire === 0) {
              const skip = readVarint(slice, subOffset);
              subOffset = skip.nextOffset;
            } else {
              break;
            }
          }
        }
      } else if (wireType === 1) {
        offset += 8;
      } else if (wireType === 5) {
        offset += 4;
      } else {
        break;
      }
    }
    return result;
  }

  // Fetches and decodes OpUser in one shot; designed to be stringified and run
  // via chrome.devtools.inspectedWindow.eval(), so it can only reference the
  // three functions above (also inlined alongside it) plus browser globals.
  // Use Promise chaining here: CRA can hoist async/await runtime helpers
  // outside this factory, which would break its isolated serialized copy.
  function fetchOpUserRaw(binding, signal) {
    return Promise.resolve().then(() => {
      const origin = new URL(binding.apiOrigin);
      if (origin.protocol !== 'https:' || origin.origin !== binding.apiOrigin ||
          origin.username || origin.password || window !== window.top ||
          window.location.origin !== binding.initiatorOrigin ||
          !Number.isFinite(binding.expiresAt) || Date.now() >= binding.expiresAt ||
          typeof binding.authorization !== 'string' || binding.authorization.length > 8192 ||
          !/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(binding.authorization) || signal.aborted) return null;
      return fetch(`${origin.origin}/opgwv1.OpGw/GetOpUser`, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal,
        headers: {
          'content-type': 'application/grpc-web+proto',
          'x-grpc-web': '1',
          authorization: binding.authorization,
        },
        body: new Uint8Array([0, 0, 0, 0, 0]),
      }).then(response => {
        if (!response || !response.ok) return null;
        const reader = response.body && response.body.getReader();
        if (!reader) return null;
        // Fixed allocation also bounds overhead from many tiny chunks.
        const buffer = new Uint8Array(256 * 1024);
        let size = 0;
        function readNext() {
          return reader.read().then(part => {
            if (!part.done) {
              if (size + part.value.byteLength > buffer.byteLength) return Promise.resolve(reader.cancel()).then(() => null);
              buffer.set(part.value, size);
              size += part.value.byteLength;
              return readNext();
            }
            const frames = decodeGrpcWebFrames(buffer.subarray(0, size));
            const dataFrame = frames.find(frame => (frame.flags & 0x80) === 0);
            if (!dataFrame) return null;
            const result = decodeOpUserFields(dataFrame.payload);
            if (Object.values(result).some(value => value != null && value.length > 512)) return null;
            return result;
          });
        }
        return readNext().finally(() => reader.releaseLock());
      });
    }).catch(() => null);
  }

  return { readVarint, decodeGrpcWebFrames, decodeOpUserFields, fetchOpUserRaw };
}

export const { readVarint, decodeGrpcWebFrames, decodeOpUserFields, fetchOpUserRaw } = createOpUserFetcher();

export function buildOpUserEvalExpression(binding, attemptId) {
  return `(function () {\nconst fetcher = (${createOpUserFetcher.toString()})();\nreturn globalThis.__GRPCWEB_DEVTOOLS_BTS__?.start(${JSON.stringify(binding)}, ${JSON.stringify(attemptId)}, fetcher.fetchOpUserRaw) === true;\n})()`;
}
