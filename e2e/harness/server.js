// In-process backend for the real-library end-to-end suites.
//
// It implements inspector.e2e.KitchenService over the three wire protocols the
// supported browser clients speak, the way Envoy or connect-go would:
//   - gRPC-Web binary   (application/grpc-web, application/grpc-web+proto)
//   - gRPC-Web text     (application/grpc-web-text[+proto], base64 framed)
//   - Connect           (application/proto|json unary, application/connect+proto|json streaming)
// Every decoded request is recorded so tests can prove what actually reached the
// backend (for example, that an edited replay changed the wire value).
import http from "http";
import { create, createRegistry, fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { EchoRequestSchema, EchoResponseSchema, file_kitchen } from "../gen/es-v2/kitchen_pb";

const SERVICE = "inspector.e2e.KitchenService";
const registry = createRegistry(file_kitchen);
const JSON_OPTIONS = { registry };

const METHODS = {
  Echo: { input: EchoRequestSchema, output: EchoResponseSchema, streaming: false },
  Ping: { input: EmptySchema, output: EmptySchema, streaming: false },
  Stream: { input: EchoRequestSchema, output: EchoResponseSchema, streaming: true },
};

const CONNECT_CODES = {
  1: "canceled", 2: "unknown", 3: "invalid_argument", 4: "deadline_exceeded", 5: "not_found",
  6: "already_exists", 7: "permission_denied", 8: "resource_exhausted", 9: "failed_precondition",
  10: "aborted", 11: "out_of_range", 12: "unimplemented", 13: "internal", 14: "unavailable",
  15: "data_loss", 16: "unauthenticated",
};
const CONNECT_HTTP_STATUS = {
  canceled: 499, unknown: 500, invalid_argument: 400, deadline_exceeded: 504, not_found: 404,
  already_exists: 409, permission_denied: 403, resource_exhausted: 429, failed_precondition: 400,
  aborted: 409, out_of_range: 400, unimplemented: 501, internal: 500, unavailable: 503,
  data_loss: 500, unauthenticated: 401,
};

function frame(flags, payload) {
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, Buffer.from(payload)]);
}

function readFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const flags = buffer.readUInt8(offset);
    const length = buffer.readUInt32BE(offset + 1);
    frames.push({ flags, payload: buffer.subarray(offset + 5, offset + 5 + length) });
    offset += 5 + length;
  }
  return frames;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function corsHeaders(req) {
  return {
    "access-control-allow-origin": req.headers.origin || "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": req.headers["access-control-request-headers"] || "*",
    "access-control-expose-headers": "grpc-status, grpc-message, grpc-status-details-bin",
    "access-control-max-age": "600",
  };
}

// What the handler wants to happen, independent of the wire protocol.
function plan(methodName, request) {
  if (methodName === "Ping") return { messages: [create(EmptySchema)], status: { code: 0 } };
  const scenario = request.scenario || "ok";
  const count = request.count || 0;
  const reply = index => create(EchoResponseSchema, {
    sink: request.sink,
    index,
    serverNote: `${methodName}#${index}`,
  });
  if (scenario === "network-error") return { destroy: true };
  if (scenario === "trailers-only") {
    return { messages: [], status: { code: request.errorCode || 5, message: "trailers only failure" }, trailersOnly: true };
  }
  const messages = METHODS[methodName].streaming
    ? Array.from({ length: count }, (_, index) => reply(index))
    : scenario === "grpc-error" ? [] : [reply(0)];
  const status = scenario === "grpc-error"
    ? { code: request.errorCode || 13, message: `scenario failure ${request.errorCode || 13}` }
    : { code: 0 };
  return { messages, status };
}

