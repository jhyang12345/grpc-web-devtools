# Features and troubleshooting

## Efficient debugging workflow

1. Run the package-scoped scanner first:

   ```bash
   node <skill-directory>/scripts/inspect-client.mjs <client-root> --format text
   ```

   Start at every reported `file:line`. If nested packages are reported, rerun
   against the package that owns the browser transport.
2. Trace one path only: dependency -> client or transport factory -> final
   interceptor list -> first RPC. Record all factories or instances, but avoid
   broad refactors while diagnosing.
3. In the inspected page's console, use this read-only capability probe:

   ```js
   ({
     grpcWeb: typeof window.__GRPCWEB_DEVTOOLS__,
     connect: typeof window.__CONNECT_WEB_DEVTOOLS__,
     protobufTs: window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__?.protocolVersion,
   })
   ```

4. Trigger one already-safe application RPC and follow its lifecycle from start
   to completion/error. Do not replay merely as a connectivity probe.
5. Run `--check --format text`, then only the existing validation commands the
   scanner lists. Save the JSON report when opening an issue.

For a useful diagnostic bundle, include the scanner JSON, dependency versions,
the active factory `file:line`, the capability probe, RPC shape, and the first
failing lifecycle phase. Redact request bodies, authorization metadata, tokens,
and service URLs unless they are explicitly safe to share.

### Symptom routing

- **No stack detected:** verify the exact package root, nested workspace, and
  installed dependency namespace.
- **Signals found only in tests/declarations:** locate the runtime setup module;
  types and fixtures do not install the integration.
- **Calls appear only after reload:** fix immediate registration or use a
  late-bound wrapper; do not add delays.
- **Only one client or transport appears:** enumerate all factories and
  long-lived instances.
- **Replay loses auth or tracing:** inspect interceptor order without reordering
  unrelated interceptors.
- **URL is missing or incorrect:** reuse the transport's exact runtime base URL.
- **Capture stops after idle:** inspect bridge connection state before touching
  application RPC code.

## Full-feature checklist

After integrating a supported client:

1. Open browser DevTools and select the gRPC-Web panel.
2. Issue a new unary or server-streaming RPC. Calls made before client
   registration are not captured retroactively.
3. Confirm the entry includes request data, response or stream messages,
   status/error, frame URL, start/completion timestamps, duration, and stream
   time-to-first-message.
4. For non-production validation, select a safe captured call, choose **Edit**,
   change its JSON, and choose **Send request** only when making another real
   backend request is explicitly authorized.
5. Confirm the replay appears as a new entry with provenance linking it to the
   original request.

## Replay boundaries

- Only a request already captured by the extension can be replayed.
- The originating frame and its instrumented client/interceptor must remain
  alive.
- Handles do not expire based on elapsed time and are limited to the 100 most
  recently used handles per transport.
- The full request must remain in the panel payload cache and be 5 MiB or
  smaller.
- Reloading, navigating, or browser-discarding the page destroys its live
  client objects and handles.
- Replay makes a real backend call. Depending on interceptor order, it may reuse
  captured metadata or obtain fresh credentials from application interceptors.
- Client-streaming and bidirectional-streaming are outside this integration's
  supported feature set.

## Diagnostics

### No entries appear

- Confirm the matching `window` API exists in the page, not the extension
  console.
- Reload with DevTools open and issue a fresh RPC.
- For generated `grpc-web`, confirm every constructed client is registered and
  both the immediate check and readiness listener exist.
- For Connect-ES or protobuf-ts, confirm the late-bound wrapper is present in
  the transport's actual interceptor list.
- Trace factories and dependency injection if the configured transport differs
  from the transport used by the generated service client.

### Entries stop after the tab is idle

Current extension builds reconnect the panel and content bridge automatically
with acknowledgement timeouts and exponential backoff. Wait briefly or choose
**Reconnect now**. Do not add application RPCs or timers solely to keep an
extension worker alive.

If the browser discarded the entire tab, reload and capture again. Extension
bridge recovery cannot restore page objects destroyed by tab discard.

### Replay is unavailable or rejected

- Capture a fresh request if the frame reloaded or the handle was evicted.
- Check for payload truncation or the 5 MiB limit.
- For generated `grpc-web`, add a method-specific `createRequest` or `fromJson`
  adapter when protobuf setters cannot reconstruct nested/custom values.
- Preserve the DevTools interceptor before auth/retry interceptors so replay
  reaches the intended pipeline.
