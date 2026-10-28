import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MeterFlow, type MeterFlowOptions } from "../../src/client";
import { AuthError, NotFoundError, RateLimitError, ServerError } from "../../src/errors";
import { MAX_CACHED_ENTITLEMENTS, maxAgeSeconds } from "../../src/utils/entitlement-cache";

const BASE = "https://api.meter-flow.com/api/v1";
const CHECK = `${BASE}/entitlements/cust_1/check`;
const LIST = `${BASE}/entitlements/cust_1`;
const CACHEABLE = { "Cache-Control": "private, max-age=15" };

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

const ALLOWED = { feature: "images.generated", feature_type: "metered", allowed: true, reason: null, remaining: "380" };
const DENIED = { ...ALLOWED, allowed: false, reason: "hard_limit_reached", remaining: "0" };
const LISTED = { customer_id: "cust_1", environment: "test", subscription_id: "sub-1", plan_id: "plan-1", plan_name: "Pro", period_end: null, entitlements: [ALLOWED] };

/**
 * A client with no retries, so a failure is final on its first answer.
 * options: anything to set beyond the key.
 */
function makeClient(options: Partial<MeterFlowOptions> = {}): MeterFlow {
  return new MeterFlow({ apiKey: "mf_test_abc", retries: 0, ...options });
}

/**
 * Answer `url` with `body` and `headers`, and count the requests it receives.
 * url: the route.
 * body: the JSON answered.
 * headers: the response headers.
 */
function answer(url: string, body: unknown, headers: Record<string, string> = CACHEABLE): { calls: number } {
  const seen = { calls: 0 };
  server.use(
    http.get(url, () => {
      seen.calls += 1;
      return HttpResponse.json(body, { headers });
    }),
  );
  return seen;
}

/**
 * Make `url` fail: a network error, or an error status with the API's error body.
 * url: the route.
 * status: the status, or "network" for a connection that never answers.
 */
function fail(url: string, status: number | "network"): void {
  server.use(
    http.get(url, () =>
      status === "network" ? HttpResponse.error() : HttpResponse.json({ error: { code: status, message: `failed with ${status}` } }, { status }),
    ),
  );
}

/** Freeze `Date` (and only it), so `max-age` can be stepped past without msw's own timers stopping. */
function freezeClock(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
}

describe("maxAgeSeconds", () => {
  it("reads max-age, and nothing from an absent, no-store or no-cache header", () => {
    expect(maxAgeSeconds("private, max-age=15")).toBe(15);
    expect(maxAgeSeconds(null)).toBe(0);
    expect(maxAgeSeconds("private")).toBe(0);
    expect(maxAgeSeconds("no-store, max-age=15")).toBe(0);
    expect(maxAgeSeconds("no-cache")).toBe(0);
  });
});

