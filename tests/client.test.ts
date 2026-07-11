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

describe("browser compatibility", () => {
  it("calls the default global fetch bound to globalThis (guards the browser 'Illegal invocation' bug)", async () => {
    const realFetch = globalThis.fetch;
    // Browsers require window.fetch to run with `this === window`. Node's fetch tolerates any `this`,
    // so a binding regression would pass in Node/MSW and only break in the browser — emulate the
    // browser's strictness here so the default-fetch binding is actually covered.
    const strictFetch = function (this: unknown): Promise<Response> {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    };
    globalThis.fetch = strictFetch as unknown as typeof globalThis.fetch;
    try {
      const client = new MeterFlow({ apiKey: "mf_test_x", baseUrl: "http://localhost/api/v1" });
      await expect(client.plans.list()).resolves.toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
