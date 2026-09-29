# Request-based RPC mocking

**Date:** 2026-08-03
**Status:** Proposed

## Goal and interpretation

Add an opt-in mocking mode that examines an intercepted RPC request and, when
an enabled rule matches, returns a locally constructed protobuf response
without contacting the backend.

This plan interprets "fill a request" as "fulfil a matching request with a
mock response." Rewriting the outbound request and still sending it to the
backend is a different, higher-risk feature and is not included in the first
release.

The first release uses declarative rules that are temporarily hard-coded in
the extension bundle. The rule transport, state, and UI should not depend on
that storage choice, so a later in-panel rule editor can replace the built-in
catalog without changing the interceptors.

## Recommended first release

- Mock unary gRPC-Web, Connect-Web, and protobuf-ts calls only.
- Match the transport, method type, page origin, backend RPC identity, and
  zero or more exact request-field conditions.
- Return a successful, hard-coded protobuf JSON response locally.
- Never call the real transport after an enabled rule has matched.
- Pass unmatched requests through normally.
- Keep every rule disabled until the user explicitly arms mocking.
- Disarm all rules on navigation, bridge disconnect, or DevTools panel close.
- Clearly label mocked calls in both the request list and details view.
- Keep streaming, arbitrary JavaScript matchers, regular expressions,
  metadata mutation, persistence, and response-error simulation out of v1.

## User experience

### Discoverability

Add a **Mocks** button to the main toolbar. Its presentation has three states:

- `Mocks off`: neutral button and no rules are active.
- `Mocks ready (N)`: rules are selected but not armed.
- `Mocks on (N)`: amber active state with the number of armed rules.

Selecting the button opens a right-side drawer rather than replacing the
captured request list. This keeps captured traffic visible while the user
checks or disables a rule.

### Mock drawer

The drawer contains:

1. A master **Arm mocking** switch.
2. The safety sentence: "Matched requests stay local. Unmatched requests still
   go to the backend."
3. A one-click **Disable all** action.
4. A compact rule list showing:
   - enabled checkbox;
   - human-readable rule name;
   - exact RPC method and transport;
   - short request-match summary;
   - `Built in` badge;
   - readiness state; and
   - session hit count.
5. A read-only rule detail section showing scope, conditions, and formatted
   response JSON.

Arming for the first time in a panel session shows a confirmation with the
exact number of enabled rules and makes it explicit that unmatched calls still
use the real network. Do not show confirmation on each individual match.

If a rule is invalid, ambiguous, too large, unsupported, or not ready to
construct its response type, its checkbox is disabled and the drawer displays
the specific reason.

### Persistent active indicator

While mocking is armed, show a slim amber strip below the toolbar:

```text
Mocking on | 2 rules | Unmatched requests use the real backend      Disable all
```

The indicator must remain visible when the drawer is closed. This avoids a
quiet, forgotten mock affecting later debugging.

### Captured request feedback

A mocked lifecycle uses the normal network cache and selection behavior, but
adds a small clone-safe descriptor:

```js
mockedBy: {
  ruleId: "country-kr",
  ruleName: "Korea profile",
}
```

The list row shows a `Mocked` badge distinct from the existing `Edited` replay
badge. Details metadata shows:

- `Source: Local mock`;
- the rule name;
- `Backend contacted: No`; and
- the synthetic duration.

Mock configuration failures also appear as captured local error entries, with
clear wording that the backend was not contacted.

### Developer workflow for temporary built-ins

Keep built-in rules in one obvious module, for example
`src/mocking/builtinRules.js`. Provide a small **Copy mock template** action on
a completed unary request. It copies a declarative rule skeleton containing
the captured transport, page origin, backend identity, method, request JSON,
and response JSON. A developer can reduce the request conditions, paste the
rule into the built-in catalog, rebuild the extension, and review it in the
Mocks drawer.

The UI never evaluates code from this file. Built-ins are data only.