describe("the entitlements cache", () => {
  it("answers a second check inside max-age without a request", async () => {
    const seen = answer(CHECK, ALLOWED);
    const client = makeClient();
    await client.entitlements.check("cust_1", "images.generated");
    expect(await client.entitlements.check("cust_1", "images.generated")).toEqual(ALLOWED);
    expect(seen.calls).toBe(1);
  });

  it("asks again once max-age has passed", async () => {
    freezeClock();
    const seen = answer(CHECK, ALLOWED);
    const client = makeClient();
    await client.entitlements.check("cust_1", "images.generated");
    vi.setSystemTime(new Date("2026-10-28T12:00:16Z"));
    await client.entitlements.check("cust_1", "images.generated");
    expect(seen.calls).toBe(2);
  });

  it("takes its age from the header, never a number of its own", async () => {
    freezeClock();
    const seen = answer(CHECK, ALLOWED, { "Cache-Control": "private, max-age=60" });
    const client = makeClient();
    await client.entitlements.check("cust_1", "images.generated");
    vi.setSystemTime(new Date("2026-10-28T12:00:30Z"));
    await client.entitlements.check("cust_1", "images.generated");
    expect(seen.calls).toBe(1);
  });

  it("caches nothing when the response carries no Cache-Control", async () => {
    const seen = answer(CHECK, ALLOWED, {});
    const client = makeClient();
    await client.entitlements.check("cust_1", "images.generated");
    await client.entitlements.check("cust_1", "images.generated");
    expect(seen.calls).toBe(2);
  });

  it("caches a no as long as a yes", async () => {
    const seen = answer(CHECK, DENIED);
    const client = makeClient();
    await client.entitlements.check("cust_1", "images.generated");
    expect((await client.entitlements.check("cust_1", "images.generated")).allowed).toBe(false);
    expect(seen.calls).toBe(1);
  });

  it("keeps a feature, a quantity and a customer apart", async () => {
    const seen = answer(CHECK, ALLOWED);
    const other = answer(`${BASE}/entitlements/cust_2/check`, ALLOWED);
    const client = makeClient();
    await client.entitlements.check("cust_1", "images.generated");
    await client.entitlements.check("cust_1", "images.generated", { quantity: 5 });
    await client.entitlements.check("cust_1", "seats");
    await client.entitlements.check("cust_2", "images.generated");
    expect([seen.calls, other.calls]).toEqual([3, 1]);
  });

  it("caches get() on its own key", async () => {
    const seen = answer(LIST, LISTED);
    const client = makeClient();
    await client.entitlements.get("cust_1");
    expect(await client.entitlements.get("cust_1")).toEqual(LISTED);
    expect(seen.calls).toBe(1);
  });

  it("is off with entitlementsCache: false", async () => {
    const seen = answer(CHECK, ALLOWED);
    const client = makeClient({ entitlementsCache: false });
    await client.entitlements.check("cust_1", "images.generated");
    await client.entitlements.check("cust_1", "images.generated");
    expect(seen.calls).toBe(2);
    expect(client.entitlementCache).toBeNull();
  });

  it("keeps at most MAX_CACHED_ENTITLEMENTS answers, the least recently used going first", async () => {
    server.use(http.get(`${BASE}/entitlements/:customer/check`, () => HttpResponse.json(ALLOWED, { headers: CACHEABLE })));
    const client = makeClient();
    for (let index = 0; index <= MAX_CACHED_ENTITLEMENTS; index++) await client.entitlements.check(`cust_${index}`, "images.generated");
    const seen = answer(`${BASE}/entitlements/cust_0/check`, ALLOWED);
    await client.entitlements.check("cust_0", "images.generated");
    expect(seen.calls).toBe(1);
  });

  describe("goes stale after a write for the customer", () => {
    const writes: [string, string, (client: MeterFlow) => Promise<unknown>][] = [
      ["usage.record", `${BASE}/usage/events`, (client) => client.usage.record({ event_name: "images.generated", customer_external_id: "cust_1" })],
      ["usage.recordBatch", `${BASE}/usage/events/batch`, (client) => client.usage.recordBatch([{ event_name: "images.generated", customer_external_id: "cust_1" }])],
      ["credits.grant", `${BASE}/credits/grant`, (client) => client.credits.grant({ customer_external_id: "cust_1", amount: 10, metadata: {} })],
      ["credits.deduct", `${BASE}/credits/deduct`, (client) => client.credits.deduct({ customer_external_id: "cust_1", amount: 10, metadata: {} })],
      ["credits.reserve", `${BASE}/credits/reservations`, (client) => client.credits.reserve({ customer_external_id: "cust_1", amount: 10 })],
      ["credits.confirmReservation", `${BASE}/credits/reservations/res-1/confirm`, (client) => client.credits.confirmReservation("res-1")],
      ["credits.releaseReservation", `${BASE}/credits/reservations/res-1/release`, (client) => client.credits.releaseReservation("res-1")],
    ];
    for (const [name, url, write] of writes) {
      it(name, async () => {
        const seen = answer(CHECK, ALLOWED);
        const other = answer(`${BASE}/entitlements/cust_2/check`, ALLOWED);
        // Confirm and release learn the customer from the hold they answer with.
        server.use(http.post(url, () => HttpResponse.json({ customer_external_id: "cust_1" }, { status: 201 })));
        const client = makeClient();
        await client.entitlements.check("cust_1", "images.generated");
        await client.entitlements.check("cust_2", "images.generated");
        await write(client);
        await client.entitlements.check("cust_1", "images.generated");
        await client.entitlements.check("cust_2", "images.generated");
        expect([seen.calls, other.calls]).toEqual([2, 1]);
      });
    }

    it("but not after a write that failed", async () => {
      const seen = answer(CHECK, ALLOWED);
      server.use(http.post(`${BASE}/usage/events`, () => HttpResponse.json({ error: { code: 422, message: "bad" } }, { status: 422 })));
      const client = makeClient();
      await client.entitlements.check("cust_1", "images.generated");
      await expect(client.usage.record({ event_name: "images.generated", customer_external_id: "cust_1" })).rejects.toThrow();
      await client.entitlements.check("cust_1", "images.generated");
      expect(seen.calls).toBe(1);
    });
  });
});

