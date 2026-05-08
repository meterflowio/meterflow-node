import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MeterFlow, MeterFlowError } from "../src/index";
import { AuthError } from "../src/errors";

const BASE = "https://api.meterflow.com/api/v1";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new MeterFlow({ apiKey: "mf_test_abc", retries: 0 });
}

const GRANT_BODY = { amount: 1, customer_external_id: "c", metadata: {} };

describe("error body parsing", () => {
  it("uses detail string when present", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => HttpResponse.json({ detail: "specific error" }, { status: 401 })));
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.message).toBe("specific error");
  });

  it("falls back to JSON.stringify when detail is not a string", async () => {
    server.use(
      http.post(`${BASE}/credits/grant`, () =>
        HttpResponse.json({ detail: [{ msg: "field required", loc: ["body"] }] }, { status: 401 }),
      ),
    );
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.message).toContain("field required");
  });

  it("falls back to statusText when body is not JSON", async () => {
    server.use(
      http.post(`${BASE}/credits/grant`, () =>
        new HttpResponse("Bad Request", { status: 400, headers: { "Content-Type": "text/plain" } }),
      ),
    );
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(MeterFlowError);
    expect(err.message).toBeTruthy();
  });

  it("maps unmapped 4xx status to generic MeterFlowError", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => HttpResponse.json({ detail: "teapot" }, { status: 418 })));
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(MeterFlowError);
    expect(err.statusCode).toBe(418);
    expect(err.retryable).toBe(false);
  });
});
