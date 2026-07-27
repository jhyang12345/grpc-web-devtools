---
name: grpc-web-client-integration
description: Add, repair, migrate, or verify client-side integration with the gRPC-Web DevTools browser extension in JavaScript or TypeScript web applications using generated grpc-web clients, Connect-ES, or protobuf-ts. Use when an agent needs to enable capture, timing, stream inspection, edit-and-replay, readiness handling, TypeScript globals, replay adapters, or diagnose why RPCs are missing or stop appearing after client startup.
---

# gRPC-Web Client Integration

Integrate a supported web RPC client with the extension without making the
application depend on the extension being installed or on its injection timing.

## Workflow

1. Locate the web client root and read its repository instructions.
2. Run the deterministic inspection before editing:

   ```bash
   node <skill-directory>/scripts/inspect-client.mjs <client-root>
   ```

3. Use its dependency and source evidence to select the relevant reference:

   - Generated `grpc-web`: read
     [references/generated-grpc-web.md](references/generated-grpc-web.md).
   - `@connectrpc/connect-web`: read
     [references/connect-es.md](references/connect-es.md).
   - `@protobuf-ts/grpcweb-transport`: read
     [references/protobuf-ts.md](references/protobuf-ts.md).
   - For feature claims, replay safety, limits, idle behavior, or diagnostics,
     read
     [references/features-and-troubleshooting.md](references/features-and-troubleshooting.md).

4. Inspect the actual transport/client construction, existing authentication,
   retry and tracing interceptors, generated message APIs, TypeScript setup, and
   tests. Do not infer these from the dependency list alone.
5. Implement the smallest matching integration. Keep the extension optional:
   normal RPCs must work unchanged when every DevTools global is absent.
6. Place the setup before the first RPC that must be captured. Preserve existing
   application interceptors and their behavior.
7. Run the inspector in check mode:

   ```bash
   node <skill-directory>/scripts/inspect-client.mjs <client-root> --check
   ```

8. Run the client's relevant tests, typecheck, lint, and production build. Fix
   integration failures rather than weakening existing checks.
9. Report the detected stack, files changed, validation commands, supported RPC
   shapes, and any replay limitations.

## Integration invariants

- For generated `grpc-web`, check the global immediately and listen for
  `grpc-web-dev-tools-ready`. Register every long-lived client instance.
- For Connect-ES and protobuf-ts, use a late-bound wrapper that looks up the
  global for every call. Do not construct a conditional interceptor array and
  mutate it after transport creation.
- Put the DevTools wrapper before authentication, retry, and tracing
  interceptors so replay invokes the remaining pipeline and can obtain fresh
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
target. It emits JSON containing detected stacks, evidence files, required
signals, and recommendations.

- Exit `0`: all detected supported stacks have the required integration
  signals.
- Exit `1`: at least one detected stack is incomplete when `--check` is used.
- Exit `2`: no supported client stack is detected when `--check` is used.
- Exit `64`: invalid arguments or an unreadable client root.

The scanner is evidence, not a substitute for source review. Dynamic factories,
workspace packages, aliases, or generated wrappers may require manual tracing.
