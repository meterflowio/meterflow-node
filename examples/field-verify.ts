/**
 * MeterFlow Node.js SDK — Field verification harness
 *
 * The pre-publish verification list (PROJECT_STRUCTURE.md → "Verification before publishing either SDK"
 * + Next Steps #10), runnable against a real deployment — designed for the VPS field test where the
 * network is real, the rate limiter is live, and the data environment is selected by the key prefix.
 *
 * Use an `mf_test_*` key: every write lands in the isolated test environment, so a production
 * project can be verified without touching its live data.
 *
 * Sections (each prints PASS/FAIL/WARN; exit code 1 if anything FAILs):
 *   1 - Round-trip        grant → balance → deduct → usage event → batch → summary → transactions
 *   2 - Idempotent replay same Idempotency-Key returns the original transaction, balance unchanged
 *   3 - Error mapping     402 InsufficientCredits, 422 Validation, 404 NotFound, 401 Auth — each with a requestId
 *   4 - Plan reads        API-key-authenticated GET /plans
 *   5 - Latency report    per-call timings (min / median / p95 / max)
 *   6 - Rate limiter      (opt-in: FIELD_VERIFY_RATELIMIT=1) burst until 429, check Retry-After —
 *                         exhausts the key's bucket for up to 60 s, so it always runs last
 *
 * Run (from sdks/node):
 *   METERFLOW_API_KEY=mf_test_xxx METERFLOW_BASE_URL=https://api.meter-flow.com/api/v1 npx tsx examples/field-verify.ts
 *
 * Prerequisites: same as quickstart.ts (project + API key + a count meter named "api_call").
 */

// Self-referencing package import — resolved through package.json's `exports` map
// to the built dist files, exactly like a consumer's `import from "meterflow"`.
import { AuthError, InsufficientCreditsError, MeterFlow, MeterFlowError, NotFoundError, RateLimitError, ValidationError } from "meterflow";

const apiKey = process.env["METERFLOW_API_KEY"];
if (!apiKey) {
  console.error("Set METERFLOW_API_KEY before running this example.");
  process.exit(1);
}
const baseUrl = process.env["METERFLOW_BASE_URL"] ?? "http://localhost:8000/api/v1";
const client = new MeterFlow({ apiKey, baseUrl });

const runId = Date.now().toString(36);
const CUSTOMER_ID = `field-verify-${runId}`;

let failures = 0;
const timings: { label: string; ms: number }[] = [];

