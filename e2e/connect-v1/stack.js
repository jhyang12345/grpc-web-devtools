// Connect-ES v1 adapter. It lives inside this isolated package so that
// @connectrpc/connect and the generated code resolve protobuf-es v1 (class
// messages with toJson/fromJson) instead of the root's protobuf-es v2.
// Install with `npm run e2e:setup`.
const { createPromiseClient } = require("@connectrpc/connect");
const { createConnectTransport, createGrpcWebTransport } = require("@connectrpc/connect-web");
const { createRegistry, Empty } = require("@bufbuild/protobuf");
const { EchoRequest, Note } = require("./gen/kitchen_pb");
const { KitchenService } = require("./gen/kitchen_connect");

const typeRegistry = createRegistry(Note);
const settle = promise => promise.then(response => ({ response }), error => ({ error }));

function connectV1Stack({ id, protocol, nextAuth, cancelAsyncIterable }) {
  let client;
  return {
    id,
    transport: "connect-web",
    requestShape: "canonical",
    supportsInterceptorChain: true,
    // Connect's promise client hides return() from the app, so leaving the loop
    // early does not cancel the call (the request stays open); only abort does.
    cancelModes: ["abort"],
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
      const transport = factory({ baseUrl, interceptors: [devtools, auth], jsonOptions: { typeRegistry } });
      client = createPromiseClient(KitchenService, transport);
      return client;
    },
    methodName: name => name,
    buildRequest: json => EchoRequest.fromJson(json, { typeRegistry }),
    unary: json => settle(client.echo(EchoRequest.fromJson(json, { typeRegistry }))),
    ping: () => settle(client.ping(new Empty())),
    async stream(json) {
      const messages = [];
      try {
        for await (const message of client.stream(EchoRequest.fromJson(json, { typeRegistry }))) messages.push(message);
        return { messages };
      } catch (error) {
        return { messages, error };
      }
    },
    cancelStream(json, count, how) {
      return cancelAsyncIterable(signal => client.stream(EchoRequest.fromJson(json, { typeRegistry }), { signal }), count, how);
    },
    responseText: response => response.serverNote,
  };
}

module.exports = { connectV1Stack };
