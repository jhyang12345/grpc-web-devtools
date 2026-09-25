// The shared contract + replay + pipeline matrix (plan sections 3.2-3.4).
// Every stack suite calls defineStackSuite(); stack differences live in the
// adapters (stacks.js) and in the small `expected*` helpers below, never in
// per-stack copies of the scenarios.
import { bootExtension, waitFor } from "./extension";
import { startKitchenServer } from "./server";
import { NOTE_TYPE_URL, SINK_JSON, requestJson } from "./fixture";

const GRPC_CODE_NAMES = { 5: "NOT_FOUND", 13: "INTERNAL", 14: "UNAVAILABLE" };

export function expectedCode(stack, code) {
  return stack.transport === "protobuf-ts" ? GRPC_CODE_NAMES[code] : code;
}

/** The request the page API should report for `json`, in the stack's own JSON shape. */
function expectedCapturedRequest(stack, json, serverJson) {
  if (stack.requestShape === "jspb") return stack.buildRequest(json).toObject();
  if (stack.transport !== "connect-web") return serverJson;
  // A Connect interceptor never sees the transport's JSON type registry, so a
  // packed google.protobuf.Any is shown (and replayed) as its raw bytes.
  return {
    ...serverJson,
    sink: {
      ...serverJson.sink,
      attachment: { "@type": NOTE_TYPE_URL, __unresolvedAnyType: true, note: expect.any(String), valueBase64: "CgZwYWNrZWQ=" },
    },
  };
}

/** protobuf-ts hands the application grpc-message still percent-encoded. */
const statusMessage = (stack, message) => (stack.transport === "protobuf-ts" ? decodeURIComponent(message) : message);

const EDITS_CANONICAL = sink => ({
  ...sink,
  fString: "edited",
  color: "COLOR_RED",
  tags: ["z"],
  nested: { ...sink.nested, weight: 99 },
  labels: { env: "prod" },
});

const EDITS_JSPB = sink => ({
  ...sink,
  fString: "edited",
  color: 1,
  tagsList: ["z"],
  nested: { ...sink.nested, weight: 99 },
  labelsMap: [["env", "prod"]],
});

export function setupStackSuite(stackFactory) {
  const context = {};
  beforeAll(async () => {
    context.server = await startKitchenServer();
    context.ext = bootExtension();
    context.stack = stackFactory();
    context.stack.install(context.server.baseUrl);
    await context.ext.ready();
  });
  afterAll(async () => {
    if (context.server) await context.server.close();
  });
  beforeEach(() => {
    context.server.reset();
    context.ext.reset();
  });

  /** Runs `call`, then returns the single request started by it plus its settled outcome. */
  context.capture = async call => {
    const { ext, stack } = context;
    const mark = ext.pageEvents.length;
    const outcome = await call();
    const start = await waitFor(() => ext.startsSince(mark).find(event => event.transport === stack.transport), { message: "start event" });
    const terminal = await ext.waitForTerminal(start.requestId, stack.transport);
    const events = ext.eventsFor(start.requestId, stack.transport);
    return { outcome, start, terminal, events, requestId: start.requestId };
  };
  return context;
}

