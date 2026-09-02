# RPC Replay, URL, and Timing Implementation Plan

## Goal

Add three user-facing debugging capabilities without weakening the inspector's
current lifecycle, iframe identity, or memory guarantees:

1. edit and resend a captured gRPC-Web or Connect-Web request;
2. show the URL that originated the request in the list and details views; and
3. show request start, completion, duration, and streaming time-to-first-message.

The existing public integration points remain compatible:

- `window.__GRPCWEB_DEVTOOLS__(clients)`
- `window.__CONNECT_WEB_DEVTOOLS__(next)`

No new extension permission or runtime dependency is required.

## Scope and feasibility

### Captured request replay

The first release supports editing and resending a request that the extension
has already captured. The replay is available only while the originating
document/frame and its instrumented client or interceptor remain alive.

The replayed request is a real backend call. It receives a new request ID and
appears as a separate request in the network list, with a link back to the
original request.

### Arbitrary uncaptured RPCs

The extension cannot safely discover every protobuf request type and callable
service method from JavaScript runtime values. Sending an RPC that has never
been captured therefore requires an application-provided method adapter.

This implementation adds the non-breaking request-construction registration
surface needed by captured replay:

```js
window.__GRPCWEB_DEVTOOLS__.registerMethod("/package.Service/Method", {
  fromJson(json, originalRequest) {
    return RequestType.fromJson(json);
  },
});
```

The same adapter can be extended later with an `invoke` function and method
catalog to support a standalone "New RPC" composer. A generic uncaptured-RPC
composer is not part of the initial acceptance criteria.

## Existing baseline

The reliability repair already provides:

- isolated interceptor scripts and idempotent gRPC-Web instrumentation;
- `start`, `message`, `complete`, and `error` lifecycle phases;
- per-frame `captureId` values and cache keys based on
  `captureId + transport + requestId`;
- `requestTimestamp`, `completionTimestamp`, `duration`, message count, and
  time-to-first-message;
- exact frame `window.location.href` strings added by the content script;
- a 5 MiB per-entry cache budget, 100 retained stream messages, a 500-entry
  payload cache, and a 1,000-entry summary list; and
- multiple content ports per inspected tab.

URL and timing work is therefore primarily presentation and filtering work.
Replay requires a new command protocol, exact-frame port routing, bounded
page-context handles, request reconstruction, and editor state.

## Replay architecture

### Identity

Each replayable captured request receives a cryptographically random opaque
`replayToken`. Numeric request IDs are never used as replay capability tokens.

The request's standard `start` event includes:

```js
{
  replay: {
    token: "<opaque token>",
    available: true,
  },
}
```

The content script already adds `captureId`. The panel addresses a replay with:

```js
{
  action: "replay_request",
  target: "content",
  data: {
    captureId,
    replayToken,
    transport,
    request,
    sourceEntryId,
  },
}
```

The replayed lifecycle contains a clone-safe provenance descriptor:

```js
{
  replayedFrom: {
    captureId,
    transport,
    requestId,
  },
}
```

The replay itself always receives a new normal request ID. It uses the same
`start/message/complete/error` lifecycle and cache path as every other call.

### Exact-frame bridge routing

The panel must not evaluate replay code through
`chrome.devtools.inspectedWindow.eval`, and the background worker must not
broadcast a replay command to every content frame.

The bridge is:

```text
panel -> background -> content port for captureId -> page interceptor
page interceptor -> content port -> background -> panel
```

The background connection state changes from only a `Set` of content ports to:

- the existing set, used for connection-health accounting; and
- a `captureId -> content port` map, used for addressed commands.

Content `init` already contains its `captureId`. Registration records the
mapping, replacement removes an older mapping for the same document identity,
and disconnect cleanup removes every mapping owned by the disconnected port.

If the capture ID is missing or stale, the background returns a
`replay_rejected` result to the panel instead of broadcasting the command.

The content script accepts only a command whose `captureId` equals its own. It
posts a dedicated page event for the interceptor and relays acknowledgement or
rejection events back to the panel. Command/result queues remain bounded.

### Page-context replay registry

Replay closures stay in the inspected page, never Redux, the payload cache, the
background worker, or the content script.

Each interceptor owns a private registry inside its IIFE:

- maximum 100 handles per transport;
- LRU eviction on registration and use;
- no time-based expiration while the originating page remains alive;
- random opaque tokens;
- cleanup on page unload; and
- no response or stream-message history retained by a handle.

A handle contains only the minimum invocation state:

- transport and method information;
- original unwrapped invocation function and receiver;
- request constructor/template needed for reconstruction;
- original metadata/options that the transport can safely reuse; and
- source request identity for provenance.

The UI treats a replay handle as unavailable when:

