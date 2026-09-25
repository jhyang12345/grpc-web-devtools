/**
 * @jest-environment ./e2e/harness/environment.js
 */
// Real-library end-to-end matrix: protobuf-ts GrpcWebFetchTransport
// See docs/plans/2026-09-24-full-feature-test-plan.md.
import { defineStackSuite } from "../../e2e/harness/scenarios";
import { STACKS } from "../../e2e/harness/stacks";

jest.setTimeout(20000);

describe("protobuf-ts", () => {
  defineStackSuite(STACKS["protobuf-ts"]);
});