## Rule model

Use a versioned, clone-safe shape:

```js
{
  version: 1,
  rules: [
    {
      id: "country-kr",
      name: "Korea profile",
      enabled: false,
      scope: {
        transport: "connect-web",
        methodType: "unary",
        frameOrigin: "https://app.example.test",
        backendOrigin: "https://api.example.test",
        rpcPath: "/demo.ProfileService/GetProfile",
      },
      match: {
        all: [
          { pointer: "/countryCode", equals: "KR" },
        ],
      },
      outcome: {
        type: "success",
        response: {
          displayName: "Temporary mock user",
          countryCode: "KR",
        },
      },
    },
  ],
}
```

### Matching semantics

- All scope fields are exact matches.
- Normalize a backend URL into `backendOrigin` plus `rpcPath`; do not compare a
  user-visible display label.
- If a backend URL is not available, require exact transport, frame origin,
  and captured method string and mark the weaker scope in the UI.
- Request conditions use RFC 6901-style JSON Pointers and deep JSON equality.
- Every condition in `all` must match.
- An empty condition list means method-only matching and requires an extra
  warning in the drawer before arming.
- Read only own properties while resolving a pointer. Never walk prototypes.
- Reject duplicate IDs and overlapping enabled rules during validation.
- As a defensive runtime check, more than one matching rule fails closed as a
  local configuration error instead of choosing an arbitrary winner.

Do not support regular expressions, globs, expressions, callbacks, `eval`, or
arbitrary JavaScript. Deterministic data matching is easier to explain, test,
and constrain.

### Bounds

Start with conservative limits:

- 50 rules per panel session;
- 32 request conditions per rule;
- JSON nesting depth of 20;
- 1 MiB per mock response;
- 2 MiB for the complete active configuration; and
- strings no longer than 4,096 characters, except serialized response values.

Validation runs in the panel before sending, in the content script before
forwarding, and in the page runtime before activation.

## Runtime architecture

Reuse the existing panel/background/content/page route rather than using
`chrome.devtools.inspectedWindow.eval` or intercepting raw Fetch/XHR bytes:

```text
Mock drawer
  -> panel mock bridge
  -> background worker
  -> each currently connected content frame
  -> page mock runtime
  -> transport interceptor
  -> synthetic application-compatible response

Transport interceptor
  -> normal capture lifecycle with mockedBy
  -> content script
  -> background worker
  -> panel network cache
```

### Shared page mock runtime

Inject a new `mock-runtime.js` before the three transport interceptors. Store
its private state under a `Symbol` and expose only a minimal internal interface
to those interceptors:

```js
runtime.configure(validatedConfig)
runtime.disarm(reason)
runtime.match({ transport, methodType, frameOrigin, backendUrl, method, request })
runtime.recordHit(ruleId)
```

This module owns rule validation, URL normalization, JSON Pointer resolution,
deep equality, size bounds, readiness, and match accounting. Transport files
own only response construction and library-specific return shapes.

The page itself is not a trusted extension boundary: injected scripts already
run in the page's main world. The background worker must accept configuration
commands only from the registered DevTools panel port, and the content script
must accept only validated background commands. A page can still alter its own
in-page instrumentation, but it must not be able to configure other frames,
tabs, or extension state.

### Bridge protocol

Add the following addressed messages:

- `mock_configure`: panel to background, then broadcast intentionally to the
  currently connected content frames for the inspected tab;
- `mock_disarm`: panel to all current frames;
- `mock_config_ack`: page to panel with `captureId`, config version, and ready
  rule IDs; and
- `mock_config_rejected`: page to panel with a bounded reason.

Unlike replay, mock configuration is intentionally tab-wide, but it is never
sent to other tabs. The background worker does not persist an armed config.
Newly registered content frames are reported to the panel; the panel may send
the current config only while the same page session remains armed.

