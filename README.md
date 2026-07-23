# gRPC-Web Dev Tools

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

![gRPC-Web Inspector, light theme](screenshots/store_light_1280x800.png)
![gRPC-Web Inspector, dark theme](screenshots/store_dark_1280x800.png)
Now supports dark mode.

## Installation

### Chrome

Via
the [Chrome Web Store](https://chrome.google.com/webstore/detail/grpc-web-developer-tools/kanmilmfkjnoladbbamlclhccicldjaj) (
recommended)

or

1. build it with `make build`
1. open the **Extension Management** page by navigating to `chrome://extensions`.
1. enable **Developer Mode** by clicking the toggle switch next to "Developer mode".
1. Click the **LOAD UNPACKED** button and select the extension `./build` directory.

### Firefox

Via [Firefox Browser Add-Ons](https://addons.mozilla.org/en-US/firefox/addon/grpc-web-developer-tools/) (recommended)

or

1. build and package with `make package`
1. enter `about:debugging` in the URL bar of Firefox
1. click **This Firefox** > **Load Temporary Add-on...**
1. select the `grpc-web-devtools.zip` extention file

## Usage

```javascript
const enableDevTools = window.__GRPCWEB_DEVTOOLS__ || (() => {
});
const client = new EchoServiceClient('http://myapi.com');
enableDevTools([
  client,
]);
```

> NOTE: Requires that your generated client(s) use `protoc-gen-grpc-web` >= 1.0.4

### Inspect, edit, and replay a captured request

1. Perform the gRPC-Web or Connect-Web call you want to inspect.
2. Select its entry in the DevTools panel.
3. In the **Request** pane, choose **Edit**.
4. Change the captured JSON, then choose **Send request**.

The replay is sent through the originating frame and appears as a new request
entry. The panel labels it as a retry of the original request. Its list and
details views show the exact **Frame URL**, start time, completion time,
duration, and time-to-first-message (TTFM) for streams.

> **Warning:** Replay sends a real backend request. It may reuse the captured
> request's authentication and metadata. An acknowledgement only means the
> page accepted and scheduled the replay; the new request entry records the
> actual RPC success or failure.

### Replay limits and request construction

Replay is available only for a request the extension has already captured. The
originating frame and its instrumented client/interceptor must still be alive.
Page-side replay handles expire after ten minutes and are bounded to 100 handles
per transport. The full request body must still be retained in the panel's
payload cache, must not be truncated, and the edited JSON object must be 5 MiB
or smaller.

Arbitrary, uncaptured RPC composition is not supported. Supporting that safely
requires a future application-provided invocation/catalog adapter; this release
only reconstructs captured requests.

For gRPC-Web, replay first uses an optional per-method adapter. Without one, it
clones the original generated request and applies generated protobuf setters for
supported scalar, enum, bytes, repeated, and inferable nested fields. It rejects
fields whose type cannot be safely inferred rather than guessing. Register an
adapter when your request needs custom reconstruction:

```javascript
window.__GRPCWEB_DEVTOOLS__.registerMethod('/example.EchoService/Send', {
  fromJson(json, originalRequest) {
    return SendRequest.fromJson(json);
  },
});

// Remove the adapter when the application no longer needs it.
window.__GRPCWEB_DEVTOOLS__.unregisterMethod('/example.EchoService/Send');
```

An adapter may provide `createRequest(json, originalRequest)` instead of
`fromJson`. Connect-Web replay uses the captured message type's generated JSON
constructors (`fromJson`/`fromJsonString`) where available, before trying safe
constructor or instance fallbacks.

## Example

The example uses `docker-compose` to start a simple gRPC server, JavaScript client and the Envoy proxy for gRPC-Web:

```bash
make example-up
```

Example will be running on [http://localhost:8080](http://localhost:8080)

To stop the example:

```bash
make example-down
```

## Connect-Web

grpc-web-devtools now also supports [connect-web](https://github.com/bufbuild/connect-web)!

```ts
// __CONNECT_WEB_DEVTOOLS__ is loaded in as a script, so it is not guaranteed to be loaded before your code.
const interceptors: Interceptor[] = window.__CONNECT_WEB_DEVTOOLS__ !== "undefined" ?
  [window.__CONNECT_WEB_DEVTOOLS__]
  : [];
// To get around the fact that __CONNECT_WEB_DEVTOOLS__ might not be loaded, we can listen for a custom event,
// and then push the interceptor to our array once loaded.
window.addEventListener("connect-web-dev-tools-ready", () => {
  if (typeof window.__CONNECT_WEB_DEVTOOLS__ !== "undefined") {
    interceptors.push(window.__CONNECT_WEB_DEVTOOLS__);
  }
});
// Now we can use the interceptors in our transport
const transport: Transport = createGrpcWebTransport({
  baseUrl: getApiHostname(),
  interceptors,
});
```
This will also work for the connect protocol
```ts
const transport: Transport = ConnectTransportOptions({
  baseUrl: getApiHostname(),
  interceptors,
});
```
