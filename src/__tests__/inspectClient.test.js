const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const scanner = path.resolve(__dirname, "../../skills/grpc-web-client-integration/scripts/inspect-client.mjs");
const temporaryRoots = [];

function createFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grpc-web-skill-"));
  temporaryRoots.push(root);
  Object.entries(files).forEach(([relative, contents]) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  });
  return root;
}

function runScanner(root, ...args) {
  return spawnSync(process.execPath, [scanner, root, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function parseReport(result) {
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}

afterEach(() => {
  while (temporaryRoots.length) {
    fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

test("reports a complete generated grpc-web integration without modifying the package", () => {
  const packageJson = JSON.stringify({
    name: "generated-client",
    packageManager: "npm@10.0.0",
    dependencies: { "grpc-web": "^2.0.0" },
    scripts: { test: "jest", build: "vite build", start: "vite" },
  }, null, 2);
  const client = [
    'import { DemoClient } from "./demo_grpc_web_pb";',
    "const clients = [new DemoClient('/api')];",
    "function install() {",
    '  if (typeof window === "undefined") return;',
    "  const devtools = window.__GRPCWEB_DEVTOOLS__;",
    "  if (devtools) devtools(clients);",
    "}",
    "install();",
    'window.addEventListener("grpc-web-dev-tools-ready", install);',
  ].join("\n");
  const root = createFixture({ "package.json": packageJson, "src/client.ts": client });

  const result = runScanner(root, "--check");
  const report = parseReport(result);

  expect(result.status).toBe(0);
  expect(report).toEqual(expect.objectContaining({
    schemaVersion: 2,
    mutatesTarget: false,
    detectedStacks: ["generated-grpc-web"],
    ready: true,
  }));
  expect(report.stacks[0].evidence.locations[0]).toEqual(expect.objectContaining({ file: "src/client.ts", line: 1 }));
  expect(report.stacks[0].signals.pageApi.locations[0]).toEqual(expect.objectContaining({ file: "src/client.ts", line: 5 }));
  expect(report.validation.commands.map(item => item.command)).toEqual(["npm run build", "npm run test"]);
  expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(packageJson);
  expect(fs.readFileSync(path.join(root, "src/client.ts"), "utf8")).toBe(client);

  const text = runScanner(root, "--format", "text");
  expect(text.status).toBe(0);
  expect(text.stdout).toMatch(/Read-only: yes/);
  expect(text.stdout).toMatch(/generated-grpc-web: complete/);
  expect(text.stdout).toMatch(/src\/client\.ts:1/);
  expect(text.stdout).toMatch(/Result: READY/);
});

test("skips nested packages and does not treat test-only source as runtime evidence", () => {
  const nestedPackage = JSON.stringify({ name: "nested-client", dependencies: { "grpc-web": "1.5.0" } });
  const integration = [
    'import { DemoClient } from "./demo_grpc_web_pb";',
    "const clients = [new DemoClient('/api')];",
    "const install = () => window.__GRPCWEB_DEVTOOLS__?.(clients);",
    "install();",
    'window.addEventListener("grpc-web-dev-tools-ready", install);',
  ].join("\n");
  const root = createFixture({
    "package.json": JSON.stringify({ name: "workspace-root" }),
    "src/integration.test.js": integration,
    "packages/client/package.json": nestedPackage,
    "packages/client/src/client.js": integration,
  });

  const broadResult = runScanner(root, "--check");
  const broadReport = parseReport(broadResult);
  expect(broadResult.status).toBe(2);
  expect(broadReport.detectedStacks).toEqual([]);
  expect(broadReport.nestedPackageRoots).toEqual(["packages/client"]);
  expect(broadReport.excludedSourceFiles).toContainEqual({ file: "src/integration.test.js", kind: "test" });

  const packageResult = runScanner(path.join(root, "packages/client"), "--check");
  const packageReport = parseReport(packageResult);
  expect(packageResult.status).toBe(0);
  expect(packageReport.ready).toBe(true);
});

test("marks Connect integration incomplete when required signals exist only in tests", () => {
  const root = createFixture({
    "package.json": JSON.stringify({
      name: "connect-client",
      dependencies: { "@connectrpc/connect": "2.0.0", "@connectrpc/connect-web": "2.0.0" },
    }),
    "src/transport.ts": [
      'import { createConnectTransport } from "@connectrpc/connect-web";',
      'createConnectTransport({ baseUrl: "/api", interceptors: [] });',
    ].join("\n"),
    "src/transport.test.ts": [
      "const devtoolsInterceptor = (next) => (request) => {",
      "  const devtools = window.__CONNECT_WEB_DEVTOOLS__;",
      "  return devtools ? devtools(next)(request) : next(request);",
      "};",
    ].join("\n"),
  });

  const result = runScanner(root, "--check");
  const report = parseReport(result);
  const connect = report.stacks.find(stack => stack.id === "connect-es");

  expect(result.status).toBe(1);
  expect(connect.status).toBe("incomplete");
  expect(connect.signals.pageApi.present).toBe(false);
  expect(connect.signals.pageApi.excludedFiles).toEqual(["src/transport.test.ts"]);
  expect(report.diagnostics).toContainEqual(expect.objectContaining({
    code: "connect-es.missing-pageApi",
    severity: "error",
  }));
});

test("recognizes composed legacy Connect interceptors without recommending migration", () => {
  const root = createFixture({
    "package.json": JSON.stringify({
      name: "legacy-connect-client",
      dependencies: { "@bufbuild/connect": "0.13.0", "@bufbuild/connect-web": "0.13.0" },
    }),
    "src/transport.ts": [
      'import type { Interceptor } from "@bufbuild/connect";',
      'import { createGrpcWebTransport } from "@bufbuild/connect-web";',
      "const grpcWebDevtoolsInterceptor: Interceptor = (next) => (request) => {",
      '  const devtools = typeof window === "undefined" ? undefined : window.__CONNECT_WEB_DEVTOOLS__;',
      "  return devtools ? devtools(next)(request) : next(request);",
      "};",
      "const transportInterceptors = [grpcWebDevtoolsInterceptor, authInterceptor];",
      'createGrpcWebTransport({ baseUrl: "/api", interceptors: transportInterceptors });',
    ].join("\n"),
  });

  const result = runScanner(root, "--check");
  const report = parseReport(result);
  const connect = report.stacks.find(stack => stack.id === "connect-es");

  expect(result.status).toBe(0);
  expect(connect.status).toBe("complete");
  expect(report.diagnostics).toContainEqual(expect.objectContaining({
    code: "connect-es.legacy-package-scope",
    severity: "info",
  }));
  expect(report.diagnostics.map(item => item.message).join(" ")).toMatch(/do not migrate dependencies automatically/i);
});

test("recognizes a composed protobuf-ts interceptor for unary and streaming calls", () => {
  const root = createFixture({
    "package.json": JSON.stringify({
      name: "protobuf-ts-client",
      dependencies: { "@protobuf-ts/grpcweb-transport": "2.11.0" },
    }),
    "src/transport.ts": [
      'import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";',
      "const grpcWebDevtoolsInterceptor = {",
      "  interceptUnary(next, method, input, options) {",
      '    const devtools = typeof window === "undefined" ? undefined : window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__;',
      "    return devtools ? devtools.interceptUnary(next, method, input, options) : next(method, input, options);",
      "  },",
      "  interceptServerStreaming(next, method, input, options) {",
      '    const devtools = typeof window === "undefined" ? undefined : window.__GRPCWEB_DEVTOOLS_PROTOBUF_TS__;',
      "    return devtools ? devtools.interceptServerStreaming(next, method, input, options) : next(method, input, options);",
      "  },",
      "};",
      "const transportInterceptors = [authInterceptor, grpcWebDevtoolsInterceptor];",
      'new GrpcWebFetchTransport({ baseUrl: "/api", interceptors: transportInterceptors });',
    ].join("\n"),
  });

  const result = runScanner(root, "--check");
  const report = parseReport(result);
  const protobufTs = report.stacks.find(stack => stack.id === "protobuf-ts");

  expect(result.status).toBe(0);
  expect(protobufTs.status).toBe("complete");
  expect(protobufTs.missingSignals).toEqual([]);
});

test("warns SSR-capable clients to guard browser globals", () => {
  const root = createFixture({
    "package.json": JSON.stringify({
      name: "next-client",
      dependencies: { "grpc-web": "2.0.0", next: "15.0.0" },
    }),
    "src/client.ts": [
      'import { DemoClient } from "./demo_grpc_web_pb";',
      "const clients = [new DemoClient('/api')];",
      "const install = () => window.__GRPCWEB_DEVTOOLS__?.(clients);",
      "install();",
      'window.addEventListener("grpc-web-dev-tools-ready", install);',
    ].join("\n"),
  });

  const result = runScanner(root, "--check");
  const report = parseReport(result);
  expect(result.status).toBe(0);
  expect(report.diagnostics).toContainEqual(expect.objectContaining({
    code: "browser-global-ssr-guard",
    severity: "warning",
  }));
});

test("rejects unsupported output formats without touching the target", () => {
  const root = createFixture({ "package.json": JSON.stringify({ name: "client" }) });
  const before = fs.readFileSync(path.join(root, "package.json"), "utf8");

  const result = runScanner(root, "--format", "yaml");

  expect(result.status).toBe(64);
  expect(result.stderr).toMatch(/Unsupported format: yaml/);
  expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(before);
});