- its token was evicted;
- the originating frame disconnected or navigated;
- the request payload was evicted from the panel cache;
- the captured request is a truncation descriptor;
- the edited request exceeds 5 MiB; or
- request reconstruction is unsupported.

The registry limit is independent of the existing payload-cache limits.

### Command acknowledgement

`Send request` has two distinct outcomes:

1. `replay_ack`: the page accepted the token and began invocation; and
2. `replay_rejected`: no invocation occurred, with a clone-safe reason.

Actual RPC success and failure are represented only by the newly emitted
request lifecycle. An acknowledgement is not presented as RPC success.

Each panel command includes a random `replayAttemptId`. The panel keeps at most
20 pending attempts, resolves or rejects only a response with the matching ID,
and treats a replaced/disconnected panel port as a rejection. The editor
disables repeat submission while a command is awaiting acknowledgement. A
five-second timeout restores the button and reports that the originating frame
may no longer be available.

## Request reconstruction

### Connect-Web

Capture the original `next`, request message constructor, and a shallow request
template. Reconstruct edited messages in this order:

1. static `constructor.fromJson(json)`;
2. static `constructor.fromJsonString(JSON.stringify(json))`;
3. `new constructor(json)`;
4. instance `fromJson` or `fromJsonString`.

Invoke captured `next` with a copied request and the reconstructed message.
Never mutate the original request.

An already-aborted signal or expired deadline must not be silently reused.
Where the Connect request shape permits it, omit the stale signal so the
transport creates fresh cancellation state. Otherwise reject replay with a
specific error and direct the application to an adapter.

Streaming replays use the existing generator wrapper, record iterator failures,
and rethrow the exact original RPC exception.

### gRPC-Web

Invoke the original unwrapped `rpcCall`, `unaryCall`, or `serverStreaming`
implementation captured when the client was first instrumented. The ordinary
instrumentation path creates the new lifecycle event; a replay must not
re-instrument the client or recurse through wrappers.

Request construction uses:

1. a registered per-method `fromJson` or `createRequest` adapter, when present;
2. a cloned original request plus generated protobuf setters as fallback.

The fallback supports:

- scalar and enum fields;
- bytes values accepted by the generated setter;
- repeated scalar fields;
- nested or repeated message fields when their type can be inferred from an
  existing value in the original request.

It rejects, rather than guesses, fields that have no generated setter or unset
nested/repeated message fields whose protobuf type cannot be inferred.

Original metadata and method information are reused by default. Metadata
editing is deferred because metadata representations and authentication
semantics differ between clients.

### Adapter API compatibility

`window.__GRPCWEB_DEVTOOLS__` remains callable exactly as before. Static helper
properties are attached to that function:

```js
window.__GRPCWEB_DEVTOOLS__.registerMethod(method, adapter);
window.__GRPCWEB_DEVTOOLS__.unregisterMethod(method);
```

Replacing the public enablement function after script re-evaluation preserves
the private method-adapter map for that document. Registration validates
function shapes and does not expose replay handles.

Connect-Web uses generated request constructors by default. A symmetrical
optional registration surface may be added only if tests demonstrate a request
type that cannot be reconstructed through the standard Connect APIs.

## URL behavior

The exact origin string already supplied by the content script is retained as
`location`. Because content scripts run in every frame, this value is labeled
`Frame URL`; it can differ from the top-level inspected page for iframe RPCs.

The network list shows:

- endpoint/method on the first line;
- compact host and path on the second line; and
- timing on the third line or in the remaining horizontal space.

The full, unmodified URL is available through a tooltip. Invalid or nonstandard
URL strings fall back to the original text rather than throwing during render.

Filtering includes the full URL in addition to method, endpoint, and method
type. Later lifecycle events must not replace the start event's location.

Top-level page URL capture can be added later as a separate `pageLocation`
field. It must not replace the exact frame URL or rely on cross-origin
`window.top` access.

## Timing behavior

Keep wall-clock timestamps for user-visible start and completion times. Add a
monotonic start value from `performance.now()` inside each interceptor and use
it to calculate durations and time-to-first-message so system clock changes do
not produce negative or inaccurate elapsed times.

Do not send the raw monotonic clock value across extension boundaries.

The network list displays:

- start time with milliseconds;
- `Pending` before a terminal event;
- duration after completion or error; and
- an error style without hiding duration.

The details metadata displays:

- Frame URL;
- Started;
- Completed, or `Pending`;
- Duration;
- Time to first message for streams;
- observed and dropped message counts;
- status, transport, and approximate payload size.

A terminal timestamp is written once. A duplicate stream status/error callback
must not alter the original completion time.

## Editor UI

The request pane gains an explicit edit mode:

