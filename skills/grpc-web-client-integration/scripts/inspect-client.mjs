#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = path.resolve(fileURLToPath(import.meta.url));
const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", "build", "coverage",
  "dist", "node_modules", "out", "storybook-static", "vendor",
]);
const TEST_DIRECTORIES = new Set(["__tests__", "test", "tests", "spec", "specs"]);
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1024 * 1024;
const SUPPORTED_FORMATS = new Set(["json", "text"]);

const connectTransportPattern = /\bcreate(?:GrpcWeb|Connect)Transport\s*\(/;
const protobufTsTransportPattern = /\bnew\s+GrpcWebFetchTransport\s*\(/;

const STACKS = [
  {
    id: "generated-grpc-web",
    dependencies: ["grpc-web"],
    detectMatchers: [
      /\bfrom\s*["']grpc-web["']|\brequire\s*\(\s*["']grpc-web["']/,
      /\bfrom\s*["'][^"']*_grpc_web_pb(?:\.[cm]?[jt]s)?["']|\brequire\s*\(\s*["'][^"']*_grpc_web_pb(?:\.[cm]?[jt]s)?["']/,
    ],
    signals: {
      pageApi: {
        matcher: /__GRPCWEB_DEVTOOLS__/,
        hint: "Locate the browser-only installer and register every long-lived generated client.",
      },
      readiness: {
        matcher: /grpc-web-dev-tools-ready/,
        hint: "Run the installer immediately and from a grpc-web-dev-tools-ready listener.",
      },
    },
  },
  {
    id: "connect-es",
    dependencies: [
      "@connectrpc/connect", "@connectrpc/connect-web",
      "@bufbuild/connect", "@bufbuild/connect-web",
    ],
    detectMatchers: [
      connectTransportPattern,
      /\bfrom\s*["'](?:@connectrpc|@bufbuild)\/connect-web["']|\brequire\s*\(\s*["'](?:@connectrpc|@bufbuild)\/connect-web["']/,
    ],
    signals: {
      pageApi: {
        matcher: /__CONNECT_WEB_DEVTOOLS__/,
        hint: "Add a per-call browser-safe lookup of window.__CONNECT_WEB_DEVTOOLS__.",
      },
      lateBoundWrapper: {
        matcher: /__CONNECT_WEB_DEVTOOLS__[\s\S]{0,700}\bnext\s*\(/,
        hint: "Use a late-bound wrapper that falls back to next(request) when the page API is absent.",
      },
      transportInterceptor: {
        matcher: text => findConfiguredDevtoolsInterceptor(text, connectTransportPattern),
        hint: "Trace the active transport and place the DevTools wrapper in its interceptor configuration.",
      },
    },
  },
  {
    id: "protobuf-ts",
    dependencies: ["@protobuf-ts/grpcweb-transport", "@protobuf-ts/runtime-rpc"],
    detectMatchers: [
      protobufTsTransportPattern,
      /\bfrom\s*["']@protobuf-ts\/grpcweb-transport["']|\brequire\s*\(\s*["']@protobuf-ts\/grpcweb-transport["']/,
    ],
    signals: {
      pageApi: {
        matcher: /__GRPCWEB_DEVTOOLS_PROTOBUF_TS__/,
        hint: "Add a browser-safe per-call lookup of the protobuf-ts DevTools API.",
      },
      unary: {
        matcher: /\.interceptUnary\s*\(/,
        hint: "Delegate unary calls to devtools.interceptUnary and fall back to next.",
      },
      serverStreaming: {
        matcher: /\.interceptServerStreaming\s*\(/,
        hint: "Delegate server-streaming calls to devtools.interceptServerStreaming and fall back to next.",
      },
      transportInterceptor: {
        matcher: text => findConfiguredDevtoolsInterceptor(text, protobufTsTransportPattern),
        hint: "Trace GrpcWebFetchTransport and include the wrapper in its interceptor configuration.",
      },
    },
  },
];

function usage() {
  return [
    "Usage: node inspect-client.mjs [client-root] [--check] [--format json|text]",
    "",
    "Scans one client package without modifying it.",
    "Use --format text for concise diagnostics and JSON for automation.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = { check: false, format: "json", root: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--format") options.format = argv[++index];
    else if (argument.startsWith("--format=")) options.format = argument.slice("--format=".length);
    else if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    else if (options.root) throw new Error("Provide only one client root.");
    else options.root = argument;
  }
  if (!SUPPORTED_FORMATS.has(options.format)) throw new Error(`Unsupported format: ${options.format || "(missing)"}`);
  options.root = path.resolve(options.root || ".");
  return options;
}

function slashPath(value) {
  return value.split(path.sep).join("/");
}

function relativePath(root, file) {
  return slashPath(path.relative(root, file));
}

function isTestFile(file) {
  const normalized = slashPath(file);
  const segments = normalized.split("/");
  const basename = segments.at(-1) || "";
  return segments.some(segment => TEST_DIRECTORIES.has(segment.toLowerCase())) ||
    /(?:^|\.)[^/]*\.(?:test|spec)\.[^.]+$/i.test(basename);
}

function isDeclarationFile(file) {
  return /\.d\.(?:ts|mts|cts)$/i.test(file);
}

async function collectSourceFiles(root) {
  const files = [];
  const nestedPackageRoots = [];
  const skippedLargeFiles = [];
  let scanLimitReached = false;

  async function visit(directory, isRoot = false) {
    if (files.length >= MAX_FILES) {
      scanLimitReached = true;
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    if (!isRoot && entries.some(entry => entry.isFile() && entry.name === "package.json")) {
      nestedPackageRoots.push(directory);
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        scanLimitReached = true;
        break;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolute);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        const info = await stat(absolute);
        if (info.size > MAX_FILE_BYTES) skippedLargeFiles.push(absolute);
        else if (path.resolve(absolute) !== SCRIPT_FILE) files.push(absolute);
      }
    }
  }

  await visit(root, true);
  return { files, nestedPackageRoots, scanLimitReached, skippedLargeFiles };
}

async function readPackage(root) {
  const packagePath = path.join(root, "package.json");
  try {
    const parsed = JSON.parse(await readFile(packagePath, "utf8"));
    const dependencies = {
      ...parsed.dependencies,
      ...parsed.devDependencies,
      ...parsed.peerDependencies,
      ...parsed.optionalDependencies,
    };
    return {
      packagePath,
      packageName: parsed.name || null,
      packageManager: parsed.packageManager || null,
      dependencies,
      scripts: parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {},
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { packagePath: null, packageName: null, packageManager: null, dependencies: {}, scripts: {} };
    }
    throw new Error(`Unable to parse ${packagePath}: ${error.message}`);
  }
}

async function exists(file) {
  return !!(await stat(file).catch(() => null));
}

async function detectPackageManager(root, declared) {
  const declaredName = typeof declared === "string" ? declared.split("@")[0] : null;
  if (["npm", "pnpm", "yarn", "bun"].includes(declaredName)) return declaredName;
  const candidates = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ];
  for (const [file, manager] of candidates) {
    if (await exists(path.join(root, file))) return manager;
  }
  return null;
}

function commandForScript(manager, name) {
  if (manager === "yarn") return `yarn ${name}`;
  if (manager === "pnpm") return `pnpm ${name}`;
  if (manager === "bun") return `bun run ${name}`;
  return `npm run ${name}`;
}

function validationReport(packageManager, scripts) {
  const names = Object.keys(scripts)
    .filter(name => /^(?:test|typecheck|lint|build)(?::|$)/i.test(name))
    .sort((left, right) => left.localeCompare(right));
  return {
    packageManager,
    commands: names.map(name => ({ script: name, command: commandForScript(packageManager, name) })),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findConfiguredDevtoolsInterceptor(text, transportPattern) {
  if (matcherIndex(text, transportPattern) < 0) return -1;
  const direct = /interceptors\s*:\s*(?:\[[\s\S]{0,1600}?\b[\w$]*devtools[\w$]*\b[\s\S]{0,1600}?\]|\b[\w$]*devtools[\w$]*\b)/i.exec(text);
  if (direct) return direct.index;

  const fieldPattern = /interceptors\s*:\s*([A-Za-z_$][\w$]*)/g;
  for (const field of text.matchAll(fieldPattern)) {
    const identifier = escapeRegExp(field[1]);
    const declaration = new RegExp(
      `(?:const|let|var)\\s+${identifier}(?:\\s*:[^=]+)?\\s*=\\s*\\[[\\s\\S]{0,2400}?\\b[\\w$]*devtools[\\w$]*\\b[\\s\\S]{0,2400}?\\]`,
      "i"
    );
    if (declaration.test(text)) return field.index;
  }
  return -1;
}

function matcherIndex(text, matcher) {
  if (typeof matcher === "function") return Number(matcher(text));
  matcher.lastIndex = 0;
  const match = matcher.exec(text);
  matcher.lastIndex = 0;
  return match ? match.index : -1;
}

function firstMatcherIndex(text, matchers) {
  for (const matcher of matchers) {
    const index = matcherIndex(text, matcher);
    if (index >= 0) return index;
  }
  return -1;
}

function lineNumber(text, index) {
  return text.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function matchingLocations(sources, matcher) {
  return sources.flatMap(source => {
    const index = matcherIndex(source.text, matcher);
    return index < 0 ? [] : [{ file: source.file, line: lineNumber(source.text, index), kind: source.kind }];
  });
}

function matchingDetectionLocations(sources, matchers) {
  return sources.flatMap(source => {
    const index = firstMatcherIndex(source.text, matchers);
    return index < 0 ? [] : [{ file: source.file, line: lineNumber(source.text, index), kind: source.kind }];
  });
}

function filesFrom(locations) {
  return [...new Set(locations.map(location => location.file))];
}

function diagnostic(severity, code, message, files = []) {
  return { severity, code, message, files };
}

function buildDiagnostics(report, packageInfo) {
  const diagnostics = [];
  if (!report.packageJson) {
    diagnostics.push(diagnostic("warning", "package-json-missing", "No package.json was found at the selected client root."));
  }
  if (report.nestedPackageRoots.length) {
    diagnostics.push(diagnostic(
      "warning",
      "nested-packages-skipped",
      "Nested packages were skipped. Rerun the scanner at each exact client package root.",
      report.nestedPackageRoots
    ));
  }
  if (report.skippedLargeSourceFiles.length) {
    diagnostics.push(diagnostic(
      "warning",
      "large-sources-skipped",
      `Skipped ${report.skippedLargeSourceFiles.length} source file(s) larger than ${MAX_FILE_BYTES} bytes. Trace generated wrappers manually if needed.`,
      report.skippedLargeSourceFiles
    ));
  }
  if (report.scanLimitReached) {
    diagnostics.push(diagnostic("warning", "scan-limit-reached", `Stopped after ${MAX_FILES} source files; the report is incomplete.`));
  }
  if (!report.detectedStacks.length) {
    diagnostics.push(diagnostic("info", "no-supported-stack", "No supported web RPC client stack was detected in this package."));
  }
  if (report.detectedStacks.length > 1) {
    diagnostics.push(diagnostic("info", "multiple-stacks", "Multiple supported stacks were detected; trace and validate every active transport separately."));
  }

  report.stacks.filter(stack => stack.detected).forEach(stack => {
    Object.entries(stack.signals).forEach(([name, signal]) => {
      if (signal.present) return;
      const excludedNote = signal.excludedLocations.length
        ? " Matching text exists only in tests or declaration files and does not prove runtime integration."
        : "";
      diagnostics.push(diagnostic(
        "error",
        `${stack.id}.missing-${name}`,
        `${stack.signalHints[name]}${excludedNote}`,
        signal.excludedFiles
      ));
    });
  });

  const dependencyNames = Object.keys(packageInfo.dependencies);
  const legacyConnect = dependencyNames.some(name => name.startsWith("@bufbuild/connect"));
  const currentConnect = dependencyNames.some(name => name.startsWith("@connectrpc/connect"));
  if (legacyConnect && currentConnect) {
    diagnostics.push(diagnostic("warning", "connect-es.mixed-package-scopes", "Both @bufbuild/* and @connectrpc/* Connect packages are installed. Do not migrate or normalize imports without explicit authorization."));
  } else if (legacyConnect) {
    diagnostics.push(diagnostic("info", "connect-es.legacy-package-scope", "Legacy @bufbuild/* Connect packages are installed. Match that namespace and version; do not migrate dependencies automatically."));
  }

  const ssrDependencies = ["next", "nuxt", "@sveltejs/kit"].filter(name => packageInfo.dependencies[name]);
  if (ssrDependencies.length && report.detectedStacks.length) {
    diagnostics.push(diagnostic("warning", "browser-global-ssr-guard", `SSR-capable framework detected (${ssrDependencies.join(", ")}). Keep every window lookup behind a client-only boundary or runtime guard.`));
  }
  return diagnostics;
}

async function inspect(root) {
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo || !rootInfo.isDirectory()) throw new Error(`Client root is not a directory: ${root}`);

  const packageInfo = await readPackage(root);
  const collected = await collectSourceFiles(root);
  const sources = await Promise.all(collected.files.map(async file => {
    const relative = relativePath(root, file);
    const kind = isTestFile(relative) ? "test" : isDeclarationFile(relative) ? "declaration" : "production";
    return { file: relative, kind, text: await readFile(file, "utf8") };
  }));
  const productionSources = sources.filter(source => source.kind === "production");
  const excludedSources = sources.filter(source => source.kind !== "production");

  const stacks = STACKS.map(stack => {
    const dependencyEvidence = stack.dependencies.filter(name => packageInfo.dependencies[name]);
    const detectionLocations = matchingDetectionLocations(productionSources, stack.detectMatchers);
    const detected = dependencyEvidence.length > 0 || detectionLocations.length > 0;
    const signals = Object.fromEntries(Object.entries(stack.signals).map(([name, definition]) => {
      const locations = matchingLocations(productionSources, definition.matcher);
      const excludedLocations = matchingLocations(excludedSources, definition.matcher);
      return [name, {
        present: locations.length > 0,
        files: filesFrom(locations),
        locations,
        excludedFiles: filesFrom(excludedLocations),
        excludedLocations,
      }];
    }));
    const missingSignals = detected
      ? Object.entries(signals).filter(([, value]) => !value.present).map(([name]) => name)
      : [];
    const signalHints = Object.fromEntries(Object.entries(stack.signals).map(([name, definition]) => [name, definition.hint]));
    return {
      id: stack.id,
      detected,
      status: !detected ? "not-detected" : missingSignals.length ? "incomplete" : "complete",
      evidence: {
        dependencies: Object.fromEntries(dependencyEvidence.map(name => [name, packageInfo.dependencies[name]])),
        files: filesFrom(detectionLocations),
        locations: detectionLocations,
      },
      signals,
      missingSignals,
      signalHints,
      recommendation: detected && missingSignals.length
        ? missingSignals.map(name => signalHints[name])
        : null,
    };
  });

  const detected = stacks.filter(stack => stack.detected);
  const packageManager = await detectPackageManager(root, packageInfo.packageManager);
  const report = {
    schemaVersion: 2,
    mutatesTarget: false,
    root,
    packageJson: packageInfo.packagePath ? relativePath(root, packageInfo.packagePath) : null,
    packageName: packageInfo.packageName,
    packageManager,
    scannedSourceFiles: sources.length,
    scannedProductionSourceFiles: productionSources.length,
    excludedSourceFiles: excludedSources.map(source => ({ file: source.file, kind: source.kind })),
    skippedLargeSourceFiles: collected.skippedLargeFiles.map(file => relativePath(root, file)),
    nestedPackageRoots: collected.nestedPackageRoots.map(file => relativePath(root, file)),
    scanLimitReached: collected.scanLimitReached,
    detectedStacks: detected.map(result => result.id),
    stacks,
    diagnostics: [],
    validation: validationReport(packageManager, packageInfo.scripts),
    ready: detected.length > 0 && detected.every(result => result.status === "complete"),
  };
  report.diagnostics = buildDiagnostics(report, packageInfo);
  return report;
}

function locationLabel(location) {
  return `${location.file}:${location.line}`;
}

function formatText(report) {
  const lines = [
    "gRPC-Web client integration inspection",
    `Root: ${report.root}`,
    `Package: ${report.packageName || "(unknown)"}`,
    `Read-only: ${report.mutatesTarget ? "no" : "yes"}`,
    `Sources: ${report.scannedProductionSourceFiles} production, ${report.excludedSourceFiles.length} test/declaration excluded`,
    "",
    "Stacks:",
  ];

  const detected = report.stacks.filter(stack => stack.detected);
  if (!detected.length) lines.push("- No supported stack detected");
  detected.forEach(stack => {
    lines.push(`- ${stack.id}: ${stack.status}`);
    const evidence = stack.evidence.locations.slice(0, 6).map(locationLabel);
    if (evidence.length) lines.push(`  evidence: ${evidence.join(", ")}`);
    if (stack.missingSignals.length) lines.push(`  missing: ${stack.missingSignals.join(", ")}`);
  });

  if (report.diagnostics.length) {
    lines.push("", "Diagnostics:");
    report.diagnostics.forEach(item => {
      lines.push(`- [${item.severity}] ${item.code}: ${item.message}`);
      if (item.files.length) lines.push(`  files: ${item.files.slice(0, 8).join(", ")}`);
    });
  }

  if (report.validation.commands.length) {
    lines.push("", "Available validation commands:");
    report.validation.commands.forEach(item => lines.push(`- ${item.command}`));
  }

  const result = !report.detectedStacks.length ? "NO SUPPORTED STACK" : report.ready ? "READY" : "INCOMPLETE";
  lines.push("", `Result: ${result}`);
  return lines.join("\n");
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 64;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  try {
    const report = await inspect(options.root);
    console.log(options.format === "text" ? formatText(report) : JSON.stringify(report, null, 2));
    if (options.check) {
      if (report.detectedStacks.length === 0) process.exitCode = 2;
      else if (!report.ready) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 64;
  }
}

await main();
