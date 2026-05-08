import { describe, it, expect } from "vitest";
import { MeterFlow } from "../src/client";

describe("MeterFlow client constructor", () => {
  it("accepts mf_live_ prefixed key", () => {
    expect(() => new MeterFlow({ apiKey: "mf_live_abc" })).not.toThrow();
  });

  it("accepts mf_test_ prefixed key", () => {
    expect(() => new MeterFlow({ apiKey: "mf_test_abc" })).not.toThrow();
  });

  it("rejects invalid key prefix", () => {
    expect(() => new MeterFlow({ apiKey: "sk_live_abc" })).toThrow(/mf_live_|mf_test_/);
  });

  it("defaults baseUrl to production endpoint", () => {
    const client = new MeterFlow({ apiKey: "mf_test_x" });
    expect(client.options.baseUrl).toBe("https://api.meterflow.com/api/v1");
  });

  it("accepts custom baseUrl", () => {
    const client = new MeterFlow({ apiKey: "mf_test_x", baseUrl: "http://localhost:8000/api/v1" });
    expect(client.options.baseUrl).toBe("http://localhost:8000/api/v1");
  });

  it("defaults timeout to 30000ms", () => {
    const client = new MeterFlow({ apiKey: "mf_test_x" });
    expect(client.options.timeout).toBe(30_000);
  });

  it("defaults retries to 3", () => {
    const client = new MeterFlow({ apiKey: "mf_test_x" });
    expect(client.options.retries).toBe(3);
  });

  it("lazily instantiates resources on first access", () => {
    const client = new MeterFlow({ apiKey: "mf_test_x" });
    const credits = client.credits;
    expect(client.credits).toBe(credits);
  });

  it("exposes credits, usage, subscriptions, plans resources", () => {
    const client = new MeterFlow({ apiKey: "mf_test_x" });
    expect(client.credits).toBeDefined();
    expect(client.usage).toBeDefined();
    expect(client.subscriptions).toBeDefined();
    expect(client.plans).toBeDefined();
  });
});
