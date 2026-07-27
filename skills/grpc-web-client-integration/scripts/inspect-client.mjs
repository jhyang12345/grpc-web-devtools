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
  ".git", ".next", ".nuxt", ".svelte-kit", "build", "coverage", "dist",
  "node_modules", "out", "vendor",
]);
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1024 * 1024;

const STACKS = [
  {
    id: "generated-grpc-web",
    dependencies: ["grpc-web"],
    detectPatterns: [/\bgrpc-web\b/, /_grpc_web_pb(?:\.[cm]?[jt]s)?["']/],
    signals: {
      pageApi: /__GRPCWEB_DEVTOOLS__/,
      readiness: /grpc-web-dev-tools-ready/,
    },
    recommendation: "Register every generated client immediately and on grpc-web-dev-tools-ready.",
  },
  {
    id: "connect-es",
    dependencies: [
      "@connectrpc/connect", "@connectrpc/connect-web",
      "@bufbuild/connect", "@bufbuild/connect-web",
    ],
    detectPatterns: [/create(?:GrpcWeb|Connect)Transport\s*\(/, /@connectrpc\/connect-web/],
    signals: {
      pageApi: /__CONNECT_WEB_DEVTOOLS__/,
      lateBoundWrapper: /__CONNECT_WEB_DEVTOOLS__[\s\S]{0,500}\bnext\s*\(/,
      transportInterceptor: /interceptors\s*:\s*\[[^\]]*(?:devtools|Devtools|DevTools)/,
    },
    recommendation: "Add a late-bound Connect interceptor to the transport before auth/retry interceptors.",
  },
  {
    id: "protobuf-ts",
    dependencies: ["@protobuf-ts/grpcweb-transport", "@protobuf-ts/runtime-rpc"],
    detectPatterns: [/GrpcWebFetchTransport\s*\(/, /@protobuf-ts\/grpcweb-transport/],
    signals: {
      pageApi: /__GRPCWEB_DEVTOOLS_PROTOBUF_TS__/,
      unary: /interceptUnary\s*\(/,
      serverStreaming: /interceptServerStreaming\s*\(/,
      transportInterceptor: /interceptors\s*:\s*\[[^\]]*(?:devtools|Devtools|DevTools)/,
    },
    recommendation: "Add late-bound unary and server-streaming RpcInterceptor methods before auth/retry interceptors.",
  },
];

function usage() {
  return [
    "Usage: node inspect-client.mjs [client-root] [--check]",
    "",
    "Scans package dependencies and source without modifying the client.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = { check: false, root: null };
  for (const argument of argv) {
    if (argument === "--check") options.check = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    else if (options.root) throw new Error("Provide only one client root.");
    else options.root = argument;
  }
  options.root = path.resolve(options.root || ".");
  return options;
}

async function collectSourceFiles(root) {
  const files = [];

  async function visit(directory) {
    if (files.length >= MAX_FILES) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolute);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        const info = await stat(absolute);
        if (info.size <= MAX_FILE_BYTES && path.resolve(absolute) !== SCRIPT_FILE) files.push(absolute);
      }
    }
  }

  await visit(root);
  return files;
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
    return { packagePath, packageName: parsed.name || null, dependencies };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { packagePath: null, packageName: null, dependencies: {} };
    }
    throw new Error(`Unable to parse ${packagePath}: ${error.message}`);
  }
}

function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function inspect(root) {
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo || !rootInfo.isDirectory()) throw new Error(`Client root is not a directory: ${root}`);

  const packageInfo = await readPackage(root);
  const files = await collectSourceFiles(root);
  const sources = await Promise.all(files.map(async file => ({
    file: relativePath(root, file),
    text: await readFile(file, "utf8"),
  })));

  const results = STACKS.map(stack => {
    const dependencyEvidence = stack.dependencies.filter(name => packageInfo.dependencies[name]);
    const detectionFiles = sources
      .filter(source => stack.detectPatterns.some(pattern => pattern.test(source.text)))
      .map(source => source.file);
    const detected = dependencyEvidence.length > 0 || detectionFiles.length > 0;
    const signals = Object.fromEntries(Object.entries(stack.signals).map(([name, pattern]) => {
      const matchingFiles = sources.filter(source => pattern.test(source.text)).map(source => source.file);
      return [name, { present: matchingFiles.length > 0, files: matchingFiles }];
    }));
    const missingSignals = detected
      ? Object.entries(signals).filter(([, value]) => !value.present).map(([name]) => name)
      : [];

    return {
      id: stack.id,
      detected,
      status: !detected ? "not-detected" : missingSignals.length ? "incomplete" : "complete",
      evidence: {
        dependencies: Object.fromEntries(dependencyEvidence.map(name => [name, packageInfo.dependencies[name]])),
        files: detectionFiles,
      },
      signals,
      missingSignals,
      recommendation: detected && missingSignals.length ? stack.recommendation : null,
    };
  });

  const detected = results.filter(result => result.detected);
  return {
    root,
    packageJson: packageInfo.packagePath ? relativePath(root, packageInfo.packagePath) : null,
    packageName: packageInfo.packageName,
    scannedSourceFiles: files.length,
    scanLimitReached: files.length >= MAX_FILES,
    detectedStacks: detected.map(result => result.id),
    stacks: results,
    ready: detected.length > 0 && detected.every(result => result.status === "complete"),
  };
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
    console.log(JSON.stringify(report, null, 2));
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
