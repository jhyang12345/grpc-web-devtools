// Installs the isolated Connect-ES v1 runtime used by the e2eConnectV1* suites.
// It cannot live in the root package: its peer dependency on @bufbuild/protobuf
// v1 conflicts with the protobuf-es v2 stack the other suites use.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "connect-v1");
if (!fs.existsSync(path.join(dir, "node_modules", "@connectrpc", "connect-web"))) {
  execSync("npm ci --no-audit --no-fund", { cwd: dir, stdio: "inherit" });
}
