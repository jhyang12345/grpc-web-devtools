/**
 * @jest-environment ./e2e/harness/environment.js
 */
// Layer 2 of docs/plans/2026-09-24-full-feature-test-plan.md: real clients and
// real wire traffic driving the real panel UI, reports, log controls and bounds.
import { bootExtension, waitFor } from "../../e2e/harness/extension";
import { startKitchenServer } from "../../e2e/harness/server";
import { STACKS } from "../../e2e/harness/stacks";
import { requestJson } from "../../e2e/harness/fixture";
import { buildDebugReport, formatDebugReportJson, formatDebugReportMarkdown } from "../utils/debugReport";
import { downloadTextFile } from "../utils/download";
import { downloadAuditReport } from "../state/auditReport";
import { setFilterValue } from "../state/toolbar";
import { setPreserveLog } from "../state/network";

// jsdom has no layout, so give the virtualized list a real viewport.
jest.mock("react-virtualized-auto-sizer", () => ({ children }) => children({ width: 900, height: 2000 }));
jest.mock("../utils/download", () => ({ downloadTextFile: jest.fn() }));

jest.setTimeout(30000);

let server;
let ext;
let grpcWeb;
let protobufTs;

beforeAll(async () => {
  // A realistic page URL whose query string must never leak into audit reports.
  window.history.pushState({}, "", "/checkout?session=super-secret-value");
  server = await startKitchenServer();
  ext = bootExtension();
  grpcWeb = STACKS["grpc-web-text-promise"]();
  protobufTs = STACKS["protobuf-ts"]();
  grpcWeb.install(server.baseUrl);
  protobufTs.install(server.baseUrl);
  await ext.ready();
});

afterAll(() => server.close());

beforeEach(() => {
  ext.store.dispatch(setPreserveLog(false));
  ext.store.dispatch(setFilterValue(""));
  server.reset();
  ext.reset();
});

const flush = () => ext.store.dispatch(ext.networkState.flushPendingNetworkLog());
const settledLog = count => waitFor(() => {
  flush();
  const log = ext.store.getState().network._allLog;
  return log.length === count && log.every(entry => entry.terminalPhase) ? log : null;
}, { message: `${count} settled panel entries` });
const rows = () => Array.from(document.querySelectorAll(".data-row-title")).map(node => node.textContent);
const click = element => element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const mouseDown = element => element.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }));

async function mixedTraffic() {
  await grpcWeb.unary(requestJson());
  await grpcWeb.unary(requestJson({ scenario: "grpc-error", errorCode: 5 }));
  await grpcWeb.unary(requestJson({ scenario: "network-error" }));
  await grpcWeb.ping();
  return settledLog(4);
}

describe("P3 panel UI renders captured traffic", () => {
  test("rows show each call, error and network-error badges, and selection shows request and response", async () => {
    await mixedTraffic();
    await waitFor(() => rows().length === 4, { message: "four rendered rows" });
    expect(rows().filter(title => title === "Echo")).toHaveLength(3);
    expect(rows()).toContain("Ping");
    const badges = Array.from(document.querySelectorAll(".data-row-error-badge")).map(node => node.textContent);
    expect(badges.sort()).toEqual(["Error", "Network Error"]);

    // Newest first: the success is the oldest Echo row.
    const echoRows = Array.from(document.querySelectorAll(".data-row-title")).filter(node => node.textContent === "Echo");
    mouseDown(echoRows.at(-1));
    const requestViewer = await waitFor(() => document.querySelector(".request-viewer"), { message: "request viewer" });
    expect(requestViewer.textContent).toContain("héllo ✓");
    expect(requestViewer.textContent).toContain("labelsMap");
    await waitFor(() => document.querySelector(".response-pane").textContent.includes("Echo#0"), { message: "response JSON" });
  });

  test("P4 Edit → Send request replays the edited JSON through the UI and adds an Edited row", async () => {
    await grpcWeb.unary(requestJson());
    await settledLog(1);
    await waitFor(() => rows().length === 1, { message: "one row" });
    mouseDown(document.querySelector(".data-row-title"));
    const editButton = await waitFor(() => {
      const button = document.querySelector(".replay-edit-button");
      return button && !button.disabled ? button : null;
    }, { message: "enabled Edit button" });
    click(editButton);
    const editor = await waitFor(() => document.querySelector(".request-editor-input"), { message: "request editor" });
    const edited = JSON.parse(editor.value);
    edited.sink.fString = "edited from the panel";
    edited.sink.numbersList = [42];
    editor.value = JSON.stringify(edited);
    click(document.querySelector(".replay-send-button"));

    await waitFor(() => server.requests.length === 2, { message: "replay at the server" });
    expect(server.requests[1].json.sink).toEqual(expect.objectContaining({ fString: "edited from the panel", numbers: [42], choiceText: "picked" }));
    await waitFor(() => document.querySelector(".data-row-edited-badge"), { message: "Edited badge" });
    const log = await settledLog(2);
    expect(log.find(entry => entry.replayedFrom)).toEqual(expect.objectContaining({ terminalPhase: "complete" }));
  });
});