- `Edit` copies the captured request JSON into local component state;
- an editable monospace textarea replaces the read-only request view;
- `Format` parses and pretty-prints valid JSON;
- `Reset` restores the captured payload;
- `Cancel` leaves edit mode without changing the captured entry; and
- `Send request` validates and submits the edited object.

Editor text remains component-local and is never stored in Redux. Byte-size
validation occurs on submit rather than on every keystroke.

The UI clearly states that sending performs a real backend request and may
reuse captured metadata/authentication. It never auto-retries.

Replay is disabled with a useful reason for truncated, evicted, expired, or
unsupported requests. A successful acknowledgement shows a short toast and the
new request appears naturally in the list. Replayed rows/details show
`Retry of <method/request ID>` provenance.

## State and cache changes

Summary entries add only small replay/provenance fields:

- replay token/availability;
- replayed-from identity; and
- existing location/timing references.

Full request bodies remain only in the bounded payload cache. Replay closures
remain only in the page. No editor text enters Redux.

Cache merge behavior preserves the start event's replay descriptor and
location. Composite identity remains unchanged. Cache eviction, manual clear,
navigation clear, filtering, batching, and selection reconciliation retain
their existing reliability behavior.

## Implementation stages and commits

Tests accompany the stage they validate.

1. `docs: add rpc replay url and timing plan`
2. `feat: show request url and lifecycle timing`
   - URL formatting, tooltip, filtering, row layout, details metadata, and
     monotonic elapsed timing.
3. `feat: route replay commands to exact frames`
   - capture-ID port map, content/page command bridge, acknowledgements, stale
     frame rejection, and bridge tests.
4. `feat: add bounded rpc replay handles`
   - private TTL/LRU registries, replay tokens, provenance, gRPC-Web and
     Connect-Web invocation paths, reconstruction helpers, and interceptor
     tests.
5. `feat: add editable request replay`
   - local JSON editor, validation, disabled reasons, confirmation wording,
     submission state, toasts, and UI/state tests.
6. `docs: document edited rpc replay`
   - integration API, reconstruction limits, safety warning, screenshots if
     available, and release metadata appropriate for a feature release.

Every meaningful stage is committed independently. Nothing is pushed.

## Automated test matrix

### Interceptors

- scripts still load in either order without collisions;
- repeated gRPC-Web enablement remains idempotent;
- callback unary, Promise unary, and server-streaming replay each invoke the
  original transport once and emit one start plus one terminal lifecycle;
- replay never recursively registers or double-captures a call;
- Connect constructors and gRPC-Web adapter/fallback reconstruction work;
- unsupported unset nested protobuf edits reject before backend invocation;
- streaming data survives terminal success/error;
- Connect iterator errors remain clone-safe while the original exception is
  rethrown;
- replayed calls have new IDs and correct provenance;
- registry entry 101 evicts the least-recently-used handle;
- handles remain replayable regardless of elapsed time; and
- unload cleanup makes handles unavailable.

### Bridge

- three frames register distinct capture IDs under one tab;
- a replay addressed to frame B reaches only frame B;
- missing/stale capture IDs reject without broadcast;
- disconnect removes only the affected capture mappings and notifies the panel;
- malformed commands do not reach the page;
- acknowledgement and rejection reach the panel;
- command queues and reconnect attempts remain bounded; and
- existing heartbeat and network-event routing still work.

### UI and state

- full URL participates in filtering;
- frame URL is compacted safely and exposed in a tooltip;
- malformed URLs render without failure;
- pending rows become completed/error rows without duplication;
- start, completion, duration, and stream TTFM render correctly;
- edit, format, reset, cancel, and send states work;
- invalid JSON and payloads over 5 MiB reject locally;
- a double click results in one replay command;
- truncated, evicted, and stale requests explain why replay is unavailable;
- provenance is visible on replayed entries; and
- clear/navigation/cache-cap selection behavior does not regress.

## Validation and acceptance

Run:

```sh
npm test -- --watchAll=false
npm run build
git diff --check
```

Smoke-test the built extension against the example application and a
Connect-Web fixture for:

- unary success and error;
- streaming success and data-then-error;
- edited scalar and repeated parameters;
- supported nested parameters and explicit unsupported nested parameters;
- iframe capture and exact-frame replay;
- frame reload followed by stale-token rejection;
- URL rendering and URL filtering;
- pending-to-terminal timing and TTFM;
- edited JSON larger than 5 MiB;
- navigation, reconnect, and Preserve Log; and
- registry/cache limits under repeated calls.

Acceptance requires:

- no regression to the existing 5 MiB/100-message/500-cache/1,000-summary
  bounds;
- no replay closure, editor text, or duplicate payload retained in Redux;
- no new extension permission or runtime dependency;
- existing initialization APIs remain source-compatible;
- all automated validation passes;
- the tracked worktree is clean; and
- the existing untracked `.omx/` directory remains untouched.