The content script sends `mock_disarm` to its page immediately when its port
disconnects. The page runtime also clears rules on `pagehide` and `unload`.
The panel handles `chrome.devtools.network.onNavigated` by turning its master
switch off before any rules may be re-applied.

### State ownership

- Built-in definitions: extension panel bundle.
- Selected and armed state: panel Redux memory only.
- Active validated rules and response factories: inspected page memory only.
- Per-session hit counts: page plus small panel summaries.
- Mocked response payloads: existing bounded network payload cache.

Do not put full rule responses into the network summary list. Do not store
mock rules in `localStorage`, `chrome.storage`, the service worker, or the
inspected page's storage in v1. Closing DevTools or navigating removes the
active behavior.

## Transport response construction

Raw JSON is not a valid response for these clients. Each interceptor must
construct the generated protobuf output type and return the public call shape
expected by the application.

### Response readiness

For a temporary extension-only implementation, use two safe sources:

1. a transport's public output descriptor when it provides a documented JSON
   constructor; or
2. a bounded page-side response factory learned from a previously captured
   successful response for the exact transport and RPC method.

A built-in rule that needs a learned response factory displays `Waiting for a
successful captured response` and remains inactive until seeded. Factories are
bounded to the 100 most recently used methods and cleared on unload. They keep
only constructors/templates needed for reconstruction, not response history.

Do not depend silently on private library properties. If a supported client
version does not expose enough public type information, add an explicit
application adapter rather than guessing:

```js
window.__GRPCWEB_DEVTOOLS__.registerMethod(method, {
  createRequest(json, originalRequest) { /* existing replay adapter */ },
  createResponse(json, responseTemplate) { /* new optional mock adapter */ },
});
```

The drawer must identify rules that require such an adapter.

### gRPC-Web

- Promise unary calls return a Promise resolving to the generated response.
- Callback unary calls schedule the callback asynchronously and return a small
  `ClientReadableStream`-compatible object supporting `on`, `removeListener`,
  and `cancel`, including terminal OK status/end events.
- Reconstruct generated messages through a registered `createResponse`
  adapter or a captured successful response constructor/template.
- Never invoke the original `rpcCall` or `unaryCall` after a match.

### Connect-Web

- Reconstruct the response message through the method's public output schema
  when available, otherwise through a captured response message template.
- Return a copied unary response envelope with the synthetic message, empty
  local headers/trailers where required, and no call to `next(req)`.
- Preserve the exact Promise behavior expected by the interceptor contract.

### protobuf-ts

- Reconstruct with `method.O.fromJson(response, options.jsonOptions)`.
- Return a `UnaryCall`-compatible Promise-like object with resolved response,
  headers, OK status, and method/request metadata.
- Verify the shim against the supported runtime-rpc versions with fixture
  clients; do not rely only on the current unit-test doubles.

### Failure behavior

- No match: call the real transport normally.
- Exactly one ready match: return the mock and never call the transport.
- Matched but response construction fails: return a local RPC-shaped error,
  capture it with `mockedBy`, and never call the transport.
- Multiple matches: return a local ambiguous-rule error and never call the
  transport.
- Unsupported server stream: rule validation prevents arming; the ordinary
  call passes through because there is no active eligible rule.

This fail-closed behavior after a match prevents an intended mock for a
side-effecting method from unexpectedly reaching production.

## Implementation stages and commits

Tests accompany the stage they validate. Each meaningful stage is committed
independently, following the repository instruction.

1. `docs: add request based mocking plan`
2. `feat: add declarative mock rules and validation`
   - versioned built-in catalog;
   - exact scope normalization;
   - JSON Pointer/deep-equality matcher;
   - overlap and size validation; and
   - pure unit tests.
3. `feat: route mock configuration to inspected frames`
   - panel bridge;
   - background panel-only routing;
   - content/page message normalization;
   - acknowledgements;
   - disconnect/navigation disarming; and
   - multi-frame routing tests.