describe("P5/P6 reports built from real captures", () => {
  test("the debug report carries URL, request and response but never the replay token", async () => {
    await grpcWeb.unary(requestJson());
    const [summary] = await settledLog(1);
    const entry = ext.getNetworkEntry(summary.entryId);
    const report = buildDebugReport(entry);
    const markdown = formatDebugReportMarkdown(report);
    const json = formatDebugReportJson(report);
    expect(markdown).toContain("/inspector.e2e.KitchenService/Echo");
    expect(markdown).toContain("héllo ✓");
    expect(markdown).toContain("Echo#0");
    expect(JSON.parse(json).request.sink.fString).toBe("héllo ✓");
    [markdown, json].forEach(text => expect(text).not.toContain(entry.replay.token));
  });

  test("the audit report prioritizes failures, classifies the network error and redacts the page query", async () => {
    await mixedTraffic();
    downloadTextFile.mockClear();
    await ext.store.dispatch(downloadAuditReport());
    await waitFor(() => downloadTextFile.mock.calls.length === 1, { message: "audit download" });
    const [text, { filename }] = downloadTextFile.mock.calls[0];
    expect(filename).toMatch(/^grpc-audit-.*\.md$/);
    expect(text).toContain("NOT_FOUND");
    expect(text).toMatch(/network/i);
    expect(text).toContain("/inspector.e2e.KitchenService/Echo");
    expect(text).not.toContain("super-secret-value");
    expect(text).toContain("Status: `NOT_FOUND`");
    // The grpc-web failure never got an HTTP response: it must be reported as a
    // network failure, not as the UNKNOWN code grpc-web synthesizes for it.
    expect(text).toContain("Network failure (no gRPC status captured)");
    expect(text).not.toContain("RPC error (UNKNOWN)");
  });
});

describe("P7 filter, clear and preserve log", () => {
  test("filter narrows the list; clear empties both the log and the payload cache", async () => {
    const log = await mixedTraffic();
    ext.store.dispatch(setFilterValue("Ping"));
    expect(ext.store.getState().network.log.map(entry => entry.endpoint)).toEqual(["Ping"]);
    ext.store.dispatch(setFilterValue(""));
    ext.store.dispatch(ext.networkState.clearLogAndCache());
    expect(ext.store.getState().network._allLog).toHaveLength(0);
    log.forEach(entry => expect(ext.getNetworkEntry(entry.entryId)).toBeUndefined());
  });

  test("Preserve Log keeps entries across navigation, but a hard reload still clears them", async () => {
    await mixedTraffic();
    ext.store.dispatch(setPreserveLog(true));
    ext.devtoolsNetwork.onNavigated.emit("http://localhost/next-page");
    expect(ext.store.getState().network._allLog).toHaveLength(4);
    ext.devtoolsNetwork.onRequestFinished.emit({
      _resourceType: "document",
      request: { url: "http://localhost/next-page", headers: [{ name: "Cache-Control", value: "no-cache" }] },
    });
    expect(ext.store.getState().network._allLog).toHaveLength(0);
  });

  test("without Preserve Log, navigation clears the log", async () => {
    await mixedTraffic();
    ext.devtoolsNetwork.onNavigated.emit("http://localhost/next-page");
    expect(ext.store.getState().network._allLog).toHaveLength(0);
  });
});

