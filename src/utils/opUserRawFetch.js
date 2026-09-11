// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.
//
// Best-effort fallback for the hidden BTS-info shortcut: if no GetOpUser call
// was captured this session, try fetching it ourselves. Our extension only
// observes calls the inspected app's own gRPC client makes (see
// public/protobuf-ts-interceptor.js) — it has no client of its own — so this
// bypasses that entirely with a minimal, hand-rolled gRPC-Web request built
// from the inspected app's own transport config (GrpcWebFetchTransport,
// format: 'binary') and the exact opgwv1.OpUser proto field numbers.
//
// The functions below are intentionally closure-free (no imports, no outer
// variable references) so their source can be safely reused verbatim inside
// chrome.devtools.inspectedWindow.eval(), which runs in the inspected page's
// own isolated world with zero access to this extension's JS. That also means
// the code exercised by the unit tests in this file is exactly the code that
// runs live — there is no separate "real" copy to drift out of sync.
//
// Every layer is wrapped defensively: any failure (wrong auth scheme, CORS
// block, malformed response, network hang) must resolve to `null`, never
// throw, so callers can fall back to leaving the field blank exactly as if
// this fallback didn't exist at all.

// Matches any cookie whose name ends in "-accessToken" (the app stores its
// auth token as a non-httpOnly cookie named e.g. <cluster>[-privacy]-accessToken),
// rather than a specific known prefix — keeps this generic across environments.
export function findAccessTokenCookie(cookieString) {
  const match = String(cookieString || '').match(/(?:^|;\s*)([\w-]+-accessToken)=([^;]+)/);
  return match ? decodeURIComponent(match[2]) : null;
}

export function readVarint(bytes, offset) {
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

export function decodeGrpcWebFrames(bytes) {
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
export function decodeOpUserFields(bytes) {
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
export async function fetchOpUserRaw(backendOrigin) {
  try {
    const token = findAccessTokenCookie(document.cookie);
    if (!token) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    let response;
    try {
      response = await fetch(`${backendOrigin}/opgwv1.OpGw/GetOpUser`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'content-type': 'application/grpc-web+proto',
          'x-grpc-web': '1',
          authorization: `bearer ${token}`,
        },
        body: new Uint8Array([0, 0, 0, 0, 0]),
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response || !response.ok) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    const frames = decodeGrpcWebFrames(bytes);
    const dataFrame = frames.find(frame => (frame.flags & 0x80) === 0);
    if (!dataFrame) return null;

    return decodeOpUserFields(dataFrame.payload);
  } catch (_) {
    return null;
  }
}

export function buildOpUserEvalExpression(backendOrigin) {
  const helperSource = [findAccessTokenCookie, readVarint, decodeGrpcWebFrames, decodeOpUserFields, fetchOpUserRaw]
    .map(fn => fn.toString())
    .join('\n');

  return `(function () {\n${helperSource}\nreturn fetchOpUserRaw(${JSON.stringify(backendOrigin)});\n})()`;
}
