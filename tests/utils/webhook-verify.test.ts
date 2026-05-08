import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyWebhook } from "../../src/utils/webhook-verify";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex");
}

describe("verifyWebhook", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ event: "credit.granted", amount: 100 });
  const validSig = sign(body, secret);

  it("returns true for a valid signature (string body)", () => {
    expect(verifyWebhook(body, validSig, secret)).toBe(true);
  });

  it("returns true for a valid signature (Buffer body)", () => {
    expect(verifyWebhook(Buffer.from(body, "utf8"), validSig, secret)).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    expect(verifyWebhook(body, "deadbeef".repeat(8), secret)).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const wrongSig = sign(body, "wrong-secret");
    expect(verifyWebhook(body, wrongSig, secret)).toBe(false);
  });

  it("returns false when body is tampered", () => {
    const tamperedBody = JSON.stringify({ event: "credit.granted", amount: 999 });
    expect(verifyWebhook(tamperedBody, validSig, secret)).toBe(false);
  });

  it("returns false on length mismatch (short signature)", () => {
    expect(verifyWebhook(body, "abc", secret)).toBe(false);
  });

  it("returns false on empty signature", () => {
    expect(verifyWebhook(body, "", secret)).toBe(false);
  });

  it("is deterministic — same inputs always produce the same result", () => {
    expect(verifyWebhook(body, validSig, secret)).toBe(true);
    expect(verifyWebhook(body, validSig, secret)).toBe(true);
  });

  it("is sensitive to different secrets", () => {
    const sig1 = sign(body, "secret-a");
    const sig2 = sign(body, "secret-b");
    expect(sig1).not.toBe(sig2);
    expect(verifyWebhook(body, sig1, "secret-a")).toBe(true);
    expect(verifyWebhook(body, sig2, "secret-a")).toBe(false);
  });

  it("produces a 64-char hex signature", () => {
    expect(validSig).toHaveLength(64);
    expect(validSig).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["empty body", ""],
    ["unicode body", "€™"],
    ["binary-like body", "\x00\x01\x02"],
  ])("handles %s correctly", (_, testBody) => {
    const sig = sign(testBody, secret);
    expect(verifyWebhook(testBody, sig, secret)).toBe(true);
    expect(verifyWebhook(testBody, "wrong" + sig.slice(5), secret)).toBe(false);
  });
});
