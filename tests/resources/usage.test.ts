import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MeterFlow } from "../../src/client";

const BASE = "https://api.meterflow.com/api/v1";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new MeterFlow({ apiKey: "mf_test_abc", retries: 0 });
}

const EVENT_RESPONSE = {
  id: "evt-1",
  event_name: "api_call",
  customer_external_id: "cust-1",
  quantity: 1,
  timestamp: "2026-01-01T00:00:00Z",
  idempotency_key: null,
  processed: false,
  project_id: "proj-1",
  metadata_: {},
  created_at: "2026-01-01T00:00:00Z",
};

const SUMMARY_RESPONSE = {
  customer_external_id: "cust-1",
  from_: "2026-01-01T00:00:00Z",
  to: "2026-01-31T23:59:59Z",
  meters: [{ meter_id: "m-1", meter_name: "api_call", event_name: "api_call", aggregation_type: "count", value: "42" }],
};

describe("usage.record", () => {
  it("POST /usage/events with correct URL and body", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/usage/events`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(EVENT_RESPONSE, { status: 201 });
      }),
    );

    const result = await makeClient().usage.record({ event_name: "api_call", customer_external_id: "cust-1", quantity: 1 });
    expect((capturedBody as Record<string, unknown>).event_name).toBe("api_call");
    expect(result.id).toBe("evt-1");
  });

  it("forwards idempotency key", async () => {
    let idem: string | null = null;
    server.use(
      http.post(`${BASE}/usage/events`, ({ request }) => {
        idem = request.headers.get("Idempotency-Key");
        return HttpResponse.json(EVENT_RESPONSE, { status: 201 });
      }),
    );
    await makeClient().usage.record({ event_name: "api_call", customer_external_id: "c", quantity: 1 }, { idempotencyKey: "idem-key" });
    expect(idem).toBe("idem-key");
  });
});

describe("usage.recordBatch", () => {
  it("POST /usage/events/batch wraps events in { events: [...] }", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/usage/events/batch`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json([EVENT_RESPONSE], { status: 201 });
      }),
    );

    const events = [{ event_name: "api_call", customer_external_id: "c", quantity: 2 }];
    const result = await makeClient().usage.recordBatch(events);

    expect((capturedBody as Record<string, unknown>).events).toEqual(events);
    expect(result).toHaveLength(1);
  });

  it("forwards idempotency key on recordBatch", async () => {
    let idem: string | null = null;
    server.use(
      http.post(`${BASE}/usage/events/batch`, ({ request }) => {
        idem = request.headers.get("Idempotency-Key");
        return HttpResponse.json([EVENT_RESPONSE], { status: 201 });
      }),
    );
    await makeClient().usage.recordBatch([{ event_name: "api_call", customer_external_id: "c", quantity: 1 }], { idempotencyKey: "batch-key" });
    expect(idem).toBe("batch-key");
  });
});

describe("usage.summary", () => {
  it("GET /usage/:customerId returns summary", async () => {
    server.use(http.get(`${BASE}/usage/cust-1`, () => HttpResponse.json(SUMMARY_RESPONSE)));

    const result = await makeClient().usage.summary("cust-1");
    expect(result.customer_external_id).toBe("cust-1");
    expect(result.meters).toHaveLength(1);
  });

  it("passes query params meter_id, from_, to", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/usage/cust-1`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(SUMMARY_RESPONSE);
      }),
    );

    await makeClient().usage.summary("cust-1", { meter_id: "m-1", from_: "2026-01-01", to: "2026-01-31" });
    const url = new URL(capturedUrl);
    expect(url.searchParams.get("meter_id")).toBe("m-1");
    expect(url.searchParams.get("from_")).toBe("2026-01-01");
    expect(url.searchParams.get("to")).toBe("2026-01-31");
  });
});
