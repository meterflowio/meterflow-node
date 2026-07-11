import { describe, it, expect } from "vitest";
import { verifyWebhook } from "../src/webhook";

// Guards the public "meterflow/webhook" entry point. verifyWebhook was moved
// off the root barrel (it depends on Node's `crypto`) so the main client stays
// browser-safe; this asserts it is still reachable from its dedicated entry.
describe("meterflow/webhook entry point", () => {
  it("exports verifyWebhook", () => {
    expect(verifyWebhook).toBeDefined();
    expect(typeof verifyWebhook).toBe("function");
  });
});
