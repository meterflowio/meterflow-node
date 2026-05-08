import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MeterFlow } from "../../src/client";
import { AuthError, InsufficientCreditsError, NotFoundError, RateLimitError, ServerError, ValidationError } from "../../src/errors";

const BASE = "https://api.meterflow.com/api/v1";
const API_KEY = "mf_test_abc123";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new MeterFlow({ apiKey: API_KEY, retries: 0 });
}

const TX_RESPONSE = {
  id: "tx-1",
  amount: "100",
  balance_before: "0",
  balance_after: "100",
  transaction_type: "grant",
  customer_external_id: "cust-1",
  project_id: "proj-1",
  description: null,
  idempotency_key: null,
  metadata_: {},
  created_at: "2026-01-01T00:00:00Z",
};

const BALANCE_RESPONSE = {
  id: "bal-1",
  balance: "100",
  total_granted: "100",
  total_consumed: "0",
  customer_external_id: "cust-1",
  project_id: "proj-1",
  version: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("credits.grant", () => {
  it("POST /credits/grant with correct headers and body, returns transaction", async () => {
    let capturedAuth: string | null = null;
    let capturedBody: unknown;

    server.use(
      http.post(`${BASE}/credits/grant`, async ({ request }) => {
        capturedAuth = request.headers.get("Authorization");
        capturedBody = await request.json();
        return HttpResponse.json(TX_RESPONSE, { status: 201, headers: { "x-request-id": "req-abc" } });
      }),
    );

    const client = makeClient();
    const result = await client.credits.grant({ amount: 100, customer_external_id: "cust-1", metadata: {} });

    expect(capturedAuth).toBe(`Bearer ${API_KEY}`);
    expect((capturedBody as Record<string, unknown>).amount).toBe(100);
    expect(result.id).toBe("tx-1");
    expect(result.balance_after).toBe("100");
  });

  it("forwards idempotency key as Idempotency-Key header", async () => {
    let capturedIdempotency: string | null = null;

    server.use(
      http.post(`${BASE}/credits/grant`, ({ request }) => {
        capturedIdempotency = request.headers.get("Idempotency-Key");
        return HttpResponse.json(TX_RESPONSE, { status: 201 });
      }),
    );

    await makeClient().credits.grant({ amount: 50, customer_external_id: "c", metadata: {} }, { idempotencyKey: "my-key" });
    expect(capturedIdempotency).toBe("my-key");
  });

  it("throws AuthError on 401", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => HttpResponse.json({ detail: "Unauthorized" }, { status: 401 })));
    await expect(makeClient().credits.grant({ amount: 10, customer_external_id: "c", metadata: {} })).rejects.toBeInstanceOf(AuthError);
  });

  it("throws InsufficientCreditsError on 402", async () => {
    server.use(http.post(`${BASE}/credits/deduct`, () => HttpResponse.json({ detail: "Insufficient credits" }, { status: 402 })));
    await expect(makeClient().credits.deduct({ amount: 999, customer_external_id: "c", metadata: {} })).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
  });

  it("throws ValidationError on 422", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => HttpResponse.json({ detail: "invalid" }, { status: 422 })));
    await expect(makeClient().credits.grant({ amount: 0, customer_external_id: "c", metadata: {} })).rejects.toBeInstanceOf(ValidationError);
  });

  it("error carries requestId from X-Request-ID header", async () => {
    server.use(
      http.post(`${BASE}/credits/grant`, () =>
        HttpResponse.json({ detail: "err" }, { status: 401, headers: { "x-request-id": "req-xyz" } }),
      ),
    );
    const err = await makeClient()
      .credits.grant({ amount: 10, customer_external_id: "c", metadata: {} })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).requestId).toBe("req-xyz");
  });
});

describe("credits.deduct", () => {
  it("POST /credits/deduct returns transaction", async () => {
    const deductTx = { ...TX_RESPONSE, transaction_type: "deduct", amount: "50", balance_after: "50", balance_before: "100" };
    server.use(http.post(`${BASE}/credits/deduct`, () => HttpResponse.json(deductTx, { status: 201 })));

    const result = await makeClient().credits.deduct({ amount: 50, customer_external_id: "cust-1", metadata: {} });
    expect(result.transaction_type).toBe("deduct");
  });
});

describe("credits.balance", () => {
  it("GET /credits/:customerId/balance returns balance", async () => {
    server.use(http.get(`${BASE}/credits/cust-1/balance`, () => HttpResponse.json(BALANCE_RESPONSE)));

    const result = await makeClient().credits.balance("cust-1");
    expect(result.balance).toBe("100");
    expect(result.customer_external_id).toBe("cust-1");
  });

  it("encodes special characters in customerId", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/credits/cust%401/balance`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(BALANCE_RESPONSE);
      }),
    );
    await makeClient().credits.balance("cust@1");
    expect(capturedUrl).toContain("cust%401");
  });

  it("throws NotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/credits/unknown/balance`, () => HttpResponse.json({ detail: "not found" }, { status: 404 })));
    await expect(makeClient().credits.balance("unknown")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("credits.transactions", () => {
  it("GET /credits/:customerId/transactions returns list", async () => {
    server.use(http.get(`${BASE}/credits/cust-1/transactions`, () => HttpResponse.json([TX_RESPONSE])));

    const result = await makeClient().credits.transactions("cust-1");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("tx-1");
  });

  it("passes query params when provided", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/credits/cust-1/transactions`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([TX_RESPONSE]);
      }),
    );
    await makeClient().credits.transactions("cust-1", { page: 2, limit: 10 });
    const url = new URL(capturedUrl);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("10");
  });
});

describe("error mapping", () => {
  it.each([
    [429, RateLimitError],
    [500, ServerError],
    [503, ServerError],
  ])("maps status %d to correct error class", async (status, ErrorClass) => {
    const headers: Record<string, string> = { "x-request-id": "r" };
    if (status === 429) headers["Retry-After"] = "1";
    server.use(http.post(`${BASE}/credits/grant`, () => HttpResponse.json({ detail: "err" }, { status, headers })));
    await expect(makeClient().credits.grant({ amount: 1, customer_external_id: "c", metadata: {} })).rejects.toBeInstanceOf(ErrorClass);
  });

  it("RateLimitError exposes retryAfter", async () => {
    server.use(
      http.post(`${BASE}/credits/grant`, () =>
        HttpResponse.json({ detail: "rate limited" }, { status: 429, headers: { "Retry-After": "30", "x-request-id": "r" } }),
      ),
    );
    const err = await makeClient()
      .credits.grant({ amount: 1, customer_external_id: "c", metadata: {} })
      .catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(30);
  });
});
