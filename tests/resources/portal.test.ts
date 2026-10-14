import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MeterFlow } from "../../src/client";

const BASE = "https://api.meter-flow.com/api/v1";
const API_KEY = "mf_test_abc123";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const makeClient = () => new MeterFlow({ apiKey: API_KEY, retries: 0 });

const LINK = {
  url: "https://portal.meter-flow.test/?token=tok",
  token: "tok",
  expires_at: "2026-10-14T13:00:00Z",
  customer_external_id: "customer_123",
  environment: "live",
  return_url: null,
  topup_url: "https://acme.test/buy",
};

describe("portal.createSession", () => {
  it("POST /portal/sessions returns the link to send", async () => {
    server.use(http.post(`${BASE}/portal/sessions`, () => HttpResponse.json(LINK, { status: 201 })));

    const link = await makeClient().portal.createSession({ customer_external_id: "customer_123" });

    expect(link.url).toContain("token=");
    expect(link.customer_external_id).toBe("customer_123");
    expect(link.topup_url).toBe("https://acme.test/buy");
  });

  it("sends the customer, the links and the lifetime as the body", async () => {
    let captured: unknown;
    server.use(
      http.post(`${BASE}/portal/sessions`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(LINK, { status: 201 });
      }),
    );

    await makeClient().portal.createSession({
      customer_external_id: "customer_123",
      topup_url: "https://acme.test/buy",
      expires_in_minutes: 15,
    });

    expect(captured).toEqual({
      customer_external_id: "customer_123",
      topup_url: "https://acme.test/buy",
      expires_in_minutes: 15,
    });
  });
});
