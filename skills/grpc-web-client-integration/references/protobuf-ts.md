# protobuf-ts

Use a late-bound `RpcInterceptor` with `GrpcWebFetchTransport`. Pass the exact
transport base URL to the extension API so captured method URLs are correct.

```ts
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import type {
  MethodInfo,
  NextServerStreamingFn,
  NextUnaryFn,
  RpcInterceptor,
  RpcOptions,
  ServerStreamingCall,
  UnaryCall,
} from "@protobuf-ts/runtime-rpc";

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
    __GRPCWEB_DEVTOOLS_PROTOBUF_TS__?: ProtobufTsDevtools;
  }
}

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

The per-call lookup removes the need for a readiness listener. The extension
also emits `grpc-web-dev-tools-protobuf-ts-ready` if the application has another
reason to observe installation. Keep the DevTools wrapper before application
interceptors so replay passes through them again.
