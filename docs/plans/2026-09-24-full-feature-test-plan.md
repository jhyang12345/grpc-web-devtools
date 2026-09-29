# Full feature test plan: every supported client stack, every RPC shape

Date: 2026-09-24
Branch: `feat/memory-leak-fixes`
Status: executed (see "Execution log" at the end)

## 1. Why this plan exists

The repository already has 28 Jest suites (201 tests). Every one of them runs
the page interceptors against **hand-written mocks** of the client libraries
(`{ client_: { rpcCall: jest.fn() } }`, `{ toJson: jest.fn() }`, fake
`UnaryCall` objects). Those tests prove the interceptors behave correctly
*given the shapes we assumed*. They cannot prove:

1. that the shapes we assumed match what the real libraries hand us,
2. that real protobuf values (int64, bytes, maps, oneofs, `Any`, well-known
   types) survive serialization → `postMessage` → content script → background
   → panel cache → UI,
3. that an edited replay is rebuilt into a real message and actually changes
   what the backend receives,
4. that one pipeline behaves the same for every supported client stack.

This plan closes those gaps with a real-library end-to-end layer, and keeps the
existing unit suites as the fast inner loop.

## 2. What "supported" means (the matrix)

### 2.1 Client stacks

| ID | Stack | Page API | Wire protocol | Message model |
| --- | --- | --- | --- | --- |
| GW-T | generated `grpc-web` (`protoc-gen-grpc-web` 1.5, `mode=grpcwebtext`) + `google-protobuf` 3.21 | `__GRPCWEB_DEVTOOLS__([client])` | gRPC-Web text (base64) over XHR | jspb classes, `toObject()` |
| GW-B | same, `mode=grpcweb` | same | gRPC-Web binary over XHR | same |
| C1-GW | Connect-ES **v1** (`@connectrpc/connect-web` 1.7, `@bufbuild/protobuf` 1.10) `createGrpcWebTransport` | `__CONNECT_WEB_DEVTOOLS__` interceptor | gRPC-Web binary over fetch | classes with `toJson()` / static `fromJson()` |
| C1-CN | Connect-ES v1 `createConnectTransport` | same | Connect (JSON) over fetch | same |
| C2-GW | Connect-ES **v2** (`@connectrpc/connect-web` 2.2, `@bufbuild/protobuf` 2.x) `createGrpcWebTransport` | same | gRPC-Web binary over fetch | **plain objects** with `$typeName`, `bigint`, `Uint8Array` |
| C2-CN | Connect-ES v2 `createConnectTransport` | same | Connect (JSON) over fetch | same |
| PT | protobuf-ts 2.11 `GrpcWebFetchTransport` | `__GRPCWEB_DEVTOOLS_PROTOBUF_TS__` `RpcInterceptor` | gRPC-Web binary over fetch | plain objects + `MessageType.toJson()` |

Each gRPC-Web client flavor is exercised both as a callback client and as a
promise client (`*PromiseClient`), because they reach the transport through
different entry points (`rpcCall` vs `unaryCall` → `rpcCall`).

### 2.2 RPC shapes

| Shape | Covered | Notes |
| --- | --- | --- |
| Unary | yes | success, gRPC status error, network error, trailers-only error |
| Unary with `google.protobuf.Empty` in/out | yes | proves empty requests/responses render as `{}` not "missing" |
| Server streaming | yes | N messages, 0 messages, error before first message, error after N messages |
| Client streaming / bidi | **out of scope** | not possible from browser gRPC-Web or Connect-Web fetch clients; no page API accepts them |

### 2.3 Protobuf field shapes (fixture `e2e/proto/kitchen.proto`)

`KitchenSink` contains one field of every shape the panel must display and
replay: all 15 scalar types (double, float, int32, int64, uint32, uint64,
sint32, sint64, fixed32, fixed64, sfixed32, sfixed64, bool, string, bytes), an
enum, a nested message, repeated scalars, repeated messages, `map<string,string>`,
`map<int32,Message>`, a three-way `oneof`, a proto3 `optional`, and the
well-known types `Timestamp`, `Duration`, `StringValue`, `Int64Value`, `Any`
(packing `Note`) and `Struct`.

