import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MeterFlow, MeterFlowError, PayloadTooLargeError, ValidationError } from "../src/index";
import { AuthError } from "../src/errors";
import pkg from "../package.json";

const BASE = "https://api.meter-flow.com/api/v1";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new MeterFlow({ apiKey: "mf_test_abc", retries: 0 });
}

const GRANT_BODY = { amount: 1, customer_external_id: "c", metadata: {} };

// The shape the MeterFlow API actually emits (app/api/src/exceptions.py) — not FastAPI's
// default `{ detail }`. The fixtures used `{ detail }` for two releases, which is why every
// `err.message` reaching users was a stringified JSON blob and no test noticed.
const apiError = (code: number, message: string, extra: Record<string, unknown> = {}) => HttpResponse.json({ error: { code, message, ...extra } }, { status: code });

describe("error body parsing", () => {
  it("reads error.message — the shape the API really sends", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => apiError(401, "Invalid API key")));
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.message).toBe("Invalid API key");
  });

  it("surfaces a 422's per-field detail in both .message and .fields", async () => {
    server.use(
      http.post(`${BASE}/credits/grant`, () =>
        apiError(422, "Validation failed", {
          fields: [
            { field: "amount", message: "must be greater than 0" },
            { field: "customer_external_id", message: "must not be empty" },
          ],
        }),
      ),
    );
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe("Validation failed: amount: must be greater than 0; customer_external_id: must not be empty");
    expect(err.fields).toEqual([
      { field: "amount", message: "must be greater than 0" },
      { field: "customer_external_id", message: "must not be empty" },
    ]);
  });

  it("a 422 without fields still yields an empty .fields array, never undefined", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => apiError(422, "Validation failed")));
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fields).toEqual([]);
  });

  it("maps 413 to a non-retryable PayloadTooLargeError", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => apiError(413, "A batch may contain at most 500 events")));
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(PayloadTooLargeError);
    expect(err.message).toBe("A batch may contain at most 500 events");
    expect(err.retryable).toBe(false);
    expect(err.errorType).toBe("payload_too_large");
  });

  it("still accepts FastAPI's default { detail } as a fallback", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => HttpResponse.json({ detail: "specific error" }, { status: 401 })));
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.message).toBe("specific error");
  });

  it("falls back to JSON.stringify for an unrecognised body", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => HttpResponse.json({ detail: [{ msg: "field required", loc: ["body"] }] }, { status: 401 })));
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.message).toContain("field required");
  });

  it("falls back to statusText when body is not JSON", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => new HttpResponse("Bad Request", { status: 400, headers: { "Content-Type": "text/plain" } })));
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(MeterFlowError);
    expect(err.message).toBeTruthy();
  });

  it("maps unmapped 4xx status to generic MeterFlowError", async () => {
    server.use(http.post(`${BASE}/credits/grant`, () => apiError(418, "teapot")));
    const err = await makeClient().credits.grant(GRANT_BODY).catch((e) => e);
    expect(err).toBeInstanceOf(MeterFlowError);
    expect(err.statusCode).toBe(418);
    expect(err.retryable).toBe(false);
  });
});

describe("User-Agent", () => {
  it("reports the version from package.json, not a hand-maintained literal", async () => {
    let userAgent: string | null = null;
    server.use(
      http.post(`${BASE}/credits/grant`, ({ request }) => {
        userAgent = request.headers.get("User-Agent");
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    await makeClient().credits.grant(GRANT_BODY);
    expect(userAgent).toBe(`meterflow-node/${pkg.version}`);
  });
});
