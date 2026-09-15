# BTS fallback and metadata security fixes

Scope: the two agreed fixes on top of PR #3 / `feat/bts-easter-egg` at `55ac172`.
No environment domain mapping, new extension permission, or remote deployment is added.

## Credential routing

Previously, a page/iframe could forge a capture's backend URL, and the BTS
fallback combined that destination with a fresh top-level cookie token.
Page captures no longer influence the fallback destination or credentials.

The fallback instead observes Chrome's `devtools.network.onRequestFinished`
events directly. It retains one short-lived pair: the authorization value and
the exact API origin where that value was observed, together with the initiating
page origin, document identity and expiry. The RPC path can change only to
`/opgwv1.OpGw/GetOpUser`; the scheme, hostname and port cannot change.

An eligible observation is a completed successful HTTPS gRPC POST with one
bounded Bearer authorization header and one browser-provided Origin header.
That Origin must match the current top-level document. Cached, failed,
service-worker-served, ambiguous, stale and missing-provenance records are rejected.
Other gRPC services on that API origin can supply the observation; an earlier
GetOpUser is not required. GetOpUser traffic cannot refresh the credential lease.

The request runs in this extension's isolated content-script context, never the
page's JavaScript context. It does not read cookies, does not add ambient cookies,
rejects redirects, omits the referrer and has a 4.5-second deadline plus a 256 KiB
response limit. A bounded start/poll protocol handles asynchronous work because
inspected-window evaluation does not await the expression's Promise. The fetch
factory is self-contained after CRA/Babel compilation and production minification.

Bindings expire ten minutes after the observed request starts and are cleared
on navigation or panel shutdown, independently of Preserve Log. Document identity
is rechecked before use; pagehide cancels work and BFCache restoration changes the
identity. The authorization value is not placed in Redux, captured metadata,
reports, storage, page messages or clipboard output.

The minimum Chrome version is now 127, when the required HAR service-worker
provenance fields became available. Missing fields still fail closed.
See [Chrome 127's HAR fields](https://developer.chrome.com/blog/new-in-devtools-127#service-worker-information-in-custom-fields-of-the-har-format).

## Metadata

The capture scripts, content bridge and cache retain only `app-version` and
`service-name`. Values longer than 512 characters are omitted, not truncated;
metadata exceeding 2,048 serialized UTF-8 bytes is omitted as a whole. The bridge
and cache inspect only the two own keys rather than enumerating arbitrary input.
Metadata contributes to the existing per-entry/cache byte budgets, including
replacement and eviction accounting.

The XHR observer stores only allowlisted metadata in a WeakMap, after native
header validation. It preserves repeated-header semantics and clears its state on
XHR reuse. It never stores raw Authorization/Cookie headers on the XHR object.
The wire-metadata slot is cleared when the next request has no allowed metadata.

## Changed implementation and test files

- Fallback: `public/bts-context.js`, `public/manifest.json`,
  `src/utils/browserBoundAccount.js`, `src/utils/opUserRawFetch.js`,
  `src/utils/btsInfo.js`, `src/components/BtsEasterEgg.js`, `src/index.js`.
- Metadata: `public/content-script.js`, `public/request-metadata-snoop.js`,
  all three `public/*-interceptor.js` scripts, `src/state/networkCache.js`.
- Regression coverage: `browserBoundAccount`, `opUserRawFetch`, `btsEasterEgg`,
  `btsInfo`, `bridge`, `networkCache`, `requestMetadataSnoop`, `interceptors` and
  `protobufTsInterceptor` tests under `src/__tests__`;
  `scripts/test-bts-browser.cjs` for real-browser/production-bundle verification.

## Verification

Outcome: **fixed** for the two scoped issues. On 2026-09-16, syntax/diff checks
passed, all **32 suites / 264 tests** passed, the CI-mode production build passed,
and every browser check below passed on Chromium 147.0.7727.15. The original
forged-destination input no longer initiates a credentialed fallback, and arbitrary
metadata keys no longer survive bridge/cache validation. Legitimate captured-data
and fallback-dependent shortcut behavior passed their controls.

The subsequent ten-minute lease adjustment passed all **32 suites / 265 tests**
and the CI-mode production build. Boundary tests cover successful use just before
expiry and rejection at ten minutes, including attempted renewal by fallback traffic.
The browser checks were not rerun for this duration-only adjustment.

The security-fix workflow included an independent boundary investigation and one
independent bypass/regression review. Its production-minification and undeclared
browser-version findings were addressed by the self-contained Promise-based
fetch factory, production-bundle browser test and explicit Chrome minimum.

Run with `CI=true`:

1. Syntax/build: `node --check public/bts-context.js`,
   `node --check scripts/test-bts-browser.cjs`, `git diff --check`, `npm run build`.
2. Security regressions: browser-bound-account and metadata tests reject forged
   capture input, cross-origin iframe credentials, mixed origin/token pairs,
   missing/duplicate headers, old-document completions, BFCache reuse, oversized
   responses, lease renewal by the fallback, and 4,000 arbitrary metadata keys.
3. Compatibility: `npm test -- --watchAll=false --runInBand` checks the full suite,
   including shortcut, report template, popup, inspector, replay and cache behavior.
4. Browser: after building, run `node scripts/test-bts-browser.cjs` with
   `PLAYWRIGHT_MODULE` pointing to an available playwright-core installation and
   `CHROMIUM_EXECUTABLE` pointing to Chromium that supports loading extensions.

The browser harness uses disposable extension/profile directories, loopback HTTPS
servers and fake credentials. Its certificate exception is test-only. It checks
real HAR header availability, isolated fetch despite a patched page fetch,
service-worker bypass, redirect refusal, absence of cookie forwarding, navigation
invalidation, and the production-minified shortcut's fetch/report/popup path.
Clipboard output is captured at the browser API boundary; the user's OS clipboard
is not used. Temporary browser fixtures are left in the system temporary directory.

## Limits and remaining risks

- Fallback requires a recent eligible authenticated request observed while the
  inspector panel is active. It does not import old HAR/preserved entries or fall
  back to cookie scraping when evidence is missing. Cookie-dependent auth, HTTP
  APIs, missing Origin/Authorization or denied CORS cause a silent miss, as before
  for other fallback failures.
- This relies on the agreed assumption that an API origin is one credential-trust
  boundary. It is not an exact-original-path replay and cannot separate mutually
  untrusted services hosted on the same origin.
- Captured GetOpUser identity remains untrusted diagnostic data, not verified
  identity. General capture authenticity and report URL redaction were not part
  of the authorized patch.
- Local tests do not establish compatibility with every deployed API, cookie
  scheme, enterprise policy or Chrome release. Browser verification used Chromium
  147.0.7727.15; no real production account or token was accessed.
