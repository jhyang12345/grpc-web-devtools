/**
 * @jest-environment ./e2e/harness/environment.js
 */
// Real-library end-to-end matrix: Connect-ES v2 (protobuf-es v2) with createConnectTransport
// See docs/plans/2026-09-24-full-feature-test-plan.md.
import { defineStackSuite } from "../../e2e/harness/scenarios";
import { STACKS } from "../../e2e/harness/stacks";

jest.setTimeout(20000);

describe("connect-v2-connect", () => {
  defineStackSuite(STACKS["connect-v2-connect"]);
});