async function handleGrpcWeb(req, res, method, body, record) {
  const text = /grpc-web-text/.test(req.headers["content-type"]);
  const raw = text ? Buffer.from(body.toString("latin1"), "base64") : body;
  const dataFrame = readFrames(raw).find(item => item.flags === 0);
  const request = fromBinary(method.input, dataFrame ? dataFrame.payload : new Uint8Array());
  record(request);
  const outcome = plan(req.methodName, request);
  if (outcome.destroy) return req.socket.destroy();
  const contentType = text ? "application/grpc-web-text+proto" : "application/grpc-web+proto";
  if (outcome.trailersOnly) {
    res.writeHead(200, {
      ...corsHeaders(req),
      "content-type": contentType,
      "grpc-status": String(outcome.status.code),
      "grpc-message": encodeURIComponent(outcome.status.message),
    });
    return res.end();
  }
  res.writeHead(200, { ...corsHeaders(req), "content-type": contentType });
  const write = buffer => res.write(text ? buffer.toString("base64") : buffer);
  for (const message of outcome.messages) {
    write(frame(0x00, toBinary(method.output, message)));
    // Yield between stream messages so clients observe progressive delivery.
    if (method.streaming) await new Promise(resolve => setTimeout(resolve, 5));
  }
  const trailers = `grpc-status:${outcome.status.code}\r\ngrpc-message:${encodeURIComponent(outcome.status.message || "")}\r\n`;
  write(frame(0x80, Buffer.from(trailers)));
  res.end();
}

async function handleConnect(req, res, method, body, record) {
  const contentType = req.headers["content-type"] || "";
  const json = /json/.test(contentType);
  if (!method.streaming) {
    const request = json
      ? fromJson(method.input, JSON.parse(body.toString("utf8") || "{}"), JSON_OPTIONS)
      : fromBinary(method.input, body);
    record(request);
    const outcome = plan(req.methodName, request);
    if (outcome.destroy) return req.socket.destroy();
    if (outcome.status.code !== 0) {
      const code = CONNECT_CODES[outcome.status.code] || "unknown";
      res.writeHead(CONNECT_HTTP_STATUS[code], { ...corsHeaders(req), "content-type": "application/json" });
      return res.end(JSON.stringify({ code, message: outcome.status.message }));
    }
    res.writeHead(200, { ...corsHeaders(req), "content-type": json ? "application/json" : "application/proto" });
    const message = outcome.messages[0];
    return res.end(json ? JSON.stringify(toJson(method.output, message, JSON_OPTIONS)) : Buffer.from(toBinary(method.output, message)));
  }

  const dataFrame = readFrames(body).find(item => (item.flags & 0x02) === 0);
  const payload = dataFrame ? dataFrame.payload : new Uint8Array();
  const request = json
    ? fromJson(method.input, JSON.parse(Buffer.from(payload).toString("utf8") || "{}"), JSON_OPTIONS)
    : fromBinary(method.input, payload);
  record(request);
  const outcome = plan(req.methodName, request);
  if (outcome.destroy) return req.socket.destroy();
  res.writeHead(200, { ...corsHeaders(req), "content-type": json ? "application/connect+json" : "application/connect+proto" });
  for (const message of outcome.messages) {
    const encoded = json ? Buffer.from(JSON.stringify(toJson(method.output, message, JSON_OPTIONS))) : toBinary(method.output, message);
    res.write(frame(0x00, encoded));
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const end = outcome.status.code === 0
    ? {}
    : { error: { code: CONNECT_CODES[outcome.status.code] || "unknown", message: outcome.status.message } };
  res.write(frame(0x02, Buffer.from(JSON.stringify(end))));
  res.end();
}

export async function startKitchenServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders(req));
        return res.end();
      }
      const url = new URL(req.url, "http://localhost");
      const [, service, methodName] = url.pathname.split("/");
      const method = service === SERVICE ? METHODS[methodName] : null;
      if (!method) {
        res.writeHead(404, corsHeaders(req));
        return res.end();
      }
      req.methodName = methodName;
      const body = await readBody(req);
      const contentType = req.headers["content-type"] || "";
      const protocol = /grpc-web/.test(contentType) ? "grpc-web" : "connect";
      const record = message => requests.push({
        method: methodName,
        protocol,
        contentType,
        headers: { ...req.headers },
        json: toJson(method.input, message, { ...JSON_OPTIONS, alwaysEmitImplicit: true }),
      });
      if (protocol === "grpc-web") await handleGrpcWeb(req, res, method, body, record);
      else await handleConnect(req, res, method, body, record);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, corsHeaders(req));
      res.end(String(error && error.stack));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    reset() {
      requests.length = 0;
    },
    close() {
      return new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}
