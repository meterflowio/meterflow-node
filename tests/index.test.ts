import { describe, it, expect } from "vitest";
import {
  MeterFlow,
  MeterFlowError,
  AuthError,
  NotFoundError,
  InsufficientCreditsError,
  ConflictError,
  PayloadTooLargeError,
  ValidationError,
  RateLimitError,
  ServerError,
  MAX_BATCH_EVENTS,
} from "../src/index";

describe("public index exports", () => {
  it("exports MeterFlow client class", () => {
    expect(MeterFlow).toBeDefined();
    expect(new MeterFlow({ apiKey: "mf_test_x" })).toBeInstanceOf(MeterFlow);
  });

  it("exports all error classes", () => {
    expect(MeterFlowError).toBeDefined();
    expect(AuthError).toBeDefined();
    expect(NotFoundError).toBeDefined();
    expect(InsufficientCreditsError).toBeDefined();
    expect(ConflictError).toBeDefined();
    expect(PayloadTooLargeError).toBeDefined();
    expect(ValidationError).toBeDefined();
    expect(RateLimitError).toBeDefined();
    expect(ServerError).toBeDefined();
  });

  it("exports the batch cap so callers can chunk against the number the SDK enforces", () => {
    expect(MAX_BATCH_EVENTS).toBe(500);
  });
});
