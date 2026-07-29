# Features and troubleshooting

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
