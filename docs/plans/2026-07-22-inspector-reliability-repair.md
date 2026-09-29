# Inspector Reliability Repair Plan

## Summary

Repair the inspector's internal event protocol, connection lifecycle, memory bounds, and UI state while preserving the existing public integration points: `window.__GRPCWEB_DEVTOOLS__` and `window.__CONNECT_WEB_DEVTOOLS__`.

Replay is intentionally removed. Streaming remains represented as bounded history within a request entry. The extension keeps its existing store lineage and advances to version `1.4.2`. No new runtime dependency is required, and existing supported gRPC-Web and Connect-Web application initialization remains compatible.

## Interceptors and event protocol

- Wrap each interceptor in an isolated IIFE so both scripts load in either order without global lexical or function collisions.
- Make gRPC-Web client instrumentation idempotent; repeated enablement must neither re-wrap methods nor recurse.
- Remove replay completely: registries, closures, event listeners, bridge actions, Redux fields, CSS, UI copy, and manifest claims.
- Emit a common internal event envelope with:
  - `captureId`, `transport`, and `requestId`;
  - `phase: start | message | complete | error`;
  - method/type, clone-safe payload fields, string location, and timing/status data.
- Emit `start` before invoking every unary or streaming transport.
- Restore duration, completion timestamp, message count, and time-to-first-message.
- Record Connect iteration failures inside the async stream generator and always rethrow the original RPC error.
- Never send `window.location`; the content script adds `window.location.href` as a string to every event.

## Bridge, identity, and connection health

- Give every content-script document/frame a random `captureId`; derive cache identity from `captureId + transport + requestId`.
- Track multiple content ports per tab in the background instead of overwriting one port when iframes connect.
- Bind a panel port to its tab during `init`; subsequent heartbeats must not depend on another `tabId` field.
- Return heartbeat state containing whether any content frame is connected and notify the panel when content ports connect or disconnect.
- Initialize the toolbar as `pending`; show `connected` only after content registration and `disconnected` when the panel/background port fails. Allow reconnect from pending or disconnected states.
- Use `chrome.devtools.inspectedWindow.tabId` for manual wake-up rather than querying the active tab.
- Make content reconnection acknowledgement-based, capped at five attempts, exception-safe, and reset the attempt count only after an `init_ack`.
- Keep the DevTools navigation listener installed across port reconnects; remove it only during panel unload.

## Memory, streaming, and Redux behavior

- Apply a 5 MiB pre-bridge limit to each serialized payload. Oversized values become clone-safe descriptors containing original byte size and a 2,000-character preview; remove all unsupported download claims.
- Enforce a 5 MiB aggregate cache budget per request/stream entry:
  - preserve the request and terminal error/status first;
  - store at most 100 ordered stream messages;
  - drop oldest messages as count or byte limits are exceeded and expose `messageCount` plus `droppedMessageCount`.
- Store stream completion/status separately; never overwrite a real response with `"EOF"`.
- Render stream messages and terminal errors together so an error after earlier data remains visible.
- Prune composite-key mappings whenever cache entries are evicted.
- Make manual Trash clearing forceful even with Preserve Log enabled; navigation clearing remains preserve-aware.
- Cancel pending Redux batches whenever a real clear occurs so cleared entries cannot reappear.
- Reconcile selection after filtering and log-cap eviction; clear selection if its entry no longer exists.
- Keep the existing 500-entry payload cache and 1,000-entry summary log limits.

## Release and documentation

- Set the extension manifest version to `1.4.2`.
- Keep the `grpc-web-inspector` package identity and synchronize the package-lock root metadata with it.
- Replace the deleted README image reference with the existing light/dark screenshots.
- Update extension and empty-state wording to describe inspection/debugging without replay.
- Remove obsolete replay styles and unused replay-related code.

## Tests and acceptance

Add Jest coverage for:

- loading both interceptor scripts in both orders;
- repeated gRPC-Web enablement;
- immediate start events, success, failure, duration, and streaming terminal states;
- clone-safe Connect error handling while preserving the original exception;
- multiple frames with identical numeric request IDs remaining separate;
- panel/content heartbeat routing, multiple content ports, disconnect notifications, and retry limits;
- pre-bridge truncation, 5 MiB aggregate storage, 100-message stream retention, and mapping eviction;
- manual clear with Preserve Log, pending-batch cancellation, and selection after 1,001 entries;
- streaming messages surviving completion and remaining visible beside terminal errors.

Run the following automated validation:

```sh
npm test -- --watchAll=false
npm run build
git diff --check
```

Smoke-test the built extension against the example application for gRPC-Web and Connect-Web unary success/error, streaming success/error, iframe capture, reconnect, navigation, Preserve Log, and oversized payload behavior.

Acceptance requires a clean tracked worktree, with the existing untracked `.omx/` directory untouched. Nothing is pushed.

## Commit strategy

Commit implementation and its tests in these meaningful stages:

1. `fix: isolate interceptors and normalize request lifecycle`
2. `fix: repair extension bridge health and frame identity`
3. `fix: bound payload and streaming storage`
4. `fix: make log clearing and selection consistent`
5. `chore: align release metadata and documentation`

The primary agent reviews every commit and delegates required corrections back to the same implementation agent without silently including unrelated files.
