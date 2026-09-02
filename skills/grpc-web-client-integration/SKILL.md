---
name: grpc-web-client-integration
description: Safely audit, add, repair, or verify client-side integration with the gRPC-Web DevTools browser extension in existing JavaScript or TypeScript applications using generated grpc-web clients, Connect-ES, or protobuf-ts. Use for read-only integration checks, capture or timing failures, stream inspection, edit-and-replay setup, readiness handling, TypeScript globals, replay adapters, or RPCs that are missing or stop appearing after startup.
---

# gRPC-Web Client Integration

Integrate a supported web RPC client with the extension without making the
application depend on the extension being installed or on its injection timing.

## Operating mode

- For audit, review, explain, or verify requests, stay read-only. Run the
  scanner, inspect the evidence, and report. If the integration is complete,
  stop without editing.
- For explicit add or repair requests, edit only the client package and files
  required for the smallest valid integration. A successful scan can still be
  a false positive, so confirm the runtime construction path before deciding
  that no change is needed.

## Workflow

1. Locate the exact web client package root. Read repository instructions and
   inspect `git status` before doing anything that can write. Do not scan a
   monorepo or extension root when a narrower client package exists.
2. Run the deterministic inspection in its readable format before editing:

   ```bash
   node <skill-directory>/scripts/inspect-client.mjs <client-root> --format text
   ```

3. Follow every evidence location to the active client or transport factory.
   Treat matches in declarations, tests, generated files, or unused factories
   as clues, not proof. If the report is ready and the task is read-only, stop
   and report that no source changes are required.
4. Use dependency and source evidence to select the relevant reference:

   - Generated `grpc-web`: read
     [references/generated-grpc-web.md](references/generated-grpc-web.md).
   - `@connectrpc/connect-web` or legacy `@bufbuild/connect-web`: read
     [references/connect-es.md](references/connect-es.md).
   - `@protobuf-ts/grpcweb-transport`: read
     [references/protobuf-ts.md](references/protobuf-ts.md).
   - For efficient diagnosis, feature claims, replay safety, limits, or idle
     behavior, read
     [references/features-and-troubleshooting.md](references/features-and-troubleshooting.md).

5. Inspect the actual transport/client construction, all instances and
   factories, existing authentication,
   retry and tracing interceptors, generated message APIs, TypeScript setup, and
   tests. Do not infer these from the dependency list alone.
6. For an authorized change, implement the smallest matching integration. Keep
   existing endpoints, transport options, interceptor order, generated files,
   and application behavior intact. Keep the extension optional:
   normal RPCs must work unchanged when every DevTools global is absent.
7. Place the setup before the first RPC that must be captured. In SSR or hybrid
   applications, keep browser globals behind a client-only boundary or a
   `typeof window !== "undefined"` guard.
8. Run the inspector in check mode:

   ```bash
   node <skill-directory>/scripts/inspect-client.mjs <client-root> --check --format text
   ```

9. Run only the client's existing relevant tests, typecheck, lint, and build
   commands shown by the scanner. Fix
   integration failures rather than weakening existing checks.
10. Report the detected stack, evidence reviewed, files changed or explicitly
    left unchanged, validation commands, supported RPC shapes, diagnostics, and
    replay limitations.

## Existing-code safety

- Preserve unrelated working-tree changes and never use destructive Git or
  filesystem commands.
- Do not delete or replace transport configuration, generated clients, compiler
  configuration, or existing interceptors.
- Do not install, remove, upgrade, or migrate dependencies; run code generation;
  or rewrite a lockfile unless the user explicitly requests that separate work.
- Match the installed package namespace and major version. In particular, do
  not migrate legacy `@bufbuild/*` Connect packages to `@connectrpc/*` merely to
  copy a modern example.
- Do not create a second transport or client when the existing instance can be
  wrapped safely. Preserve the relative order of all existing application
  interceptors.
- Preview any unavoidable behavior change and request direction before acting.

## Integration invariants

- For generated `grpc-web`, check the global immediately and listen for
  `grpc-web-dev-tools-ready`. Register every long-lived client instance.
- For Connect-ES and protobuf-ts, use a late-bound wrapper that looks up the
  global for every call. Do not construct a conditional interceptor array and
  mutate it after transport creation.
- Insert the DevTools wrapper before authentication, retry, and tracing
  interceptors without reordering the existing interceptors relative to one
  another. Replay then invokes the remaining pipeline and can obtain fresh
  credentials.
- Add ambient TypeScript declarations only when needed. Keep them scoped to the
  client libraries installed in the target.
- Add a generated `grpc-web` replay adapter only when default protobuf setters
  cannot safely reconstruct a nested or custom request. Use the exact captured
  method path.
- Treat replay as a real backend mutation. Never automate a replay against a
  live service merely to validate installation without explicit authority.
- Do not add application keepalive traffic for extension-worker suspension.
  Current extension builds recover their bridge automatically; a discarded or
  navigated page must capture fresh requests because its client objects and
  replay handles no longer exist.
- Do not claim client-streaming or bidirectional-streaming support. This
  integration covers unary and server-streaming calls.

## Scanner contract

`scripts/inspect-client.mjs` uses only Node built-ins and does not modify the
target. It emits JSON by default or a concise report with `--format text`.
Reports include package-scoped evidence with line numbers, production/test
separation, skipped nested packages, safety diagnostics, and available
validation commands.

- Exit `0`: all detected supported stacks have the required integration
  signals.
- Exit `1`: at least one detected stack is incomplete when `--check` is used.
- Exit `2`: no supported client stack is detected when `--check` is used.
- Exit `64`: invalid arguments or an unreadable client root.

The scanner is evidence, not a substitute for source review. Dynamic factories,
workspace packages, aliases, composed interceptor arrays, or generated wrappers
may require manual tracing. Rerun it at each exact workspace package root rather
than treating a broad repository scan as authoritative.