describe("while MeterFlow is unreachable", () => {
  for (const [name, status, errorClass] of [
    ["a network error", "network", TypeError],
    ["a 503", 503, ServerError],
    ["a 429", 429, RateLimitError],
  ] as const) {
    it(`answers the last answer, marked stale, on ${name}, and tells onError`, async () => {
      freezeClock();
      const onError = vi.fn();
      answer(CHECK, ALLOWED);
      const client = makeClient({ onError });
      await client.entitlements.check("cust_1", "images.generated");
      vi.setSystemTime(new Date("2026-10-28T12:01:00Z"));
      fail(CHECK, status);

      expect(await client.entitlements.check("cust_1", "images.generated")).toEqual({ ...ALLOWED, stale: true });
      expect(onError).toHaveBeenCalledWith(expect.any(errorClass), { customerId: "cust_1", feature: "images.generated", fallback: "stale" });
    });
  }

  it("answers a stale answer after a write made it stale", async () => {
    answer(CHECK, ALLOWED);
    server.use(http.post(`${BASE}/usage/events`, () => HttpResponse.json({}, { status: 201 })));
    const client = makeClient();
    await client.entitlements.check("cust_1", "images.generated");
    await client.usage.record({ event_name: "images.generated", customer_external_id: "cust_1" });
    fail(CHECK, 503);
    expect((await client.entitlements.check("cust_1", "images.generated")).stale).toBe(true);
  });

  it("answers the feature's own default before the wildcard, as an offline default", async () => {
    const onError = vi.fn();
    fail(CHECK, 503);
    const client = makeClient({ entitlementDefaults: { "images.generated": "allow", "*": "deny" }, onError });

    expect(await client.entitlements.check("cust_1", "images.generated")).toEqual({
      feature: "images.generated",
      feature_type: null,
      allowed: true,
      reason: "offline_default",
    });
    expect(onError).toHaveBeenCalledWith(expect.any(ServerError), { customerId: "cust_1", feature: "images.generated", fallback: "default" });
  });

  it("answers the wildcard for a feature with no default of its own", async () => {
    fail(CHECK, "network");
    const client = makeClient({ entitlementDefaults: { "images.generated": "allow", "*": "deny" } });
    expect(await client.entitlements.check("cust_1", "seats")).toMatchObject({ feature: "seats", allowed: false, reason: "offline_default" });
  });

  it("throws as before with no default for the feature and no wildcard", async () => {
    const onError = vi.fn();
    fail(CHECK, 503);
    const client = makeClient({ entitlementDefaults: { seats: "allow" }, onError });
    await expect(client.entitlements.check("cust_1", "images.generated")).rejects.toBeInstanceOf(ServerError);
    expect(onError).not.toHaveBeenCalled();
  });

  it("gives get() the stale answer but never a default", async () => {
    answer(LIST, LISTED, {});
    const client = makeClient({ entitlementDefaults: { "*": "allow" } });
    fail(LIST, 503);
    await expect(client.entitlements.get("cust_1")).rejects.toBeInstanceOf(ServerError);

    answer(LIST, LISTED);
    await client.entitlements.get("cust_1");
    client.entitlementCache?.invalidate("cust_1");
    fail(LIST, 503);
    expect(await client.entitlements.get("cust_1")).toEqual({ ...LISTED, stale: true });
  });

  it("ignores what onError throws", async () => {
    fail(CHECK, 503);
    const client = makeClient({
      entitlementDefaults: { "*": "allow" },
      onError: () => {
        throw new Error("the hook broke");
      },
    });
    expect((await client.entitlements.check("cust_1", "images.generated")).allowed).toBe(true);
  });

  it("only falls back once the retries are spent", async () => {
    let calls = 0;
    server.use(
      http.get(CHECK, () => {
        calls += 1;
        return HttpResponse.json({ error: { code: 503, message: "down" } }, { status: 503 });
      }),
    );
    const client = new MeterFlow({ apiKey: "mf_test_abc", retries: 1, entitlementDefaults: { "*": "allow" } });
    expect((await client.entitlements.check("cust_1", "images.generated")).reason).toBe("offline_default");
    expect(calls).toBe(2);
  });
});

describe("an answer is never replaced by a fallback", () => {
  for (const [status, errorClass] of [
    [401, AuthError],
    [403, AuthError],
    [404, NotFoundError],
  ] as const) {
    it(`throws a ${status} even with a cached answer and a default`, async () => {
      const onError = vi.fn();
      answer(CHECK, ALLOWED);
      const client = makeClient({ entitlementDefaults: { "*": "allow" }, onError });
      await client.entitlements.check("cust_1", "images.generated");
      client.entitlementCache?.invalidate("cust_1");
      fail(CHECK, status);
      await expect(client.entitlements.check("cust_1", "images.generated")).rejects.toBeInstanceOf(errorClass);
      expect(onError).not.toHaveBeenCalled();
    });
  }
});