Every stack serializes these differently. The expected, per-stack JSON the
inspector shows is pinned in the tests (for example grpc-web `toObject()` yields
`tagsList`, maps as `[[k, v]]` pairs and enums as numbers, while Connect v1 and
protobuf-ts produce canonical proto3 JSON with int64 as strings and enums as
names).

## 3. Test layers

```
  Layer 0  existing unit suites (mocks)                       fast, run on every change
  Layer 1  real client  -> real wire -> in-process server     "contract": what the page API emits
  Layer 2  Layer 1 + content-script + background + React panel "pipeline": what the user sees
  Layer 3  manual browser checklist (Chrome + Firefox)         release gate only
```

### 3.1 Harness (new, `e2e/`)

| File | Purpose |
| --- | --- |
| `e2e/proto/kitchen.proto`, `e2e/buf*.yaml` | Fixture service; regenerated with `npm run e2e:generate` (remote BSR plugins, output committed). |
| `e2e/gen/**`, `e2e/connect-v1/gen/**` | Real generated code for every stack. |
| `e2e/connect-v1/package.json` | Connect v1 + protobuf-es v1 are installed in this isolated package because they peer-conflict with protobuf-es v2 at the root (`npm run e2e:setup`). |
| `e2e/harness/environment.js` | Jest environment: jsdom (DOM, XHR, React) plus Node's real `fetch`, streams, `AbortController`, `structuredClone`. |
| `e2e/harness/server.js` | In-process `KitchenService` speaking gRPC-Web binary, gRPC-Web text, and Connect unary/streaming (JSON and binary), with CORS like Envoy; records every decoded request. |
| `e2e/harness/extension.js` | Boots the real extension in one jsdom window: `background.js` in a VM context, `content-script.js`, all three page interceptors, and the real panel (`src/index.js`) with a fake `chrome.runtime` whose ports deliver asynchronously through `structuredClone` (so non-cloneable payloads fail exactly as in Chrome). `window.postMessage` is replaced with a spec-shaped async version that sets `event.source`. |
| `e2e/harness/stacks.js` | One adapter per stack: `install()`, `unary(requestJson)`, `stream(requestJson)`, `ping()`, and the stack's expected transport name / method naming. |
| `e2e/harness/scenarios.js` | Shared scenario matrix + `waitFor` helpers used by every stack suite. |

Server scenarios are selected by fields on `EchoRequest`
(`scenario`, `count`, `error_code`), so every client stack drives identical
backend behavior.

### 3.2 Layer 1 — contract matrix (per stack × shape × scenario)

For each stack in 2.1 and each row below, assert on the page-level
`__GRPCWEB_DEVTOOLS__` events **and** on the application-visible result (the
instrumentation must never change what the app sees).

| # | Scenario | Assertions |
| --- | --- | --- |
| C1 | Unary success with fully populated `KitchenSink` | exactly `start` then `complete`; same `requestId`; `transport`; `methodType: "unary"`; method name form for the stack; `backendUrl` present where the stack exposes one; request and response JSON equal the stack's pinned representation; `timing.requestTimestamp ≤ completionTimestamp`, `duration ≥ 0`, `messageCount: 1`; replay descriptor `{ available: true, token }`; the app receives the real response object. |
| C2 | Unary gRPC status error (`NOT_FOUND`, `INTERNAL`) | `start` then `error`; `error.code` equals the status in the stack's code form; message preserved; `isNetworkError` absent; app still receives the library's own error type. |
| C3 | Unary network failure (socket destroyed) | `error` with `isNetworkError: true` where the library surfaces a `TypeError`; otherwise the library's `UNAVAILABLE`/`UNKNOWN` code is recorded and the panel shows an error, never a hang (no event left pending). |
| C4 | Unary trailers-only error (gRPC-Web stacks) | status in HTTP headers with no body is still captured as `error` with the right code. |
| C5 | `Ping(Empty) → Empty` | request and response captured as `{}` (not `undefined`), so the panel shows an empty object rather than "missing payload". |
| C6 | Server stream, 3 messages, OK | `start`, 3× `message` (ordered, `timing.messageCount` 1..3, `timeToFirstMessage ≥ 0`), `complete` with `messageCount: 3`; app receives 3 messages. |
| C7 | Server stream, 0 messages, OK | `start`, `complete`, `messageCount: 0`, `timeToFirstMessage: null`. |
| C8 | Server stream fails before first message | `start`, `error` with code; no `message` events. |
| C9 | Server stream fails after 2 messages | 2× `message` then `error`; `messageCount: 2`; exactly one terminal event. |
| C10 | Concurrent calls (unary ×3 + stream) | every `requestId` unique, events never cross-attributed, each call terminal exactly once. |
| C11 | Instrumentation absent | with the page API not yet installed, the late-bound wrapper calls through and the app works (no capture, no throw). |
| C12 | App cancels a 40-message stream after 2 messages, in each way that really cancels on the stack (grpc-web `stream.cancel()`; Connect and protobuf-ts: abort the call signal) | exactly one terminal `cancelled` event with timing and no `error`, nothing recorded after it, and the panel entry ends with `terminalPhase: "cancelled"` and no error. A second variant cancels 50 ms into a `slow-start` stream, before the server sends headers: still one `cancelled` event with `messageCount: 0`, and nothing recorded afterwards. |

