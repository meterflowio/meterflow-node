import { describe, it, expect } from "vitest";
import {
  MeterFlow,
  verifyWebhook,
  MeterFlowError,
  AuthError,
  NotFoundError,
  InsufficientCreditsError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ServerError,
} from "../src/index";

describe("public index exports", () => {
  it("exports MeterFlow client class", () => {
    expect(MeterFlow).toBeDefined();
    expect(new MeterFlow({ apiKey: "mf_test_x" })).toBeInstanceOf(MeterFlow);
  });

  it("exports verifyWebhook", () => {
    expect(verifyWebhook).toBeDefined();
    expect(typeof verifyWebhook).toBe("function");
  });

  it("exports all error classes", () => {
    expect(MeterFlowError).toBeDefined();
    expect(AuthError).toBeDefined();
    expect(NotFoundError).toBeDefined();
    expect(InsufficientCreditsError).toBeDefined();
    expect(ConflictError).toBeDefined();
    expect(ValidationError).toBeDefined();
    expect(RateLimitError).toBeDefined();
    expect(ServerError).toBeDefined();
  });
});
