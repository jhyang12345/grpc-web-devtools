# Client integration

The extension can observe traffic only after the web application opts its RPC
client or transport into the page API injected by the extension. Add the
integration for the client library your application uses, and run it before the
first RPC you want to capture.

| Client library | Add to the application | Captures | Edit and replay |
| --- | --- | --- | --- |
| Generated `grpc-web` client | Register every client instance | Unary and server streaming | Yes |
| Connect-ES (`@connectrpc/connect-web`) | Add a transport interceptor | Unary and server streaming | Yes |
| protobuf-ts (`@protobuf-ts/grpcweb-transport`) | Add an `RpcInterceptor` | Unary and server streaming | Yes |

The integration is safe to leave in a production bundle. When the extension is
not installed, the optional page APIs are absent and the wrappers call the
normal transport directly.

## Optional TypeScript declarations

Add a file such as `src/grpc-web-devtools.d.ts` if the application uses
TypeScript:

```ts
import type { Interceptor } from "@connectrpc/connect";
import type {
  MethodInfo,
  NextServerStreamingFn,
  NextUnaryFn,
  RpcOptions,
  ServerStreamingCall,
  UnaryCall,
} from "@protobuf-ts/runtime-rpc";

type GrpcWebReplayAdapter = {
  fromJson?: (json: Record<string, unknown>, originalRequest: unknown) => unknown;
  createRequest?: (json: Record<string, unknown>, originalRequest: unknown) => unknown;
};

type GrpcWebDevtools = ((clients: unknown[]) => void) & {
  registerMethod(method: string, adapter: GrpcWebReplayAdapter): void;
  unregisterMethod(method: string): void;
};

type ProtobufTsDevtools = {
  protocolVersion: 1;
  interceptUnary(context: {
    baseUrl: string;
    next: NextUnaryFn;
    method: MethodInfo;
    input: object;
    options: RpcOptions;
  }): UnaryCall;
  interceptServerStreaming(context: {
    baseUrl: string;
    next: NextServerStreamingFn;
    method: MethodInfo;
    input: object;
    options: RpcOptions;
  }): ServerStreamingCall;
};

declare global {
  interface Window {
    __GRPCWEB_DEVTOOLS__?: GrpcWebDevtools;
    __CONNECT_WEB_DEVTOOLS__?: Interceptor;
    __GRPCWEB_DEVTOOLS_PROTOBUF_TS__?: ProtobufTsDevtools;
  }
}

export {};
```

Remove imports and declarations for client libraries the application does not
use.

## Generated grpc-web clients

Register each generated client instance. Check immediately in case the
extension API is already present, and also listen for its readiness event in
case injection finishes later:

```ts
import { EchoServiceClient } from "./generated/EchoServiceClientPb";

export const echoClient = new EchoServiceClient("https://api.example.com");
const grpcWebClients = [echoClient];

function installGrpcWebDevtools(): void {
  window.__GRPCWEB_DEVTOOLS__?.(grpcWebClients);
}

installGrpcWebDevtools();
window.addEventListener("grpc-web-dev-tools-ready", installGrpcWebDevtools);
```

Register all clients in the same array, including clients created for different
services. Repeated registration is idempotent. Generated clients must use
`protoc-gen-grpc-web` 1.0.4 or newer.

Simple protobuf fields are reconstructed automatically during replay. If a
request contains a nested or custom field that cannot be inferred safely,
register an explicit adapter inside `installGrpcWebDevtools()`:

```ts
function installGrpcWebDevtools(): void {
  const devtools = window.__GRPCWEB_DEVTOOLS__;
  if (!devtools) return;

  devtools([echoClient]);
  devtools.registerMethod("/example.EchoService/Send", {
    createRequest(json) {
      const request = new SendRequest();
      request.setMessage(String(json.message ?? ""));
      request.setLabelsList(
        Array.isArray(json.labels) ? json.labels.map(String) : []
      );
      return request;
    },
  });
}
```

Use the exact method path shown in the captured entry. The adapter is only
needed for methods whose generated message cannot be rebuilt by the default
setter-based conversion.

## Connect-ES

Use a late-bound interceptor rather than conditionally constructing the
interceptor array. A transport snapshots its interceptor list when it is
created; mutating that array after the readiness event can miss requests.