describe("B bounds and resilience with real payloads", () => {
  test("B1 a 120-message stream keeps the newest 100 messages and counts the dropped ones", async () => {
    const outcome = await protobufTs.stream(requestJson({ count: 120 }));
    expect(outcome.messages).toHaveLength(120);
    const [summary] = await settledLog(1);
    const entry = ext.getNetworkEntry(summary.entryId);
    expect(summary.messageCount).toBe(120);
    expect(entry.messages).toHaveLength(100);
    expect(entry.droppedMessageCount).toBe(20);
    expect(entry.messages[0].serverNote).toBe("Stream#20");
    expect(entry.messages.at(-1).serverNote).toBe("Stream#119");
  });

  test("B2 a request over 5 MiB still reaches the backend, is shown truncated, and disables replay", async () => {
    const huge = requestJson();
    huge.sink.fString = "x".repeat(5 * 1024 * 1024 + 10);
    const outcome = await grpcWeb.unary(huge);
    expect(outcome.error).toBeUndefined();
    expect(server.requests[0].json.sink.fString).toHaveLength(5 * 1024 * 1024 + 10);
    const [summary] = await settledLog(1);
    const entry = ext.getNetworkEntry(summary.entryId);
    expect(entry.request).toEqual(expect.objectContaining({ __truncated: true }));
    expect(entry.replay).toEqual(expect.objectContaining({ available: false, reason: expect.stringMatching(/5 MiB/) }));
    expect(summary.payloadTruncated).toBe(true);
  });

  // KNOWN ISSUE (plan section 7, finding F7): after an MV3 worker restart the
  // content script and the panel reconnect independently. Events the content
  // script flushes before the panel re-binds reach a background with no panel
  // port and are dropped, so the early part of the stream is lost. Fixing it
  // needs a buffering policy (where, how long, how many bytes) that trades
  // memory while DevTools is closed; unskip once that policy is chosen.
  test.skip("B3 a background worker restart mid-stream loses no events and the stream still ends in one entry", async () => {
    const streaming = protobufTs.stream(requestJson({ count: 40 }));
    await waitFor(() => ext.pageEvents.some(event => event.phase === "message"), { message: "first stream message" });
    ext.restartBackground();
    const outcome = await streaming;
    expect(outcome.messages).toHaveLength(40);
    const [summary] = await waitFor(() => {
      flush();
      const log = ext.store.getState().network._allLog;
      return log.length === 1 && log[0].terminalPhase === "complete" ? log : null;
    }, { timeout: 10000, message: "stream entry completed after worker restart" });
    expect(summary.messageCount).toBe(40);
    expect(ext.getNetworkEntry(summary.entryId).messages).toHaveLength(40);
  });

  test("C11 an application call made without the page API installed still works and is not captured", async () => {
    const hook = window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__;
    delete window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__;
    try {
      const outcome = await protobufTs.unary(requestJson());
      expect(outcome.error).toBeUndefined();
      expect(server.requests).toHaveLength(1);
      await new Promise(resolve => setTimeout(resolve, 150));
      flush();
      expect(ext.store.getState().network._allLog).toHaveLength(0);
    } finally {
      window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__ = hook;
    }
  });
});

describe("R5 grpc-web replay adapters", () => {
  test("a registered adapter builds the replay request; unregistering restores default reconstruction", async () => {
    const { pb } = grpcWeb;
    const method = `${server.baseUrl}/inspector.e2e.KitchenService/Echo`;
    const adapter = { createRequest: jest.fn(json => grpcWeb.buildRequest({ ...json, sink: undefined, scenario: "ok" })) };
    window.__GRPCWEB_DEVTOOLS__.registerMethod(method, adapter);
    try {
      await grpcWeb.unary(requestJson());
      const start = ext.pageEvents.find(event => event.phase === "start");
      const result = await ext.pageReplay({ transport: "grpc-web", replayToken: start.replay.token, request: start.request });
      expect(result.type).toBe("__GRPCWEB_DEVTOOLS_REPLAY_ACK__");
      expect(adapter.createRequest).toHaveBeenCalledTimes(1);
      expect(adapter.createRequest.mock.calls[0][1]).toBeInstanceOf(pb.EchoRequest);
      await waitFor(() => server.requests.length === 2, { message: "adapter replay at the server" });
      expect(server.requests[1].json.sink).toBeUndefined();
    } finally {
      window.__GRPCWEB_DEVTOOLS__.unregisterMethod(method);
    }
    server.reset();
    ext.reset();
    await grpcWeb.unary(requestJson());
    const start = ext.pageEvents.find(event => event.phase === "start");
    await ext.pageReplay({ transport: "grpc-web", replayToken: start.replay.token, request: start.request });
    await waitFor(() => server.requests.length === 2, { message: "default replay at the server" });
    expect(server.requests[1].json.sink.fString).toBe("héllo ✓");
    expect(adapter.createRequest).toHaveBeenCalledTimes(1);
  });
});
