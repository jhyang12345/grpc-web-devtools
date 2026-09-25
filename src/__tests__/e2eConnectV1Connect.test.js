/**
 * @jest-environment ./e2e/harness/environment.js
 */
// Real-library end-to-end matrix: Connect-ES v1 (protobuf-es v1) with createConnectTransport
// See docs/plans/2026-09-24-full-feature-test-plan.md.
import { defineStackSuite } from "../../e2e/harness/scenarios";
import { STACKS } from "../../e2e/harness/stacks";

// Jest 27 ignores package "exports", so package.json maps these subpaths to the
// root (v2) copy. Point them back at the isolated v1 package for this suite.
jest.mock("@connectrpc/connect/protocol", () => jest.requireActual("../../e2e/connect-v1/node_modules/@connectrpc/connect/dist/cjs/protocol/index.js"));
jest.mock("@connectrpc/connect/protocol-connect", () => jest.requireActual("../../e2e/connect-v1/node_modules/@connectrpc/connect/dist/cjs/protocol-connect/index.js"));
jest.mock("@connectrpc/connect/protocol-grpc-web", () => jest.requireActual("../../e2e/connect-v1/node_modules/@connectrpc/connect/dist/cjs/protocol-grpc-web/index.js"));

jest.setTimeout(20000);

describe("connect-v1-connect", () => {
  defineStackSuite(STACKS["connect-v1-connect"]);
});