### 3.3 Layer 1 — replay matrix (per stack)

| # | Scenario | Assertions |
| --- | --- | --- |
| R1 | Replay unary unmodified | ack message returned; a new `start`/`complete` pair with `replayedFrom: { captureId?, transport, requestId: <original> }`; backend received a second identical request. |
| R2 | Replay unary with edited scalar, enum, repeated, nested and map fields | backend's decoded request contains the edited values (proves reconstruction, not just capture). |
| R3 | Replay server stream | backend receives the stream request again; replayed stream is drained and recorded with provenance and terminal event. |
| R4 | Replay rejected: unknown token, non-object body, > 5 MiB body | `__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__` with a reason; backend not called. |
| R5 | grpc-web adapter (`registerMethod` / `unregisterMethod`) | registered adapter is used; after unregister the default setter path is used again. |
| R6 | Replay preserves the rest of the interceptor chain | an app interceptor placed after the DevTools wrapper runs again on replay (auth header present on the replayed request). |

### 3.4 Layer 2 — full pipeline (per stack, through the real panel)

| # | Scenario | Assertions |
| --- | --- | --- |
| P1 | Unary + stream + error traffic | panel store `network.log` has one summary per call with the right `methodType`, `transport`, `terminalPhase`, `error`/`isNetworkError`, `messageCount`; the full cache entry (`getNetworkEntry`) holds request, response / ordered `messages`, `error`, timing and the frame `location`. |
| P2 | Every protobuf field shape reaches the panel | the cached request equals the page-level request JSON byte-for-byte (nothing dropped by `structuredClone`, the content-script bounds, or the cache bounds). |
| P3 | UI render | the list renders a row per call (method endpoint visible, error badge for failures); selecting a row with `mousedown` renders the Request pane JSON and Response pane. |
| P4 | Replay through the UI | Edit → change JSON → Send request; the replay bridge acks, a new row labelled as a replay appears, and the backend received the edited value. |
| P5 | Debug report | the Markdown and JSON "Copy report" builders for a captured entry contain the URL, request and response, and never the replay token. |
| P6 | Audit report | `buildAuditReport` over the captured traffic lists the errors first, the network error classification, and redacts query strings. |
| P7 | Filter / clear / preserve-log | filtering by method narrows the list; clear empties both log and cache; with Preserve Log on, navigation keeps entries but a hard reload clears them. |

### 3.5 Layer 2 — bounds and resilience with real payloads

| # | Scenario | Expected |
| --- | --- | --- |
| B1 | Stream of 120 messages | panel retains the newest 100, `droppedMessageCount: 20`, `messageCount: 120`. |
| B2 | Request > 5 MiB (large `bytes` / string field) | content script replaces it with a `__truncated` descriptor; replay reports unavailable; app call still succeeds. |
| B3 | Panel port disconnect mid-stream | content script queues and flushes after reconnect; the stream still ends in exactly one entry. |
| B4 | Two frames (two content-script instances) | replay is routed only to the originating frame's `captureId`. |

### 3.6 Layer 3 — manual release checklist (not automated)

Run with `make example-up` and the unpacked `build/` in Chrome and Firefox:

