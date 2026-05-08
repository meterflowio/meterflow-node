import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MeterFlow } from "../../src/client";
import { NotFoundError } from "../../src/errors";

const BASE = "https://api.meterflow.com/api/v1";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new MeterFlow({ apiKey: "mf_test_abc", retries: 0 });
}

const PLAN_RESPONSE = {
  id: "plan-1",
  name: "Pro",
  slug: "pro",
  description: null,
  price: "49.00",
  billing_period: "monthly",
  currency: "USD",
  trial_days: 0,
  is_active: true,
  is_public: true,
  project_id: "proj-1",
  meter_limits: [],
  metadata_: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("plans.list", () => {
  it("GET /plans returns list of plans", async () => {
    server.use(http.get(`${BASE}/plans`, () => HttpResponse.json([PLAN_RESPONSE])));
    const result = await makeClient().plans.list();
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("plan-1");
  });

  it("passes project_id query param", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/plans`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([PLAN_RESPONSE]);
      }),
    );
    await makeClient().plans.list({ project_id: "proj-1" });
    expect(new URL(capturedUrl).searchParams.get("project_id")).toBe("proj-1");
  });

  it("sets Authorization and User-Agent headers", async () => {
    let auth: string | null = null;
    let ua: string | null = null;
    server.use(
      http.get(`${BASE}/plans`, ({ request }) => {
        auth = request.headers.get("Authorization");
        ua = request.headers.get("User-Agent");
        return HttpResponse.json([]);
      }),
    );
    await makeClient().plans.list();
    expect(auth).toBe("Bearer mf_test_abc");
    expect(ua).toMatch(/^meterflow-node\//);
  });
});

describe("plans.get", () => {
  it("GET /plans/:planId returns a plan", async () => {
    server.use(http.get(`${BASE}/plans/plan-1`, () => HttpResponse.json(PLAN_RESPONSE)));
    const result = await makeClient().plans.get("plan-1");
    expect(result.id).toBe("plan-1");
    expect(result.name).toBe("Pro");
  });

  it("passes project_id query param", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/plans/plan-1`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(PLAN_RESPONSE);
      }),
    );
    await makeClient().plans.get("plan-1", { project_id: "proj-1" });
    expect(new URL(capturedUrl).searchParams.get("project_id")).toBe("proj-1");
  });

  it("throws NotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/plans/missing`, () => HttpResponse.json({ detail: "not found" }, { status: 404 })));
    await expect(makeClient().plans.get("missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});
