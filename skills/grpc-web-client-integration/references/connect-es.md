# Connect-ES

Use a late-bound interceptor with `createGrpcWebTransport()` or
`createConnectTransport()`. Looking up the page API for each request makes
transport construction independent of extension injection timing.

Match the package namespace already installed by the client. Current projects
normally use `@connectrpc/connect` and `@connectrpc/connect-web`:

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
  const devtools = typeof window === "undefined"
    ? undefined
    : window.__CONNECT_WEB_DEVTOOLS__;
  return devtools ? devtools(next)(request) : next(request);
};

const transport = createGrpcWebTransport({
  baseUrl: "https://api.example.com",
  interceptors: [grpcWebDevtoolsInterceptor, authInterceptor],
});
```

For an existing legacy project, keep its namespace and use the equivalent
imports instead of migrating dependencies:

```ts
import type { Interceptor } from "@bufbuild/connect";
import {
  createConnectTransport,
  createGrpcWebTransport,
} from "@bufbuild/connect-web";
```

Confirm the installed major version's exported types before editing. Do not run
a Connect migration tool, change generated messages, or rewrite the lockfile as
part of DevTools integration.

For the Connect protocol, change only the transport factory:

```ts
const transport = createConnectTransport({
  baseUrl: "https://api.example.com",
  interceptors: [grpcWebDevtoolsInterceptor, authInterceptor],
});
```

Keep the DevTools wrapper first. Its captured replay continuation then includes
the authentication, retry, and tracing interceptors that follow it.

Insert the wrapper without changing the relative order of existing application
interceptors. Reuse the active transport, base URL, credentials, fetch options,
and binary-format settings. If an interceptor list is assembled through spreads
or factories, trace the final array rather than replacing it with the example.

Do not push the extension interceptor into an array from
`connect-web-dev-tools-ready` after the transport has been created. Transport
implementations may snapshot or compose interceptors during construction, and
requests made before the event would remain uninstrumented.