```ts
import type { Interceptor } from "@connectrpc/connect";
import {
  createConnectTransport,
  createGrpcWebTransport,
} from "@connectrpc/connect-web";

const grpcWebDevtoolsInterceptor: Interceptor = (next) => (request) => {
  const devtools = window.__CONNECT_WEB_DEVTOOLS__;
  return devtools ? devtools(next)(request) : next(request);
};

const transport = createGrpcWebTransport({
  baseUrl: "https://api.example.com",
  interceptors: [grpcWebDevtoolsInterceptor, authInterceptor],
});
```

Use the same interceptor with `createConnectTransport()` when the backend uses
the Connect protocol:

```ts
const transport = createConnectTransport({
  baseUrl: "https://api.example.com",
  interceptors: [grpcWebDevtoolsInterceptor, authInterceptor],
});
```

Put the DevTools wrapper before authentication, retry, and tracing
interceptors. This makes a replay pass through the rest of the application
pipeline again, so an authentication interceptor can supply a fresh token.

## protobuf-ts

Create a late-bound protobuf-ts interceptor and give it the same base URL as
the transport:

```ts
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import type { RpcInterceptor } from "@protobuf-ts/runtime-rpc";

const baseUrl = "https://api.example.com";

const grpcWebDevtoolsInterceptor: RpcInterceptor = {
  interceptUnary(next, method, input, options) {
    const devtools = window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__;
    return devtools
      ? devtools.interceptUnary({ baseUrl, next, method, input, options })
      : next(method, input, options);
  },

  interceptServerStreaming(next, method, input, options) {
    const devtools = window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__;
    return devtools
      ? devtools.interceptServerStreaming({
          baseUrl,
          next,
          method,
          input,
          options,
        })
      : next(method, input, options);
  },
};

export const transport = new GrpcWebFetchTransport({
  baseUrl,
  interceptors: [grpcWebDevtoolsInterceptor, authInterceptor],
});
```

This wrapper does not need a readiness listener because it looks up the page API
for every call. The extension also emits
`grpc-web-dev-tools-protobuf-ts-ready` for applications that need an explicit
readiness signal.

## What enables the full feature set

For the best result:

1. Install the integration before creating or issuing the RPCs you want to
   inspect. Requests made before registration are not retroactively captured.
2. Open the browser DevTools panel and make a new request. The entry should show
   its request, response or stream messages, status/error, frame URL, start and
   completion times, duration, and stream time-to-first-message.
3. Select the entry, choose **Edit**, change its JSON, and choose **Send
   request**. Replay performs a real backend call through the originating page
   frame.
4. Keep authentication and other application interceptors after the DevTools
   wrapper so replay runs through them again.

Connect-Web and protobuf-ts request capture enables default-valued scalar
fields in protobuf JSON output. For example, `{ "countryCode": "" }` stays
visible in the request pane instead of collapsing to `{}`. This is the complete
logical protobuf message value, not proof that every default value was encoded
on the wire. Standard proto3 fields with implicit presence omit default values
from the binary wire format; declare a field `optional` or use a wrapper type if
the backend needs to distinguish an omitted value from an explicitly empty one.

Replay is available only for captured requests. Page-side replay handles expire
after ten minutes and are limited to 100 per transport. A request must be 5 MiB
or smaller and still present in the panel payload cache. Reloading, discarding,
or navigating the originating frame destroys its replay handles. Client-side
and bidirectional streaming are not supported by this integration.

## Troubleshooting

- **No requests appear:** Confirm the matching `window` API exists, then reload
  the page with DevTools open and issue a new RPC. For generated `grpc-web`, make
  sure every client instance is registered.
- **The extension says disconnected after the tab was idle:** Wait briefly for
  automatic recovery or choose **Reconnect now**. Browser extension workers can
  be suspended while idle; the panel and content bridge reconnect with
  exponential backoff and verify the replacement port with acknowledgements.
- **Replay is unavailable:** The page may have reloaded, the ten-minute handle
  may have expired, the 100-handle limit may have evicted it, or the payload may
  be truncated. Capture a fresh request.
- **Edited generated grpc-web request is rejected:** Register a per-method
  `createRequest` or `fromJson` adapter for fields the default generated setters
  cannot reconstruct.
- **The browser discarded the tab:** Reload the tab and capture the request
  again. A discarded page cannot retain live client objects or replay handles.