function report(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`   ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function warn(label: string, detail = "") {
  console.log(`   WARN ${label}${detail ? ` — ${detail}` : ""}`);
}

async function timed<T>(label: string, call: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await call();
  } finally {
    timings.push({ label, ms: performance.now() - startedAt });
  }
}

async function expectError<E extends MeterFlowError>(
  label: string,
  errorClass: new (...args: never[]) => E,
  call: () => Promise<unknown>,
): Promise<void> {
  try {
    await call();
    report(false, label, "no error was thrown");
  } catch (err) {
    if (err instanceof errorClass) {
      report(true, label, `${err.name} requestId=${err.requestId ?? "MISSING"}`);
      if (!err.requestId) warn(`${label}: X-Request-ID missing`, "support correlation broken");
    } else {
      report(false, label, `expected ${errorClass.name}, got ${err instanceof Error ? err.name + ": " + err.message : String(err)}`);
    }
  }
}

async function roundTrip() {
  console.log("\n1. Round-trip (grant → balance → deduct → usage → batch → summary → transactions)");

  const grant = await timed("credits.grant", () =>
    client.credits.grant({ amount: 500, customer_external_id: CUSTOMER_ID, metadata: { reason: "field-verify" } }, { idempotencyKey: `fv-grant-${runId}` }),
  );
  report(Number(grant.balance_after) === 500, "grant 500", `balance_after=${grant.balance_after}`);

  const balance = await timed("credits.balance", () => client.credits.balance(CUSTOMER_ID));
  report(Number(balance.balance) === 500, "balance reflects grant", `balance=${balance.balance}`);

  const deduct = await timed("credits.deduct", () =>
    client.credits.deduct({ amount: 100, customer_external_id: CUSTOMER_ID, description: "field-verify fee", metadata: {} }, { idempotencyKey: `fv-deduct-${runId}` }),
  );
  report(Number(deduct.balance_after) === 400, "deduct 100", `balance_after=${deduct.balance_after}`);

  const usageEvent = await timed("usage.record", () =>
    client.usage.record({ event_name: "api_call", customer_external_id: CUSTOMER_ID, value: 1, properties: { source: "field-verify" } }, { idempotencyKey: `fv-usage-${runId}` }),
  );
  report(Boolean(usageEvent.id), "usage event recorded", `id=${usageEvent.id}`);

  const batch = await timed("usage.recordBatch", () =>
    client.usage.recordBatch([
      { event_name: "api_call", customer_external_id: CUSTOMER_ID, value: 2, properties: {} },
      { event_name: "api_call", customer_external_id: CUSTOMER_ID, value: 3, properties: {} },
    ]),
  );
  report(batch.length === 2, "batch of 2 recorded", `ids=${batch.map((event) => event.id).join(",")}`);

  const summary = await timed("usage.summary", () => client.usage.summary(CUSTOMER_ID));
  const totalEvents = summary.meters.reduce((sum, meter) => sum + meter.event_count, 0);
  report(totalEvents === 3, "summary sees all 3 events", summary.meters.map((meter) => `${meter.meter_name}: value=${meter.value} events=${meter.event_count}`).join("; "));

  const transactions = await timed("credits.transactions", () => client.credits.transactions(CUSTOMER_ID));
  report(transactions.length >= 2, "transactions listed (grant + deduct)", `count=${transactions.length}`);
}

async function idempotentReplay() {
  console.log("\n2. Idempotent replay (same Idempotency-Key must not double-apply)");

  const replayGrant = await timed("credits.grant (replay)", () =>
    client.credits.grant({ amount: 500, customer_external_id: CUSTOMER_ID, metadata: { reason: "field-verify" } }, { idempotencyKey: `fv-grant-${runId}` }),
  );
  report(Number(replayGrant.balance_after) === 500, "grant replay returns original tx", `balance_after=${replayGrant.balance_after}`);

  const balance = await timed("credits.balance (post-replay)", () => client.credits.balance(CUSTOMER_ID));
  report(Number(balance.balance) === 400, "balance unchanged after replay", `balance=${balance.balance}`);
}

async function errorMapping() {
  console.log("\n3. Error mapping (typed errors + X-Request-ID)");

  await expectError("402 → InsufficientCreditsError", InsufficientCreditsError, () =>
    client.credits.deduct({ amount: 999999, customer_external_id: CUSTOMER_ID, description: "over-deduct", metadata: {} }),
  );

  await expectError("422 → ValidationError", ValidationError, () =>
    client.credits.grant({ amount: -5, customer_external_id: CUSTOMER_ID, metadata: {} }),
  );

  await expectError("404 → NotFoundError", NotFoundError, () => client.credits.balance(`no-such-customer-${runId}`));

  const badClient = new MeterFlow({ apiKey: "mf_test_invalid_key_field_verify", baseUrl });
  await expectError("401 → AuthError", AuthError, () => badClient.credits.balance(CUSTOMER_ID));
}

async function planReads() {
  console.log("\n4. Plan reads over API-key auth");
  const plans = await timed("plans.list", () => client.plans.list());
  report(Array.isArray(plans), "GET /plans", `count=${plans.length}`);
}

function latencyReport() {
  console.log("\n5. Latency report");
  const sorted = timings.map((timing) => timing.ms).sort((first, second) => first - second);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;
  for (const timing of timings) console.log(`   ${timing.ms.toFixed(0).padStart(6)} ms  ${timing.label}`);
  console.log(`   min=${sorted[0]?.toFixed(0)} ms  median=${median.toFixed(0)} ms  p95=${p95.toFixed(0)} ms  max=${sorted[sorted.length - 1]?.toFixed(0)} ms`);
}

async function rateLimiterProbe() {
  console.log("\n6. Rate-limiter probe (burst until 429 — exhausts this key's bucket for up to 60 s)");
  const probeClient = new MeterFlow({ apiKey: apiKey as string, baseUrl, retries: 0 });
  const maxAttempts = 400; // bucket is 300 req / 60 s
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await probeClient.credits.balance(CUSTOMER_ID);
    } catch (err) {
      if (err instanceof RateLimitError) {
        report(true, `429 after ${attempt} requests`, `retryAfter=${err.retryAfter ?? "MISSING"} requestId=${err.requestId ?? "MISSING"}`);
        if (err.retryAfter === undefined) warn("Retry-After missing on 429", "SDK cannot honour the server's wait hint");
        return;
      }
      report(false, "unexpected error during burst", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      return;
    }
  }
  report(false, `no 429 within ${maxAttempts} requests`, "rate limiter did not engage");
}

async function run() {
  console.log(`=== MeterFlow SDK field verification — ${baseUrl} (customer ${CUSTOMER_ID}) ===`);

  await roundTrip();
  await idempotentReplay();
  await errorMapping();
  await planReads();
  latencyReport();
  if (process.env["FIELD_VERIFY_RATELIMIT"] === "1") {
    await rateLimiterProbe();
  } else {
    console.log("\n6. Rate-limiter probe skipped (set FIELD_VERIFY_RATELIMIT=1 to run — it exhausts the key's bucket)");
  }

  console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