1. Panel appears as **gRPC-Web** in DevTools; empty state links to the setup guide.
2. Example traffic appears live: unary, `AlwaysError`, streaming with and without error.
3. Dark/light theme follows DevTools; Korean via the settings gear.
4. Close and reopen DevTools: Preserve Log choice persists; traffic resumes.
5. Service-worker restart (`chrome://serviceworker-internals` → Stop): panel reconnects, no lost rows.
6. Hard reload clears even with Preserve Log on; normal reload respects it.
7. Edit + Send on a unary and a streaming call hits the backend (check server log).
8. Audit report downloads with a host-scoped filename; Copy report pastes Markdown.

## 4. Known risks to probe (hypotheses the matrix must confirm or refute)

1. **Connect-ES v2 messages are plain objects.** The Connect interceptor
   serializes with `message.toJson()` and rebuilds replays with
   `constructor.fromJson()`. v2 messages have neither, carry `$typeName`, use
   `bigint` for 64-bit fields and `Uint8Array` for bytes. Expected: capture of
   any message with an int64/bytes field is dropped as "unsupported payload" by
   the content-script bounds, and replay cannot rebuild a typed message.
2. **grpc-web `toObject()` naming** (`tagsList`, `labelsMap`) differs from the
   setter names used by replay reconstruction; map fields may not be
   replayable without an adapter.
3. **Trailers-only and network failures** differ per library (XHR vs fetch) and
   may surface as a status code instead of a `TypeError`.

## 5. Execution order

1. Tooling: add real libraries as exact-pinned devDependencies; isolated
   Connect v1 package; `e2e:generate`, `e2e:setup`, `test:e2e` scripts.
2. Harness: environment, server, extension boot, stack adapters.
3. Layer 1 contract + replay matrix for GW-T, GW-B, C1-*, C2-*, PT.
4. Layer 2 pipeline, UI, reports, bounds.
5. Triage: every failure is either a test bug (fix the test) or a product bug
   (fix the product with a focused change, keep the test as the regression).
6. Full suite green: existing 201 tests + the new layers. Record results below.

## 6. Exit criteria

- Every cell of 3.2–3.5 is a passing test, or is an explicit, commented
  `test.failing`/skip with the reason and linked finding.
- `npm test` (all layers) passes from a clean checkout after `npm ci` and
  `npm run e2e:setup`.
- `npm run build` still succeeds (test-only dependencies do not enter the bundle).

## 7. Execution log

### Result

| Suite | Tests | Result |
| --- | --- | --- |
| Existing unit suites (28) | 201 | pass (unchanged) |
| Layer 1+2 stack matrix: 9 stacks × 16 scenarios (C1–C10, R1–R4, R6, P4), plus C12 per cancel path (2 variants × 9 stacks) | 162 | pass |
| Layer 2 pipeline (`e2ePipeline.test.js`: P3–P7, B1, B2, C11, R5) | 11 + 1 skipped | pass; B3 skipped as a known issue (F7) |
| Review follow-up unit test (client-streaming guard) | 1 | pass |
| Cancelled-stream panel state (cache, row badge, audit) | 3 | pass |
| **Total** | **379** | **378 pass, 1 skipped, 0 fail** |

Section 4's hypotheses were all confirmed. The matrix found the following
product bugs, which have been fixed. Each one has regression coverage in the
matrix.

