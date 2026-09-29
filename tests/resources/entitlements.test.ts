import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MeterFlow } from "../../src/client";
import { NotFoundError } from "../../src/errors";

const BASE = "https://api.meter-flow.com/api/v1";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new MeterFlow({ apiKey: "mf_test_abc", retries: 0 });
}

const ALLOWED = {
  feature: "images.generated",
  feature_type: "metered",
  allowed: true,
  reason: null,
  limit_type: "hard",
  included: 500,
  used: "120",
  remaining: "380",
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
};

describe("entitlements.get", () => {
  it("GET /entitlements/{customer_id} returns the plan's features with usage", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/entitlements/cust_1`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({
          customer_id: "cust_1",
          environment: "test",
          subscription_id: "sub-1",
          plan_id: "plan-1",
          period_end: "2026-10-01T00:00:00Z",
          entitlements: [ALLOWED, { feature: "sso", feature_type: "boolean", allowed: true, reason: null }],
        });
      }),
    );
    const result = await makeClient().entitlements.get("cust_1");
    expect(result.entitlements).toHaveLength(2);
    expect(result.entitlements[1]?.feature).toBe("sso");
    expect(new URL(capturedUrl).search).toBe("");
  });

  it("URL-encodes the customer id", async () => {
    let hit = false;
    server.use(
      http.get(`${BASE}/entitlements/user%2F42`, () => {
        hit = true;
        return HttpResponse.json({ customer_id: "user/42", environment: "test", subscription_id: null, plan_id: null, period_end: null, entitlements: [] });
      }),
    );
    const result = await makeClient().entitlements.get("user/42");
    expect(hit).toBe(true);
    expect(result.entitlements).toEqual([]);
  });
});

describe("entitlements.check", () => {
  it("GET /entitlements/{customer_id}/check with the feature and no quantity by default", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/entitlements/cust_1/check`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(ALLOWED);
      }),
    );
    const result = await makeClient().entitlements.check("cust_1", "images.generated");
    const params = new URL(capturedUrl).searchParams;
    expect(params.get("feature")).toBe("images.generated");
    expect(params.has("quantity")).toBe(false);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe("380");
  });

  it("passes quantity when given — 'may they do 5 more?'", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/entitlements/cust_1/check`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(ALLOWED);
      }),
    );
    await makeClient().entitlements.check("cust_1", "images.generated", { quantity: 5 });
    expect(new URL(capturedUrl).searchParams.get("quantity")).toBe("5");
  });

  it("allowed: false is a normal answer, not an error — reason says why", async () => {
    server.use(
      http.get(`${BASE}/entitlements/cust_1/check`, () =>
        HttpResponse.json({ ...ALLOWED, allowed: false, used: "500", remaining: "0", reason: "hard_limit_reached" }),
      ),
    );
    const result = await makeClient().entitlements.check("cust_1", "images.generated");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("hard_limit_reached");
  });

  it("an unknown feature key is a NotFoundError — a typo, not a plan", async () => {
    server.use(
      http.get(`${BASE}/entitlements/cust_1/check`, () =>
        HttpResponse.json({ error: { code: 404, message: "Unknown feature 'imagess.generated'" } }, { status: 404 }),
      ),
    );
    const err = await makeClient().entitlements.check("cust_1", "imagess.generated").catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toContain("Unknown feature");
  });
});
