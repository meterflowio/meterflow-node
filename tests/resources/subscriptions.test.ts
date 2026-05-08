import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MeterFlow } from "../../src/client";
import { ConflictError, NotFoundError } from "../../src/errors";

const BASE = "https://api.meterflow.com/api/v1";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new MeterFlow({ apiKey: "mf_test_abc", retries: 0 });
}

const SUB_RESPONSE = {
  id: "sub-1",
  customer_external_id: "cust-1",
  plan_id: "plan-1",
  project_id: "proj-1",
  status: "active",
  current_period_start: "2026-01-01T00:00:00Z",
  current_period_end: "2026-02-01T00:00:00Z",
  trial_end_date: null,
  canceled_at: null,
  metadata_: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("subscriptions.create", () => {
  it("POST /subscriptions returns subscription", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/subscriptions`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(SUB_RESPONSE, { status: 201 });
      }),
    );

    const result = await makeClient().subscriptions.create({ customer_external_id: "cust-1", plan_id: "plan-1", metadata: {} });
    expect((capturedBody as Record<string, unknown>).customer_external_id).toBe("cust-1");
    expect(result.id).toBe("sub-1");
    expect(result.status).toBe("active");
  });

  it("forwards idempotency key", async () => {
    let idem: string | null = null;
    server.use(
      http.post(`${BASE}/subscriptions`, ({ request }) => {
        idem = request.headers.get("Idempotency-Key");
        return HttpResponse.json(SUB_RESPONSE, { status: 201 });
      }),
    );
    await makeClient().subscriptions.create({ customer_external_id: "c", plan_id: "p", metadata: {} }, { idempotencyKey: "key-1" });
    expect(idem).toBe("key-1");
  });

  it("throws ConflictError on 409", async () => {
    server.use(http.post(`${BASE}/subscriptions`, () => HttpResponse.json({ detail: "already exists" }, { status: 409 })));
    await expect(makeClient().subscriptions.create({ customer_external_id: "c", plan_id: "p", metadata: {} })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("subscriptions.list", () => {
  it("GET /subscriptions returns list", async () => {
    server.use(http.get(`${BASE}/subscriptions`, () => HttpResponse.json([SUB_RESPONSE])));
    const result = await makeClient().subscriptions.list();
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("sub-1");
  });

  it("passes customer_id query param", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/subscriptions`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([SUB_RESPONSE]);
      }),
    );
    await makeClient().subscriptions.list({ customer_id: "cust-1" });
    expect(new URL(capturedUrl).searchParams.get("customer_id")).toBe("cust-1");
  });
});

describe("subscriptions.get", () => {
  it("GET /subscriptions/:id returns subscription", async () => {
    server.use(http.get(`${BASE}/subscriptions/sub-1`, () => HttpResponse.json(SUB_RESPONSE)));
    const result = await makeClient().subscriptions.get("sub-1");
    expect(result.id).toBe("sub-1");
  });

  it("throws NotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/subscriptions/missing`, () => HttpResponse.json({ detail: "not found" }, { status: 404 })));
    await expect(makeClient().subscriptions.get("missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("subscriptions.update", () => {
  it("PATCH /subscriptions/:id returns updated subscription", async () => {
    const updated = { ...SUB_RESPONSE, status: "canceled" };
    let capturedBody: unknown;
    server.use(
      http.patch(`${BASE}/subscriptions/sub-1`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(updated);
      }),
    );

    const result = await makeClient().subscriptions.update("sub-1", { status: "canceled" });
    expect((capturedBody as Record<string, unknown>).status).toBe("canceled");
    expect(result.status).toBe("canceled");
  });

  it("forwards idempotency key on update", async () => {
    let idem: string | null = null;
    server.use(
      http.patch(`${BASE}/subscriptions/sub-1`, ({ request }) => {
        idem = request.headers.get("Idempotency-Key");
        return HttpResponse.json(SUB_RESPONSE);
      }),
    );
    await makeClient().subscriptions.update("sub-1", { status: "paused" }, { idempotencyKey: "update-key" });
    expect(idem).toBe("update-key");
  });
});

describe("subscriptions.delete", () => {
  it("DELETE /subscriptions/:id sends correct request", async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/subscriptions/sub-1`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await makeClient().subscriptions.delete("sub-1");
    expect(called).toBe(true);
  });
});