export function defineStackSuite(stackFactory) {
  const ctx = setupStackSuite(stackFactory);

  describe("contract: unary", () => {
    test("C1 success captures every protobuf field shape, timing, backend URL and a replay handle", async () => {
      const { stack, server, ext } = ctx;
      const json = requestJson();
      const { outcome, start, terminal, events } = await ctx.capture(() => stack.unary(json));

      expect(outcome.error).toBeUndefined();
      expect(stack.responseText(outcome.response)).toBe("Echo#0");
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0].json.sink).toEqual(SINK_JSON);

      expect(events.map(event => event.phase)).toEqual(["start", "complete"]);
      expect(start).toEqual(expect.objectContaining({
        transport: stack.transport,
        methodType: "unary",
        method: stack.methodName("Echo"),
        replay: { available: true, token: expect.any(String) },
      }));
      expect(start.request).toEqual(expectedCapturedRequest(stack, json, server.requests[0].json));
      expect(terminal.response).toEqual(expect.objectContaining({ serverNote: "Echo#0" }));
      expect(terminal.timing.completionTimestamp).toBeGreaterThanOrEqual(start.timing.requestTimestamp);
      expect(terminal.timing.duration).toBeGreaterThanOrEqual(0);
      expect(terminal.timing.messageCount).toBe(1);
      if (start.backendUrl) expect(start.backendUrl).toContain("/inspector.e2e.KitchenService/Echo");

      // P1/P2: the panel holds exactly what the page captured, after every hop.
      const { summary, full } = await ext.panelEntry(start.requestId, stack.transport);
      expect(summary).toEqual(expect.objectContaining({ methodType: "unary", terminalPhase: "complete", error: false, response: true }));
      expect(full.request).toEqual(start.request);
      expect(full.response).toEqual(terminal.response);
      expect(full.location).toBe(window.location.href);
      expect(full.captureId).toEqual(expect.any(String));
    });

    test("C2 gRPC status error is captured with its code and message", async () => {
      const { stack, ext } = ctx;
      const { outcome, events, terminal, requestId } = await ctx.capture(() => stack.unary(requestJson({ scenario: "grpc-error", errorCode: 5 })));
      expect(outcome.error).toBeDefined();
      expect(events.map(event => event.phase)).toEqual(["start", "error"]);
      expect(terminal.error.code).toBe(expectedCode(stack, 5));
      expect(statusMessage(stack, terminal.error.message)).toContain("scenario failure 5");
      expect(terminal.error.isNetworkError).toBeUndefined();
      const { summary } = await ext.panelEntry(requestId, stack.transport);
      expect(summary).toEqual(expect.objectContaining({ terminalPhase: "error", error: true, isNetworkError: false, errorCode: String(expectedCode(stack, 5)) }));
    });

    test("C3 network failure ends in one error event flagged as a network error", async () => {
      const { stack, ext } = ctx;
      const { outcome, events, terminal, requestId } = await ctx.capture(() => stack.unary(requestJson({ scenario: "network-error" })));
      expect(outcome.error).toBeDefined();
      expect(events.map(event => event.phase)).toEqual(["start", "error"]);
      expect(terminal.error.isNetworkError).toBe(true);
      // No server status was received, so no gRPC code may be presented as one.
      expect(terminal.error.code).toBeUndefined();
      const { summary } = await ext.panelEntry(requestId, stack.transport);
      expect(summary.isNetworkError).toBe(true);
      expect(summary.errorCode).toBeUndefined();
    });

    test("C4 trailers-only status (no body) is captured as an error", async () => {
      const { stack } = ctx;
      const { outcome, terminal } = await ctx.capture(() => stack.unary(requestJson({ scenario: "trailers-only", errorCode: 5 })));
      expect(outcome.error).toBeDefined();
      expect(terminal.phase).toBe("error");
      expect(terminal.error.code).toBe(expectedCode(stack, 5));
    });

    test("C5 google.protobuf.Empty request and response are captured as empty objects", async () => {
      const { stack, ext } = ctx;
      const { outcome, start, terminal, requestId } = await ctx.capture(() => stack.ping());
      expect(outcome.error).toBeUndefined();
      expect(start.method).toBe(stack.methodName("Ping"));
      expect(start.request).toEqual({});
      expect(terminal.response).toEqual({});
      const { full } = await ext.panelEntry(requestId, stack.transport);
      expect(full.request).toEqual({});
      expect(full.response).toEqual({});
    });
  });

  describe("contract: server streaming", () => {
    test("C6 three messages arrive in order with per-message timing and one completion", async () => {
      const { stack, ext, server } = ctx;
      const json = requestJson({ count: 3 });
      const { outcome, events, terminal, start, requestId } = await ctx.capture(() => stack.stream(json));
      expect(outcome.error).toBeUndefined();
      expect(outcome.messages).toHaveLength(3);
      expect(start.methodType).toBe("server_streaming");
      expect(start.request).toEqual(expectedCapturedRequest(stack, json, server.requests[0].json));
      expect(start.replay).toEqual({ available: true, token: expect.any(String) });
      expect(start.method).toBe(stack.methodName("Stream"));
      expect(events.map(event => event.phase)).toEqual(["start", "message", "message", "message", "complete"]);
      const messages = events.filter(event => event.phase === "message");
      expect(messages.map(event => event.timing.messageCount)).toEqual([1, 2, 3]);
      expect(messages.map(event => event.response.serverNote)).toEqual(["Stream#0", "Stream#1", "Stream#2"]);
      messages.forEach(event => expect(event.timing.timeToFirstMessage).toBeGreaterThanOrEqual(0));
      expect(terminal.timing.messageCount).toBe(3);
      expect(terminal.timing.timeToFirstMessage).toBeGreaterThanOrEqual(0);

      const { full, summary } = await ext.panelEntry(requestId, stack.transport);
      expect(summary).toEqual(expect.objectContaining({ methodType: "server_streaming", terminalPhase: "complete", messageCount: 3 }));
      expect(full.messages.map(message => message.serverNote)).toEqual(["Stream#0", "Stream#1", "Stream#2"]);
      expect(full.messages[2].sink).toEqual(messages[2].response.sink);
    });

    test("C7 an empty stream completes with zero messages and no time-to-first-message", async () => {
      const { stack } = ctx;
      const { outcome, events, terminal } = await ctx.capture(() => stack.stream(requestJson({ count: 0 })));
      expect(outcome.error).toBeUndefined();
      expect(events.map(event => event.phase)).toEqual(["start", "complete"]);
      expect(terminal.timing.messageCount).toBe(0);
      expect(terminal.timing.timeToFirstMessage).toBeNull();
    });

    test("C8 a stream that fails before any message records only the error", async () => {
      const { stack } = ctx;
      const { outcome, events, terminal } = await ctx.capture(() => stack.stream(requestJson({ scenario: "grpc-error", count: 0, errorCode: 13 })));
      expect(outcome.error).toBeDefined();
      expect(events.map(event => event.phase)).toEqual(["start", "error"]);
      expect(terminal.error.code).toBe(expectedCode(stack, 13));
    });

    test("C9 a stream that fails after two messages keeps both messages and exactly one terminal error", async () => {
      const { stack, ext } = ctx;
      const { outcome, events, terminal, requestId } = await ctx.capture(() => stack.stream(requestJson({ scenario: "grpc-error", count: 2, errorCode: 13 })));
      expect(outcome.messages).toHaveLength(2);
      expect(outcome.error).toBeDefined();
      expect(events.map(event => event.phase)).toEqual(["start", "message", "message", "error"]);
      expect(terminal.error.code).toBe(expectedCode(stack, 13));
      expect(terminal.timing.messageCount).toBe(2);
      const { full, summary } = await ext.panelEntry(requestId, stack.transport);
      expect(full.messages).toHaveLength(2);
      expect(summary).toEqual(expect.objectContaining({ terminalPhase: "error", messageCount: 2 }));
    });
  });

  describe("contract: concurrency", () => {
    test("C10 concurrent unary and streaming calls never cross-attribute events", async () => {
      const { stack, ext } = ctx;
      const mark = ext.pageEvents.length;
      await Promise.all([
        stack.unary(requestJson({ count: 101 })),
        stack.unary(requestJson({ count: 102 })),
        stack.unary(requestJson({ scenario: "grpc-error", count: 103, errorCode: 5 })),
        stack.stream(requestJson({ count: 2 })),
      ]);
      const starts = await waitFor(() => {
        const found = ext.startsSince(mark).filter(event => event.transport === stack.transport);
        return found.length === 4 ? found : null;
      }, { message: "four starts" });
      expect(new Set(starts.map(event => event.requestId)).size).toBe(4);
      for (const start of starts) {
        await ext.waitForTerminal(start.requestId, stack.transport);
        const terminals = ext.eventsFor(start.requestId, stack.transport).filter(event => event.phase === "complete" || event.phase === "error");
        expect(terminals).toHaveLength(1);
      }
      const byCount = count => starts.find(event => (event.request.count) === count);
      expect(ext.eventsFor(byCount(101).requestId, stack.transport).at(-1).phase).toBe("complete");
      expect(ext.eventsFor(byCount(103).requestId, stack.transport).at(-1).phase).toBe("error");
    });
  });

  describe("replay", () => {
    test("R1 replaying an unmodified unary request reaches the backend again with provenance", async () => {
      const { stack, server, ext } = ctx;
      const { start } = await ctx.capture(() => stack.unary(requestJson()));
      const mark = ext.pageEvents.length;
      const result = await ext.pageReplay({ transport: stack.transport, replayToken: start.replay.token, request: start.request });
      expect(result.type).toBe("__GRPCWEB_DEVTOOLS_REPLAY_ACK__");
      const replayStart = await waitFor(() => ext.startsSince(mark).find(event => event.transport === stack.transport), { message: "replay start" });
      const replayTerminal = await ext.waitForTerminal(replayStart.requestId, stack.transport);
      expect(replayStart.replayedFrom).toEqual(expect.objectContaining({ transport: stack.transport, requestId: start.requestId }));
      expect(replayTerminal.phase).toBe("complete");
      expect(server.requests).toHaveLength(2);
      expect(server.requests[1].json).toEqual(server.requests[0].json);
    });

    test("R2 an edited replay changes scalar, enum, repeated, nested and map values on the wire", async () => {
      const { stack, server, ext } = ctx;
      const { start } = await ctx.capture(() => stack.unary(requestJson()));
      const edit = stack.requestShape === "jspb" ? EDITS_JSPB : EDITS_CANONICAL;
      const edited = { ...start.request, sink: edit(start.request.sink) };
      const result = await ext.pageReplay({ transport: stack.transport, replayToken: start.replay.token, request: edited });
      expect(result).toEqual(expect.objectContaining({ type: "__GRPCWEB_DEVTOOLS_REPLAY_ACK__" }));
      await waitFor(() => server.requests.length === 2, { message: "replayed request at the server" });
      expect(server.requests[1].json.sink).toEqual(EDITS_CANONICAL(SINK_JSON));
    });

    test("R3 replaying a server stream re-runs it to completion with provenance", async () => {
      const { stack, server, ext } = ctx;
      const { start } = await ctx.capture(() => stack.stream(requestJson({ count: 2 })));
      const mark = ext.pageEvents.length;
      const result = await ext.pageReplay({ transport: stack.transport, replayToken: start.replay.token, request: start.request });
      expect(result.type).toBe("__GRPCWEB_DEVTOOLS_REPLAY_ACK__");
      const replayStart = await waitFor(() => ext.startsSince(mark).find(event => event.transport === stack.transport), { message: "replay start" });
      const terminal = await ext.waitForTerminal(replayStart.requestId, stack.transport);
      expect(terminal.phase).toBe("complete");
      expect(terminal.timing.messageCount).toBe(2);
      expect(replayStart.replayedFrom.requestId).toBe(start.requestId);
      expect(server.requests.map(request => request.method)).toEqual(["Stream", "Stream"]);
    });

    test("R4 unknown handles and oversized bodies are rejected before reaching the backend", async () => {
      const { stack, server, ext } = ctx;
      const { start } = await ctx.capture(() => stack.unary(requestJson()));
      const unknown = await ext.pageReplay({ transport: stack.transport, replayToken: "no-such-token", request: start.request });
      expect(unknown.type).toBe("__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__");
      const oversized = await ext.pageReplay({ transport: stack.transport, replayToken: start.replay.token, request: { ...start.request, padding: "x".repeat(5 * 1024 * 1024) } });
      expect(oversized.type).toBe("__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__");
      expect(oversized.reason).toMatch(/5 MiB/);
      expect(server.requests).toHaveLength(1);
    });

    test("R6 replay runs the application interceptors placed after the DevTools hook again", async () => {
      const { stack, server, ext } = ctx;
      const { start } = await ctx.capture(() => stack.unary(requestJson()));
      await ext.pageReplay({ transport: stack.transport, replayToken: start.replay.token, request: start.request });
      await waitFor(() => server.requests.length === 2, { message: "replayed request at the server" });
      const [original, replayed] = server.requests.map(request => request.headers["x-e2e-auth"]);
      expect(original).toMatch(/^token-\d+$/);
      if (stack.supportsInterceptorChain) expect(replayed).not.toBe(original);
      else expect(replayed).toBe(original); // grpc-web replays the captured metadata as-is
    });
  });

  describe("pipeline: panel replay", () => {
    test("P4 a replay sent through the panel bridge is acknowledged and recorded as a new entry", async () => {
      const { stack, server, ext } = ctx;
      const { start, requestId } = await ctx.capture(() => stack.unary(requestJson()));
      const { full } = await ext.panelEntry(requestId, stack.transport);
      const edit = stack.requestShape === "jspb" ? EDITS_JSPB : EDITS_CANONICAL;
      const ack = await ext.sendReplayRequest({
        captureId: full.captureId,
        replayToken: full.replay.token,
        sourceEntryId: full.entryId,
        transport: full.transport,
        request: { ...full.request, sink: edit(full.request.sink) },
      });
      expect(ack).toEqual(expect.objectContaining({ captureId: full.captureId }));
      await waitFor(() => server.requests.length === 2, { message: "replay at the server" });
      expect(server.requests[1].json.sink.fString).toBe("edited");
      const replayed = await waitFor(() => {
        ext.store.dispatch(ext.networkState.flushPendingNetworkLog());
        return ext.store.getState().network._allLog.find(entry => entry.replayedFrom && entry.replayedFrom.requestId === start.requestId && entry.terminalPhase);
      }, { message: "replayed panel entry" });
      expect(replayed).toEqual(expect.objectContaining({ transport: stack.transport, terminalPhase: "complete" }));
      expect(replayed.replayedFrom.captureId).toBe(full.captureId);
    });
  });
}