| ID | Finding | Affected | Fix |
| --- | --- | --- | --- |
| F1 | The whole payload was replaced with "[unsupported, cyclic, or oversized payload omitted]" whenever it contained `undefined`, which google-protobuf `toObject()` emits for every unset oneof member and sub-message. In practice most real grpc-web requests and stream messages were blanked in the panel. | grpc-web (all) | `inspectPayload` in `content-script.js` and `networkCache.js` accepts `undefined`. |
| F2 | grpc-web replay rejected any message with a map field (`Repeated field "labelsMap" cannot be set`). It also rebuilt messages by setting every `toObject()` key, so a oneof's untouched default member cleared the member that was actually set. | grpc-web replay | Replay clones the captured request and applies only the changed fields; maps go through the `jspb.Map` getters; nested edits are applied in place. |
| F3 | Real network failures were never flagged. grpc-web reports them as `UNKNOWN` with "http status code: 0"; protobuf-ts rethrows them as `RpcError INTERNAL "Failed to fetch"`. The old check (`instanceof TypeError`) only matched hand-written mocks. The audit report then counted them as "RPC error (UNKNOWN)". | grpc-web, protobuf-ts | Classified as network errors. The client-synthesized code moves to `clientStatusCode` so the panel and audit report say "no gRPC status captured". |
| F4 | Connect-ES v1 capture failed entirely (`__error`, replay unavailable) for any message containing `google.protobuf.Any`: `toJson()` needs the transport's type registry, and interceptors never see it. | Connect v1 | Retry with a fallback registry that shows (and replays) `Any` as raw base64 bytes. |
| F5 | Connect-ES v2 (protobuf-es v2, the current major) was effectively unsupported. Its messages are plain objects with no `toJson`: 64-bit fields are `bigint`, which the bounds rejected, so payloads were dropped. Replay could not rebuild a typed message. | Connect v2 | Descriptor-driven canonical proto3 JSON writer/reader built from `req.method.input/output`, including protobuf-es v2's wrapper and `Struct` unboxing. |
| F6 | Connect passes a server-streaming call's input to interceptors as an `AsyncIterable`, so every Connect stream request was captured as `{}` and replay sent a non-iterable. | Connect v1 + v2 streams | The single input message is read, captured, and passed on as an equivalent iterable; replay wraps it the same way. |
| F9 | A stream the app cancelled never ended in the panel: it showed "Pending" forever and the audit report eventually flagged it as a stuck request. This is the normal end of a long-lived subscription, for example one closed on unmount. grpc-web `stream.cancel()` emits no `status`, `end` or `error`. Connect's promise client hides `return()` from the app, so after an abort the interceptor's generator is never resumed. protobuf-ts reported an abort as `INTERNAL "AbortError: ..."`, a server error that never happened. | grpc-web, Connect v1 + v2, protobuf-ts streams | New terminal phase `cancelled`: grpc-web wraps `cancel()`; Connect watches the call signal, including an abort before the response arrives (a `DEADLINE_EXCEEDED` abort stays an error); protobuf-ts checks the abort signal (an `AbortSignal.timeout()` stays an error). The panel shows a neutral "Cancelled" badge, and the audit report neither counts it as an error nor as pending. |

Open items:

| ID | Finding | Status |
| --- | --- | --- |
| F7 | After an MV3 service-worker restart, the content script and the panel reconnect independently. Events the content script flushes before the panel re-binds are dropped by the background (`connection.panel` is null). A 40-message stream lost its first 18 messages. | Known issue; test B3 is skipped. The fix needs a buffering policy (where, how long, how many bytes), which costs memory while DevTools is closed. |
| F8 | protobuf-ts passes `grpc-message` to the app still percent-encoded (`scenario%20failure%205`). The inspector shows what the app sees. | Library behavior; documented in the C2 assertion. |
| F10 | Leaving a `for await` loop early does not cancel a Connect (promise client) or protobuf-ts stream: the library keeps the HTTP request open. The entry stays open because the call really is still open. | Library behavior; C12 covers only the cancel paths each library honors. |
| B4 | Multi-frame replay routing is not exercised end to end: two content scripts cannot share one jsdom window. | Covered by `bridge.test.js` unit tests. |

Harness gaps that were fixed in the harness, not in the product: jsdom returns
partial `arraybuffer` XHR responses before DONE (which made grpc-web binary
streams re-emit messages), Node `fetch` rejects with an out-of-realm
`TypeError`, jsdom has no `CSS` global, and jsdom's `postMessage` leaves
`event.source` null.

### Independent review follow-up

A separate code review of the product changes found no critical or high
issues. It raised two medium issues, both now fixed:

- The Connect `post()` could throw `DataCloneError` on the app's RPC path. It
  is now guarded, as it already was in the protobuf-ts interceptor.
- Client-streaming and bidi inputs are open-ended. They are no longer
  serialized or offered for replay.

Server-streaming input materialization now reports an error event if the input
iterable throws. Low-severity items remain open for later: range checks for
edited 64-bit and bool values in the v2 codec, clearing a deleted proto3 scalar
in grpc-web replay, and message-valued maps whose captured map was empty.
