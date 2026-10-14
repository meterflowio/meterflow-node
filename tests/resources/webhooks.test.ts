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

const WEBHOOK_RESPONSE = {
  id: "wh-1",
  project_id: "proj-1",
  url: "https://hooks.example/meterflow",
  events: ["usage.recorded"],
  low_balance_threshold: null,
  is_active: true,
  last_triggered_at: null,
  failure_count: 0,
  metadata_: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const DELIVERY_RESPONSE = {
  id: "del-1",
  webhook_id: "wh-1",
  event_type: "usage.recorded",
  payload: { event: "usage.recorded", environment: "test", customer_id: "customer_123" },
  status: "success",
  response_code: 200,
  response_body: "ok",
  attempts: 1,
  next_retry_at: null,
  created_at: "2026-01-01T00:00:00Z",
  completed_at: "2026-01-01T00:00:01Z",
};

describe("webhooks.list", () => {
  it("GET /webhooks returns the project's endpoints", async () => {
    server.use(http.get(`${BASE}/webhooks`, () => HttpResponse.json([WEBHOOK_RESPONSE])));
    const result = await makeClient().webhooks.list();
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe("https://hooks.example/meterflow");
  });

  it("sends no project_id — the key's own project is the scope", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/webhooks`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([WEBHOOK_RESPONSE]);
      }),
    );
    await makeClient().webhooks.list();
    expect(new URL(capturedUrl).searchParams.get("project_id")).toBeNull();
  });

  it("sets Authorization and User-Agent headers", async () => {
    let auth: string | null = null;
    let ua: string | null = null;
    server.use(
      http.get(`${BASE}/webhooks`, ({ request }) => {
        auth = request.headers.get("Authorization");
        ua = request.headers.get("User-Agent");
        return HttpResponse.json([]);
      }),
    );
    await makeClient().webhooks.list();
    expect(auth).toBe("Bearer mf_test_abc");
    expect(ua).toMatch(/^meterflow-node\//);
  });

  it("never carries a secret — it is shown once in the dashboard and never read back", async () => {
    server.use(http.get(`${BASE}/webhooks`, () => HttpResponse.json([WEBHOOK_RESPONSE])));
    const [webhook] = await makeClient().webhooks.list();
    expect(webhook).not.toHaveProperty("secret");
  });
});

describe("webhooks.deliveries", () => {
  it("GET /webhooks/:id/deliveries returns the receipts", async () => {
    server.use(http.get(`${BASE}/webhooks/wh-1/deliveries`, () => HttpResponse.json([DELIVERY_RESPONSE])));
    const [receipt] = await makeClient().webhooks.deliveries("wh-1");
    expect(receipt?.event_type).toBe("usage.recorded");
    expect(receipt?.response_code).toBe(200);
    expect(receipt?.attempts).toBe(1);
  });

  it("encodes the webhook id into the path", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/webhooks/:id/deliveries`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await makeClient().webhooks.deliveries("wh 1/../2");
    expect(new URL(capturedUrl).pathname).toContain("wh%201%2F..%2F2");
  });

  it("throws NotFoundError for a webhook in another project", async () => {
    // The API answers 404 rather than 403 on purpose: an opaque id must not confirm that it
    // exists somewhere else.
    server.use(
      http.get(`${BASE}/webhooks/someone-elses/deliveries`, () =>
        HttpResponse.json({ error: { code: 404, message: "Webhook not found" } }, { status: 404 }),
      ),
    );
    await expect(makeClient().webhooks.deliveries("someone-elses")).rejects.toBeInstanceOf(NotFoundError);
  });
});
