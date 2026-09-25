/**
 * @jest-environment ./e2e/harness/environment.js
 */
// Real-library end-to-end matrix: generated grpc-web callback client, grpc-web-text wire format
// See docs/plans/2026-09-24-full-feature-test-plan.md.
import { defineStackSuite } from "../../e2e/harness/scenarios";
import { STACKS } from "../../e2e/harness/stacks";

jest.setTimeout(20000);

describe("grpc-web-text-callback", () => {
  defineStackSuite(STACKS["grpc-web-text-callback"]);
});
