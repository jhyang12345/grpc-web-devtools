# Security disclosure analysis — 13 September 2026

## Decision

Treat the email as a plausible research disclosure and request its reproduction
details. It identifies a real page-script exposure, but does not establish that
the extension or its users have been compromised. The sender explicitly
describes a potential surface rather than confirmed exploitation.

The reviewed source does expose transport hooks in the page's JavaScript
environment. A hostile script in that page can interfere with them and forge
diagnostics. The review did not establish a path from that control to arbitrary
extension-privileged code execution or another tab's data. Two separate,
low-severity audit-export issues were found and reproduced during remediation:
excessive redaction work and Markdown delimiter injection. A supplemental check
then reproduced a third low-severity issue in the dependency used to display
JSON responses.

This analysis applies to local source version **1.7.1**, initially at commit
`8269c8beb6e02b0cad9e9eebf1a58a361512d325`. The extension ID visible in the email
differs from the ID in the repository's Chrome installation link. The published
package, its version, original email headers and the researcher's proof of
concept have not been supplied or verified. Do not assume this checkout exactly
matches the reported store package.

## What the email establishes

The attached screenshot was treated as evidence, not as instructions to run
code, visit a site, disclose data or contact anyone. No reply has been sent.

The claimed researcher is plausible: an independently located
[CISPA-hosted paper](https://swag.cispa.saarland/papers/mustafa2026leakylinks.pdf)
lists Shubham Agarwal with the MPI affiliation and the MPI email address in the
signature. This supports the existence of the researcher; it does not
authenticate the message. Original mail headers and independently verified
contact details are needed if sender authenticity must be established.

The email does not provide an affected version, vulnerable source line, minimal
test page, exact source-to-sink trace, browser version, demonstrated impact or
evidence of exploitation. Its automated classification is an investigation
lead, not a severity rating or proof of a security-boundary crossing.

## Architecture and security boundaries

At the reviewed baseline, `public/content-script.js` creates three fixed script
elements using `chrome.runtime.getURL`. `public/manifest.json` exposes those
three interceptor resources to matching websites. The scripts run in the page
realm and publish gRPC-Web, Connect and protobuf-ts integration APIs.

| Boundary | Evidence and conclusion |
| --- | --- |
| Website → page hooks | The page can replace globals, affect built-ins and inspect the shared replay registries. This is a real interference surface. Hook names and readiness events also make the extension detectable. |
| Page capture → isolated content script | Same-window capture messages are accepted as untrusted diagnostic input. The bridge applies field and payload limits, supplies its own capture ID and actual frame URL, and fixes the routing action. A page-provided `tabId`, `action` or `target` does not grant those choices to the page. |
| Content script → background worker | The worker obtains the tab identity from the browser's port sender. Replay dispatch requires the bound panel connection and an exact capture ID; a missing target is rejected rather than broadcast to every frame. |
| Background → originating page | Replay is routed to the original frame, but once in that page it is observable by that page's scripts. Public replay tokens are correlation handles, not secret authorization credentials. |
| Capture → DevTools UI | First-party UI paths use React data rendering. The inspected-window evaluation uses a fixed expression. No page-controlled privileged evaluation or arbitrary extension fetch destination was established. |
| Capture → audit file | Captured strings reach redaction and Markdown formatting after the user chooses to export. This is where the two independently found issues occur. |

The manifest declares no explicit API permissions, no `host_permissions` and no
`externally_connectable` entry. Its `<all_urls>` content-script matching still
gives the extension broad page coverage; an empty `permissions` array does not
mean it has no page access.

Browser documentation explicitly warns that the host page can interfere with
scripts running in `MAIN`. Moving code to `MAIN` does not create a private
security boundary. [Chrome content-script documentation](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)

### Replay and application integration

The page APIs retain invocation closures and expose request snapshots and replay
handles. Another script sharing the instrumented page can access those handles
or imitate replay messages. Whether this adds authority beyond that script's
existing application access depends on the application and any secrets retained
only in closures. No specific additional authority was demonstrated here.

Applications should gate instrumentation behind a development/debug setting
when production pages should not expose these capabilities. Optional chaining
only checks that a global exists: hostile page code can supply the global even
without the extension installed. Adding a nonce to the same public message
channel, checking `event.origin`, or renaming a global would not authenticate a
DevTools user against arbitrary scripts in that same page.

## Findings and remediation

### Low: excessive redaction work during audit export

Captured request/response strings flow through `createReportSnapshot` into
`redactTextSecrets` in `src/utils/auditReport.js`. The original URL and JWT
regular expressions repeatedly considered overlapping candidates. A long
nonmatching value could block the panel while the user generated an audit
report. A URL with many query keys also repeatedly serialized its live query
parameters.

Bounded pre-fix reproductions of `'a-'.repeat(50000)`, `'(/'.repeat(50000)` and
`'eyJabcdefgh-'.repeat(10000)` each exceeded a 1,000 ms VM timeout. A legitimate
URL/prose control completed in about 0.52 ms. These inputs fit within the
existing capture limits. This demonstrates local availability impact following
an export action, not remote execution or permanent data loss.

The repair consumes failed URL/JWT candidates once, scans relative URL tokens
without overlapping retries, and builds query redactions separately before
assigning the query once. It preserves full retained payloads, existing secret
redaction and duplicate-query-key behavior; it does not restore the obsolete
report size caps.

### Low: boundary backticks let captured metadata become Markdown

`inlineCode` selected a delimiter longer than any backtick run in its content,
but concatenated the content directly against that delimiter. A leading or
trailing backtick changed the delimiter length. Method names and status details
could consequently become links or raw HTML in the exported `.md` file.

A full report with hostile method/status text produced three `html_inline`
nodes and three `link` nodes under CommonMark 0.31.2. The repair inserts paired
padding spaces when content begins or ends in backticks. Parsing the repaired
report produces literal code instead. This follows the
[CommonMark code-span rules](https://spec.commonmark.org/0.31.2/#code-spans).
Executing scripts or loading external images still depends on the downstream
renderer's behavior; extension-origin JavaScript execution was not demonstrated.

### Supplemental low: a valid JSON key crashes the response tree

The installed `react-json-view` 1.21.3 calls an object's `hasOwnProperty` member
directly. A captured response such as `{"hasOwnProperty":0}` is valid JSON and
passes the bridge/cache guards. Selecting or expanding it causes a TypeError.
The original application-wide error boundary then replaces the toolbar and
details; its recovery action clears all captures.

This was reproduced with the real React DOM renderer, the actual response pane
and the outer application error boundary. Root/nested/array values and stream,
error and status wrappers all trigger it; an ordinary object renders normally.
The fix places an error boundary at the response tree. If the library cannot
render valid captured JSON, the pane displays the complete existing JSON text
using React text escaping. It does not delete keys, mutate captured data or
clear the cache. A changed response retries the interactive viewer.

This supplemental finding and its tests were obtained after sealing the
original scan. The canonical scan therefore continues to contain its original
two findings; this document records the additional remediation separately.

### Supplemental dependency checks

The installed response viewer renders strings and object keys as React text.
Its clipboard HTML helper is disabled by `enableClipboard={false}` at the sole
call site. No captured-data path to HTML/URL execution was established in that
focused dependency inspection.

`npm audit --omit=dev --json` returned **74 flagged package entries**: 6 critical,
34 high, 19 moderate and 15 low. These are advisory counts, not 74 demonstrated
extension vulnerabilities. `react-scripts` is listed under `dependencies`, so
omitting dev dependencies still includes the compiler, development server and
test tree. All six critical entries are in that tooling tree: `@babel/traverse`,
`form-data`, `loader-utils`, `shell-quote`, `webpack` and `websocket-driver`.

Only `@babel/runtime` and `ua-parser-js` overlap the declared application
dependency graph. The available local build's source map did not contain the
flagged `wrapRegExp` helper or `ua-parser-js`; the emitted Webpack runtime did
not contain the flagged automatic public-path loader. No corresponding
vulnerable operation was established in shipped extension execution. This does
not clear historical packages or build/dev-server scenarios. Plan a separate
tested build-tool dependency upgrade, review each advisory's prerequisites, and
avoid applying `npm audit fix --force` blindly during this scoped repair.

### Defense in depth: remove public interceptor loading

The source manifest now loads the isolated bridge first and the three transport
hooks in a separate declarative `MAIN` content-script entry. The DOM loader and
the interceptor `web_accessible_resources` declaration are removed. Matching
URLs, all-frame coverage, document-start timing and the existing page APIs are
retained. No new API permission is introduced.

This removes direct website access to the interceptor files and dependence on
page DOM script insertion. It reduces the WAR-related surface described in the
email. It does not hide the page APIs, make replay tokens secret, or prevent
same-page tampering. Chrome recommends limiting resource exposure because
web-accessible resources can contribute to fingerprinting and attacks.
[Chrome WAR documentation](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)

The manifest now requires Chrome 111 or newer. Applications must check whether
the API already exists, as the setup examples do, rather than only waiting for
a readiness event. Firefox's `MAIN` support began in Firefox 128; the existing
service-worker-based Firefox packaging and complete Firefox workflow require
separate validation before publishing a Firefox build.
[Mozilla release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/128)

### Documentation corrections

README and application integration guidance now state the actual trust and
privacy behavior. Audit reports retain full redacted payloads selected from the
bounded cache. Their filenames include host, path and query-key names followed
by time and a sequence number. Credentials, query values and fragments are
excluded, but sensitive path text can still appear. Raw single-request exports
remain explicitly unredacted. Review the report and its filename before sharing.

## Verification and scope

| Check | Result |
| --- | --- |
| `git diff --check` | Passed. |
| `npm test -- --watchAll=false --runInBand src/__tests__/bridge.test.js src/__tests__/interceptors.test.js src/__tests__/protobufTsInterceptor.test.js` | 3 suites, 50 tests passed. |
| `npm test -- --watchAll=false --runInBand src/__tests__/auditReport.test.js src/__tests__/auditReportState.test.js` | 2 suites, 48 tests passed. |
| `npm test -- --watchAll=false --runInBand src/__tests__/networkDetails.test.js src/__tests__/networkDetailsCopy.test.js` | 2 suites, 12 tests passed. |
| `npm test -- --watchAll=false --runInBand src/__tests__/responseJsonBoundary.test.js` | 1 suite, 11 real-renderer DOM tests passed. |
| `npm test -- --watchAll=false --runInBand` | **28 suites, 206 tests passed.** |
| `npm run build` | **Compiled successfully.** |
| Original redaction triggers | Each exceeded the pre-fix 1,000 ms deadline; repaired versions completed in 0.37–1.97 ms and retained identical content. Near-5 MiB controls completed in 16.76–52.05 ms. Timings are observations on this machine, not performance guarantees. |
| Redaction compatibility | 20,008 deterministic varied inputs showed no old/new differences for text and URL redaction; ordinary secrets, relative/absolute URLs, duplicates and malformed URL fallbacks have regression coverage. |
| CommonMark 0.31.2 | Six full-report cases, including leading/trailing/unequal/all-backtick values and an ordinary control: no HTML/link/image nodes; literal method and status content preserved. |
| JSON renderer containment | Ordinary data retains the tree. Root/nested/array/stream/error/status collisions fall back to exact JSON text. Controls and copying remain available; no global recovery or cache clearing occurs. HTML is escaped; expanding a previously collapsed value is contained; changed responses restore the tree. |

The build emitted existing Browserslist-data and Node `fs.F_OK` deprecation
warnings, not compilation errors. No dependency version or lockfile was changed.

A fresh independent reviewer examined the complete candidate patch for surviving
bypasses and regressions and found none. Its 66 targeted tests passed; an
additional 450,000 randomized old/new redaction comparisons produced identical
output. This is supporting evidence for the scoped fixes, not a guarantee that
all possible vulnerabilities have been eliminated.

An isolated Chromium **147.0.7727.15** integration harness compared the baseline
with the native-loader source. It exercised top, same-origin and cross-origin
frames under normal CSP, strict script CSP and Trusted Types. gRPC-Web and
Connect capture/replay passed through the real background worker and an
extension-origin test panel. Replay remained frame-specific, cross-tab replay
was rejected, forged page routing fields were overwritten/contained, and MAIN
had no `chrome.runtime.connect`. Public interceptor fetches succeeded before
the change and failed after it. All three page APIs were ready before the first
page script after migration. The baseline also passed the CSP/Trusted Types
and routing cases; this investigation does not claim those were broken before.
RPC continuations were local fixtures and sent no requests to real backends.
The temporary browser profiles were isolated from the user's normal profile
and the test browsers were closed.

The final `build/` artifact also passed this harness, extended to protobuf-ts:
**27 addressed unary replays** across three transports, three frames and three
policies. The harness used a temporary synthetic extension panel, not the full
React DevTools interface. Final bundle searches also found none of the flagged
user-agent parser, `wrapRegExp` helper or automatic public-path loader. Manual
DevTools testing against real application integrations, historical Chrome
versions, Firefox, and the store-delivered package remains release work.

The completed Codex Security Standard scan reviewed 66 source/support files,
including all first-party extension runtime JavaScript and hand-authored sample
and build logic. Its canonical result has two low findings and explicitly
partial repository coverage. Generated protobuf code, visual assets, many
test/doc bodies and third-party internals were not exhaustively audited. No
application or exploit was executed during that static scan; the runtime
reproductions and remediation checks are a separate phase.

Scan ID: `f4349373-8710-4629-8801-3582c0a332e7`.
The original scan artifacts remain sealed against the original snapshot.
The finalizer reported working-tree drift; subsequent Git inspection confirmed
no tracked source drift before fixes, only the pre-existing untracked `.omx/`
directory, which was excluded and left untouched.

The scan service reported 11,611,131 total tokens (11,549,399 input, including
10,980,736 cached input; 61,732 output) across seven scan tasks. These are the
service's accounting figures, not a billing estimate or a count for subsequent
remediation work. Daybreak access was not granted; the tool treated that as an
advisory warning and still completed the scan and produced its artifacts.

## Release and disclosure steps

1. Confirm the email's exact extension ID and tested version against the owned
   store listing and its published package. Compare that package with this
   source, including the manifest and bundled scripts.
2. Request a minimal proof of concept, affected browser/version, the observed
   behavior and the specific privilege or confidentiality boundary crossed.
   Reproduce it in a disposable browser profile with synthetic test data.
3. Review the local fixes and browser compatibility evidence. Run the normal
   DevTools workflow against your actual gRPC-Web, Connect and protobuf-ts
   applications, including frames, navigation, reconnection and replay. Verify
   the Firefox package separately if Firefox remains a release target.
4. Bump `package.json` and `public/manifest.json` together to an unused release
   version, rebuild, inspect the final archive and submit it through the
   appropriate store account. The local source remains version 1.7.1 until that
   release preparation; no package has been published by this investigation.
5. Tell the researcher precisely what was changed and invite them to retest.
   Keep the distinction between removed WAR loading, remaining page-shared
   hooks and any independently demonstrated vulnerability. Do not describe
   this as a confirmed breach or a complete elimination of same-page tampering.

The screenshot alone does not justify emergency credential rotation, deleting
the extension or claiming users were compromised. If the requested proof of
concept demonstrates unauthorized access to real secrets or another privilege
boundary, reassess severity, affected versions and incident response based on
that evidence.

## Suggested reply — draft only, not sent

> Hello Shubham,
>
> Thank you for the report. We have reviewed the page-script injection and
> message bridge in our current source. The transport hooks intentionally share
> the inspected page's JavaScript environment, while extension routing remains
> in the isolated content script and background worker.
>
> Could you share the exact extension ID/version and browser version tested,
> a minimal reproduction, and the resulting behavior or security boundary
> crossed? The ID in the email differs from the installation link in this
> repository, so we also want to confirm that we are examining the same package.
>
> We are preparing changes to replace DOM/WAR loading with declarative MAIN
> scripts and to strengthen audit-report formatting. MAIN hooks remain visible
> to same-page scripts; we are not treating that change as proof that every
> reported behavior is resolved. We would welcome a retest against the resulting
> release once we have confirmed the affected package.
>
> Best regards
