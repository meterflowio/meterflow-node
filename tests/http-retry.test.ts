import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MeterFlow } from "../src/client";
import { AuthError, RateLimitError, ServerError, ValidationError } from "../src/errors";

const BASE = "https://api.meterflow.com/api/v1";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const GRANT_BODY = { amount: 10, customer_external_id: "c", metadata: {} };

const TX = {
  id: "tx-1",
  amount: "10",
  balance_before: "0",
  balance_after: "10",
  transaction_type: "grant",
  customer_external_id: "c",
  project_id: "p",
  description: null,
  idempotency_key: null,
  metadata_: {},
  created_at: "2026-01-01T00:00:00Z",
};

describe("retry on 5xx", () => {
  it("succeeds on 2nd attempt after 503", { timeout: 8000 }, async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/credits/grant`, () => {
        calls++;
        if (calls === 1) return HttpResponse.json({ detail: "down" }, { status: 503 });
        return HttpResponse.json(TX, { status: 201 });
      }),
    );

    // retries=1 → one retry delay (~750ms-1250ms with jitter) then success
    const client = new MeterFlow({ apiKey: "mf_test_abc", retries: 1 });
    const result = await client.credits.grant(GRANT_BODY);
    expect(result.id).toBe("tx-1");
    expect(calls).toBe(2);
  });

  it("throws ServerError after exhausting all retries", { timeout: 8000 }, async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/credits/grant`, () => {
        calls++;
        return HttpResponse.json({ detail: "down" }, { status: 500 });
      }),
    );

    // retries=1 → 2 total calls, one retry delay
    const client = new MeterFlow({ apiKey: "mf_test_abc", retries: 1 });
    await expect(client.credits.grant(GRANT_BODY)).rejects.toBeInstanceOf(ServerError);
    expect(calls).toBe(2);
  });
});

describe("no retry on 4xx", () => {
  it("does not retry on 422 (ValidationError)", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/credits/grant`, () => {
        calls++;
        return HttpResponse.json({ detail: "bad input" }, { status: 422 });
      }),
    );

    const client = new MeterFlow({ apiKey: "mf_test_abc", retries: 3 });
    await expect(client.credits.grant(GRANT_BODY)).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toBe(1);
  });

  it("does not retry on 401 (AuthError)", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/credits/grant`, () => {
        calls++;
        return HttpResponse.json({ detail: "unauthorized" }, { status: 401 });
      }),
    );

    const client = new MeterFlow({ apiKey: "mf_test_abc", retries: 3 });
    await expect(client.credits.grant(GRANT_BODY)).rejects.toBeInstanceOf(AuthError);
    expect(calls).toBe(1);
  });
});

describe("429 honours Retry-After", () => {
  it("retries after Retry-After=1 and succeeds", { timeout: 8000 }, async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/credits/grant`, () => {
        calls++;
        if (calls === 1) {
          return HttpResponse.json({ detail: "rate limited" }, { status: 429, headers: { "Retry-After": "1", "x-request-id": "r" } });
        }
        return HttpResponse.json(TX, { status: 201 });
      }),
    );

    const client = new MeterFlow({ apiKey: "mf_test_abc", retries: 3 });
    const result = await client.credits.grant(GRANT_BODY);
    expect(result.id).toBe("tx-1");
    expect(calls).toBe(2);
  });

  it("exposes retryAfter on the thrown RateLimitError when retries=0", async () => {
    server.use(
      http.post(`${BASE}/credits/grant`, () =>
        HttpResponse.json({ detail: "rate limited" }, { status: 429, headers: { "Retry-After": "60", "x-request-id": "r" } }),
      ),
    );

    const client = new MeterFlow({ apiKey: "mf_test_abc", retries: 0 });
    const err = await client.credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(60);
  });
});

describe("retry on network error", () => {
  it("retries on fetch network failure and recovers", { timeout: 8000 }, async () => {
    let calls = 0;
    const customFetch: typeof fetch = async (input, init) => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return globalThis.fetch(input, init);
    };

    server.use(http.post(`${BASE}/credits/grant`, () => HttpResponse.json(TX, { status: 201 })));

    const client = new MeterFlow({ apiKey: "mf_test_abc", retries: 3, fetch: customFetch });
    const result = await client.credits.grant(GRANT_BODY);
    expect(result.id).toBe("tx-1");
    expect(calls).toBe(2);
  });
});
