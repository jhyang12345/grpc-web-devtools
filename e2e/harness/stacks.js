// One adapter per supported client stack. Each adapter drives the real
// generated client exactly the way an application would, including the
// late-bound DevTools hook from docs/client-integration.md, and normalizes the
// outcome so the shared scenarios can compare stacks.
//
// Adapter contract:
//   id, transport          stack id and the `transport` the interceptor reports
//   install(baseUrl)       builds clients; must be called after bootExtension()
//   unary(json)            -> { response } | { error }       (never rejects)
//   stream(json)           -> { messages, error? }           (never rejects)
//   ping()                 -> { response } | { error }
//   methodName(name)       expected captured `method` for an RPC name
//   requestShape           "canonical" (proto3 JSON) or "jspb" (google-protobuf toObject)
//   supportsInterceptorChain  replay re-runs app interceptors placed after DevTools
import { NOTE_TYPE_URL, buildJspbRequest } from "./fixture";

const SERVICE = "inspector.e2e.KitchenService";
let authCounter = 0;
const nextAuth = () => `token-${++authCounter}`;

const settle = promise => promise.then(response => ({ response }), error => ({ error }));

function grpcWebStack({ id, dir, promise }) {
  const pb = require(`../gen/${dir}/kitchen_pb.js`);
  const services = require(`../gen/${dir}/kitchen_grpc_web_pb.js`);
  const { Empty } = require("google-protobuf/google/protobuf/empty_pb.js");
  let client;
  let baseUrl;
  return {
    id,
    transport: "grpc-web",
    requestShape: "jspb",
    supportsInterceptorChain: false,
    pb,
    install(url) {
      baseUrl = url;
      client = promise ? new services.KitchenServicePromiseClient(url) : new services.KitchenServiceClient(url);
      // The documented integration: install now and again when the API announces itself.
      const install = () => window.__GRPCWEB_DEVTOOLS__ && window.__GRPCWEB_DEVTOOLS__([client]);
      install();
      window.addEventListener("grpc-web-dev-tools-ready", install);
      return client;
    },
    methodName: name => `${baseUrl}/${SERVICE}/${name}`,
    buildRequest: json => buildJspbRequest(pb, json),
    unary(json) {
      const request = buildJspbRequest(pb, json);
      const metadata = { "x-e2e-auth": nextAuth() };
      if (promise) return settle(client.echo(request, metadata));
      return new Promise(resolve => {
        client.echo(request, metadata, (error, response) => resolve(error ? { error } : { response }));
      });
    },
    ping() {
      if (promise) return settle(client.ping(new Empty(), {}));
      return new Promise(resolve => client.ping(new Empty(), {}, (error, response) => resolve(error ? { error } : { response })));
    },
    stream(json) {
      const stream = client.stream(buildJspbRequest(pb, json), { "x-e2e-auth": nextAuth() });
      const messages = [];
      return new Promise(resolve => {
        let done = false;
        const finish = result => {
          if (done) return;
          done = true;
          resolve({ messages, ...result });
        };
        stream.on("data", message => messages.push(message));
        stream.on("error", error => finish({ error }));
        stream.on("status", status => {
          if (status && status.code !== 0) finish({ error: status });
        });
        stream.on("end", () => setTimeout(() => finish({}), 0));
      });
    },
    responseText: response => response.getServerNote(),
  };
}

function connectV2Stack({ id, protocol }) {
  const { createClient } = require("@connectrpc/connect");
  const { createConnectTransport, createGrpcWebTransport } = require("@connectrpc/connect-web");
  const { create, createRegistry, fromJson } = require("@bufbuild/protobuf");
  const { EmptySchema } = require("@bufbuild/protobuf/wkt");
  const gen = require("../gen/es-v2/kitchen_pb");
  const registry = createRegistry(gen.file_kitchen);
  let client;
  let authHeaders = [];
  return {
    id,
    transport: "connect-web",
    requestShape: "canonical",
    supportsInterceptorChain: true,
    install(baseUrl) {
      const devtools = next => request => {
        const hook = window.__CONNECT_WEB_DEVTOOLS__;
        return hook ? hook(next)(request) : next(request);
      };
      const auth = next => request => {
        request.header.set("x-e2e-auth", nextAuth());
        return next(request);
      };
      const factory = protocol === "connect" ? createConnectTransport : createGrpcWebTransport;
      const transport = factory({ baseUrl, interceptors: [devtools, auth], jsonOptions: { registry } });
      client = createClient(gen.KitchenService, transport);
      return client;
    },
    methodName: name => name,
    buildRequest: json => fromJson(gen.EchoRequestSchema, json, { registry }),
    unary(json) {
      return settle(client.echo(fromJson(gen.EchoRequestSchema, json, { registry })));
    },
    ping() {
      return settle(client.ping(create(EmptySchema)));
    },
    async stream(json) {
      const messages = [];
      try {
        for await (const message of client.stream(fromJson(gen.EchoRequestSchema, json, { registry }))) messages.push(message);
        return { messages };
      } catch (error) {
        return { messages, error };
      }
    },
    responseText: response => response.serverNote,
    authHeaders,
  };
}