4. `feat: add unary mock response runtime`
   - shared page runtime;
   - bounded response factories;
   - gRPC-Web, Connect-Web, and protobuf-ts unary adapters;
   - mocked lifecycle provenance;
   - fail-closed matched errors; and
   - real client fixture tests.
5. `feat: add safe mocking controls`
   - toolbar state and persistent active strip;
   - mock drawer and rule readiness;
   - first-arm confirmation and disable-all;
   - `Mocked` row/details presentation;
   - copy-template developer action; and
   - light/dark, keyboard, and narrow-panel UI tests.
6. `docs: document local request mocking`
   - built-in rule format;
   - response factory/adapter limits;
   - safety behavior;
   - example rule; and
   - screenshots.

## Test matrix

### Rules

- exact scope and request conditions match;
- missing, extra, nested, array, null, boolean, and numeric values behave
  deterministically;
- escaped JSON Pointer segments resolve correctly;
- inherited properties never match;
- duplicate, overlapping, oversized, too-deep, and malformed rules reject;
- input objects are never mutated; and
- matching work stays bounded by configured rule/condition limits.

### Bridge and lifecycle

- panel configuration reaches only the inspected tab's connected frames;
- content/page configuration cannot be initiated from a content port;
- each frame acknowledges its own `captureId`;
- a newly connected frame is not silently armed after navigation;
- panel close, service-worker disconnect, content disconnect, pagehide,
  unload, and navigation disarm the page runtime;
- stale config versions are ignored; and
- mocked lifecycle payloads stay clone-safe and bounded.

### Transports

- one matching unary call invokes the original transport zero times;
- an unmatched unary call invokes it exactly once;
- matching works against default-valued request fields;
- callback gRPC-Web receives one callback plus public stream status/end
  behavior;
- Promise gRPC-Web resolves to a generated response message;
- Connect-Web returns a valid copied unary envelope;
- protobuf-ts returns a conforming UnaryCall-compatible result;
- protobuf JSON conversion covers scalars, enums, bytes, repeated fields, and
  supported nested messages;
- conversion failures and ambiguous matches fail closed;
- a synthetic response creates one start and one terminal captured event;
- `mockedBy` survives summary batching/cache merge; and
- streaming requests remain unmocked in v1.

### UI

- all rules begin disarmed;
- the first-arm confirmation states the real-network behavior;
- the active strip stays visible with the drawer closed;
- disable-all takes effect in every acknowledged frame;
- invalid and not-ready rules explain why they cannot be armed;
- method-only rules receive an additional warning;
- mocked rows and details say that the backend was not contacted;
- built-in response JSON is read-only; and
- keyboard focus, Escape-to-close, narrow DevTools width, and both themes work.

## Validation and acceptance

Run:

```sh
npm test -- --watchAll=false
npm run build
git diff --check
```

Smoke-test the built extension against real fixtures for all three supported
client integrations. Include callback and Promise gRPC-Web, Connect-Web unary,
protobuf-ts unary, iframe requests, same-origin navigation, service-worker
restart, a side-effecting method guarded by a matched construction failure,
default protobuf values, nested response data, rule overlap, and limit cases.

Acceptance requires:

- a matched mock makes no network request;
- an unmatched request behaves exactly as before;
- mocking can never be armed invisibly;
- navigation and connection loss disable active behavior;
- returned values conform to each public client contract;
- no new host permission, runtime dependency, or persistent sensitive storage;
- existing capture and replay behavior remains compatible;
- all automated validation passes;
- tracked worktree changes for each stage are committed; and
- the existing untracked `.omx/` directory remains untouched.

## Deferred follow-ups

- Create, edit, import, and export rules entirely inside the panel.
- Optional per-project persistence with explicit review and redaction.
- Mocked RPC errors and deadlines.
- Server-streaming sequences with message timing and cancellation.
- Advanced condition operators after a safe declarative design is validated.
- An explicit outbound request-rewrite feature with separate warning language.
