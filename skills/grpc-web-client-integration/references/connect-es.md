# Connect-ES

Use a late-bound interceptor with `createGrpcWebTransport()` or
`createConnectTransport()`. Looking up the page API for each request makes
transport construction independent of extension injection timing.

```ts
import type { Interceptor } from "@connectrpc/connect";
import {
  createConnectTransport,
  createGrpcWebTransport,
} from "@connectrpc/connect-web";

declare global {
  interface Window {
    __CONNECT_WEB_DEVTOOLS__?: Interceptor;
  }
}

const grpcWebDevtoolsInterceptor: Interceptor = (next) => (request) => {
  const devtools = window.__CONNECT_WEB_DEVTOOLS__;
  return devtools ? devtools(next)(request) : next(request);
};

const transport = createGrpcWebTransport({
  baseUrl: "https://api.example.com",
  interceptors: [grpcWebDevtoolsInterceptor, authInterceptor],
});
```

For the Connect protocol, change only the transport factory:

```ts
const transport = createConnectTransport({
  baseUrl: "https://api.example.com",
  interceptors: [grpcWebDevtoolsInterceptor, authInterceptor],
});
```

Keep the DevTools wrapper first. Its captured replay continuation then includes
the authentication, retry, and tracing interceptors that follow it.

Do not push the extension interceptor into an array from
`connect-web-dev-tools-ready` after the transport has been created. Transport
implementations may snapshot or compose interceptors during construction, and
requests made before the event would remain uninstrumented.