function protobufTsStack({ id }) {
  const { GrpcWebFetchTransport } = require("@protobuf-ts/grpcweb-transport");
  const { KitchenServiceClient } = require("../gen/protobuf-ts/kitchen.client");
  const gen = require("../gen/protobuf-ts/kitchen");
  const { Empty } = require("../gen/protobuf-ts/google/protobuf/empty");
  let client;
  let baseUrl;
  return {
    id,
    transport: "protobuf-ts",
    requestShape: "canonical",
    supportsInterceptorChain: true,
    install(url) {
      baseUrl = url;
      const devtools = {
        interceptUnary(next, method, input, options) {
          const hook = window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__;
          return hook ? hook.interceptUnary({ baseUrl, next, method, input, options }) : next(method, input, options);
        },
        interceptServerStreaming(next, method, input, options) {
          const hook = window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__;
          return hook ? hook.interceptServerStreaming({ baseUrl, next, method, input, options }) : next(method, input, options);
        },
      };
      const auth = {
        interceptUnary(next, method, input, options) {
          return next(method, input, { ...options, meta: { ...options.meta, "x-e2e-auth": nextAuth() } });
        },
        interceptServerStreaming(next, method, input, options) {
          return next(method, input, { ...options, meta: { ...options.meta, "x-e2e-auth": nextAuth() } });
        },
      };
      const transport = new GrpcWebFetchTransport({
        baseUrl,
        format: "binary",
        interceptors: [devtools, auth],
        jsonOptions: { typeRegistry: [gen.Note] },
      });
      client = new KitchenServiceClient(transport);
      return client;
    },
    methodName: name => `${baseUrl}/${SERVICE}/${name}`,
    buildRequest: json => gen.EchoRequest.fromJson(json, { typeRegistry: [gen.Note] }),
    async unary(json) {
      try {
        const call = client.echo(gen.EchoRequest.fromJson(json, { typeRegistry: [gen.Note] }));
        return { response: await call.response };
      } catch (error) {
        return { error };
      }
    },
    async ping() {
      try {
        return { response: await client.ping(Empty.create()).response };
      } catch (error) {
        return { error };
      }
    },
    async stream(json) {
      const messages = [];
      try {
        const call = client.stream(gen.EchoRequest.fromJson(json, { typeRegistry: [gen.Note] }));
        for await (const message of call.responses) messages.push(message);
        await call.status;
        return { messages };
      } catch (error) {
        return { messages, error };
      }
    },
    responseText: response => response.serverNote,
  };
}

export function connectV1Stack(options) {
  // Lives in the isolated e2e/connect-v1 package so it resolves protobuf-es v1.
  return require("../connect-v1/stack").connectV1Stack({ ...options, nextAuth });
}

export const STACKS = {
  "grpc-web-text-callback": () => grpcWebStack({ id: "grpc-web-text-callback", dir: "grpc-web-text", promise: false }),
  "grpc-web-text-promise": () => grpcWebStack({ id: "grpc-web-text-promise", dir: "grpc-web-text", promise: true }),
  "grpc-web-binary-callback": () => grpcWebStack({ id: "grpc-web-binary-callback", dir: "grpc-web-binary", promise: false }),
  "grpc-web-binary-promise": () => grpcWebStack({ id: "grpc-web-binary-promise", dir: "grpc-web-binary", promise: true }),
  "connect-v2-grpc-web": () => connectV2Stack({ id: "connect-v2-grpc-web", protocol: "grpc-web" }),
  "connect-v2-connect": () => connectV2Stack({ id: "connect-v2-connect", protocol: "connect" }),
  "connect-v1-grpc-web": () => connectV1Stack({ id: "connect-v1-grpc-web", protocol: "grpc-web" }),
  "connect-v1-connect": () => connectV1Stack({ id: "connect-v1-connect", protocol: "connect" }),
  "protobuf-ts": () => protobufTsStack({ id: "protobuf-ts" }),
};

export { NOTE_TYPE_URL };
