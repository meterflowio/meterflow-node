# meterflow

[![npm version](https://img.shields.io/npm/v/meterflow)](https://www.npmjs.com/package/meterflow)
[![node](https://img.shields.io/node/v/meterflow)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/meterflow)](./LICENSE)

Official Node.js SDK for [MeterFlow](https://meter-flow.com) — usage-based billing, credit management, and metering.

Track what your customers use, enforce credit balances, and manage subscriptions with a few lines of code. TypeScript-first, zero runtime dependencies, built on native `fetch`.

---

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Authentication](#authentication)
- [Core concepts](#core-concepts)
- [Configuration](#configuration)
- [Usage guide](#usage-guide)
  - [Credits](#credits)
  - [Usage events](#usage-events)
  - [Subscriptions](#subscriptions)
  - [Plans](#plans)
- [Idempotency — safe retries for writes](#idempotency--safe-retries-for-writes)
- [Automatic retries](#automatic-retries)
- [Error handling](#error-handling)
- [Verifying webhooks](#verifying-webhooks)
- [Using the SDK in a browser](#using-the-sdk-in-a-browser)
- [TypeScript notes](#typescript-notes)
- [Versioning & support](#versioning--support)

---

## Requirements

- **Node.js ≥ 20** (the SDK uses the built-in `fetch` — no HTTP library is installed)
- An API key from your [MeterFlow dashboard](https://meter-flow.com) (Project → API Keys)

> Need Node 18? It reached end-of-life in April 2025 — please upgrade. The last SDK line supporting it is `meterflow@0.2.x`.

## Installation

```bash
npm install meterflow
```

Ships dual **CJS + ESM** with bundled TypeScript types — `require` and `import` both work out of the box.

## Quick start

```typescript
import { MeterFlow } from "meterflow";

const client = new MeterFlow({ apiKey: process.env.METERFLOW_API_KEY! });

// 1. Grant credits to a customer
await client.credits.grant({
  customer_external_id: "customer_123",
  amount: 5000,
  description: "Starter plan — monthly credit grant",
  metadata: {},
});

// 2. Report what happened, wherever your product does the billable thing
await client.usage.record({
  event_name: "images.generated",
  customer_external_id: "customer_123",
  value: 1,
  properties: {},
});

// 3. Check what they have left
const balance = await client.credits.balance("customer_123");
console.log(balance.balance); // "4999.000000"
```

That's the whole integration loop: grant → record → check. Everything else in this guide is detail.

## Authentication

Every request authenticates with the API key you pass to the constructor:

| Key prefix | Environment | Use for |
|---|---|---|
| `mf_live_…` | Live | Real customers, real balances |
| `mf_test_…` | Test | Development, CI, experiments |

The key's environment is a **real data boundary, not a label**: inside the same project, `mf_test_` keys read and write a fully separate dataset from `mf_live_` keys — subscriptions, credits, and usage events created with a test key are invisible to live keys (and vice versa), while your meters and plans are shared, so tests always run against your real billing configuration. The same customer id can hold an independent balance and subscription in each environment, and idempotency keys are namespaced per environment. Point your staging/CI at a test key and production at a live key — same project, zero risk of cross-contamination.

Keys are created in the dashboard (Project → API Keys) and **shown once** at creation — MeterFlow stores only a fingerprint. If a key leaks, revoke it in the dashboard and mint a new one; revocation is immediate.

A key belongs to **one project** and can only see that project's data.

```typescript
const client = new MeterFlow({ apiKey: "mf_test_..." }); // throws immediately if the prefix is neither mf_live_ nor mf_test_
```

> Treat API keys like passwords: read them from environment variables or a secret manager, never commit them.

## Core concepts

Four words explain the whole product:

| Concept | What it is | Example |
|---|---|---|
| **Meter** | One countable thing, identified by its `event_name` | `images.generated`, `minutes.transcribed` |
| **Plan** | What you sell: price, billing period, and how much of each meter is included | Starter — $29/month, 5,000 images |
| **Subscription** | One customer on one plan from a date; renews itself | `customer_123` → Starter |
| **Credits** | The customer's balance — granted up, spent down, never edited in place | `+5000` granted, `−1340` consumed |

Meters and plans are defined in the dashboard. Your app, through this SDK, does the day-to-day work: creates subscriptions, grants/deducts credits, and records usage events (each event lands on the meter whose `event_name` matches).

## Configuration

```typescript
const client = new MeterFlow({
  apiKey: "mf_live_...",                        // required — mf_live_* or mf_test_*
  baseUrl: "https://api.meter-flow.com/api/v1",  // optional — override for self-hosted / local dev
  timeout: 30_000,                              // optional — per-request timeout in ms (default 30 s)
  retries: 3,                                   // optional — automatic retries (default 3, 0 disables)
  fetch: customFetch,                           // optional — inject your own fetch (tests, proxies)
});
```

`baseUrl` is for pointing at a **different MeterFlow server** — a self-hosted deployment, or a locally running stack if you develop MeterFlow itself (`baseUrl: "http://localhost:8000/api/v1"`). If you use the hosted service, leave it at the default; to test your integration safely, use an `mf_test_` key instead (see [Authentication](#authentication)) — no URL change needed.

All configuration lives on the client instance — there is no global state, so you can create multiple clients (e.g. one per project) in the same process.

## Usage guide

### Credits

Credits are an append-only ledger: every grant and deduction is a permanent transaction, and the balance is the sum. Nothing is ever edited in place — which is why a customer's history is always auditable.

**Grant** — add credits (plan renewals, top-ups, goodwill):

```typescript
const txn = await client.credits.grant({
  customer_external_id: "customer_123",
  amount: 5000,
  description: "Monthly plan grant",
  metadata: {},
});
console.log(txn.balance_after); // "5000.000000"
```

**Deduct** — remove credits. Throws `InsufficientCreditsError` (HTTP 402) if the balance can't cover it — the customer is never taken below zero:

```typescript
import { InsufficientCreditsError } from "meterflow";

try {
  await client.credits.deduct({
    customer_external_id: "customer_123",
    amount: 25,
    description: "images.generated ×25",
    metadata: {},
  });
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    // Show your "out of credits — top up" screen. This is an upgrade prompt, not an error page.
  } else {
    throw err;
  }
}
```

**Balance** — the current position:

```typescript
const bal = await client.credits.balance("customer_123");
bal.balance;        // "3545.000000"  ← decimal string, see note below
bal.total_granted;  // "5250.000000"
bal.total_consumed; // "1705.000000"
```

**Transactions** — the full history, newest first, paginated:

```typescript
const txns = await client.credits.transactions("customer_123", { page: 1, limit: 50 });
for (const t of txns) {
  console.log(t.transaction_type, t.amount, t.balance_after, t.description, t.created_at);
}
```

> **Amounts are decimal strings.** Balances and amounts come back as strings (`"3545.000000"`) to avoid floating-point drift on money-like values. Parse deliberately (`Number(...)` or a decimal library) when you need arithmetic.

### Usage events

Record an event every time a customer does the thing you charge for. Events are matched to a meter by `event_name` and processed asynchronously into totals (and, if the meter is metered on a plan, into credit deductions).

**Record one event:**

```typescript
await client.usage.record({
  event_name: "images.generated",
  customer_external_id: "customer_123",
  value: 1,                                  // what the meter aggregates: 1 for counts, seconds/MB/etc. for sums
  properties: {},                            // free-form context; {} when unused
  timestamp: new Date().toISOString(),       // optional — defaults to arrival time on the server
});
```

**Record a batch** — for high-throughput paths, flush events in groups instead of one request each:

```typescript
await client.usage.recordBatch([
  { event_name: "images.generated", customer_external_id: "customer_123", value: 1, properties: {} },
  { event_name: "video.seconds_rendered", customer_external_id: "customer_123", value: 42, properties: {} },
]);
```

**Summary** — a customer's usage, broken down by meter:

```typescript
const summary = await client.usage.summary("customer_123", {
  // meter_id: "…",                // optional — narrow to one meter
  from_: "2026-09-01T00:00:00Z",   // optional — note the trailing underscore
  to: "2026-09-30T23:59:59Z",      // optional
});
for (const m of summary.meters) {
  console.log(m); // per-meter aggregation and event counts
}
```

> The `from_` filter has a trailing underscore — it mirrors the API's query parameter exactly.

Recording an event returns immediately (`processed: false`); totals and any credit deductions materialise moments later. Don't read a balance in the same millisecond and expect the event to be reflected.

### Subscriptions

A subscription puts one customer on one plan and renews itself. Typically your app creates it in the signup flow:

```typescript
// Pick a plan (defined in the dashboard)…
const plans = await client.plans.list();
const starter = plans.find((p) => p.slug === "starter")!;

// …and put the new customer on it
const sub = await client.subscriptions.create({
  plan_id: starter.id,
  customer_external_id: "customer_123",
  metadata: {},
});
console.log(sub.status); // "trialing" if the plan has trial days, else "active"
```

**List / get:**

```typescript
const all = await client.subscriptions.list();                                // whole project (in your key's environment)
const theirs = await client.subscriptions.list({ customer_id: "customer_123" }); // one customer
const one = await client.subscriptions.get(sub.id);
```

> Like all reads, these are scoped to the key's environment: a live key lists live subscriptions only, a test key test ones only.

**Update** — change status or metadata. Statuses: `active`, `trialing`, `past_due`, `paused`, `canceled`, `expired`:

```typescript
await client.subscriptions.update(sub.id, { status: "paused" });
await client.subscriptions.update(sub.id, { status: "active" }); // reactivate
```

**Cancel vs delete** — two different operations:

```typescript
await client.subscriptions.update(sub.id, { status: "canceled" }); // cancel: the record stays for history
await client.subscriptions.delete(sub.id);                          // delete: removes the subscription record entirely
```

Prefer cancelling: it preserves the subscription's history (a canceled subscription can't be reactivated). Reach for `delete` only when you truly want the record gone — e.g. cleaning up test data.

### Plans

Plans are **read-only** through the SDK — pricing is managed by humans in the dashboard, so a leaked API key can never rewrite your prices.

```typescript
const plans = await client.plans.list();       // the project's plans
const plan = await client.plans.get(plan_id);  // one plan, including its per-meter limits
plan.price;         // "29.00" — decimal string
plan.billing_period; // "monthly" | "yearly" | "weekly" | "one_time"
plan.meter_limits;   // included units + overage rate per meter
```

Typical use: render your pricing page or signup flow from `plans.list()` so it can never drift from what billing actually enforces.

## Idempotency — safe retries for writes

Connections drop. When your app can't tell whether a write arrived, the correct move is to send it again **with the same idempotency key** — MeterFlow recognises the key and acts only once:

```typescript
await client.credits.deduct(
  { customer_external_id: "customer_123", amount: 1, description: "ticket A7", metadata: {} },
  { idempotencyKey: "deduct-ticket-A7" }, // forwarded as the Idempotency-Key header
);
// Sending this twice deducts exactly once and returns the same transaction both times.
```

Every write method accepts the option: `credits.grant/deduct`, `usage.record/recordBatch`, `subscriptions.create/update`. Use a key that identifies the *business operation* (order ID, job ID) — not a random value per attempt, which would defeat the purpose.

## Automatic retries

The SDK retries transient failures for you — exponential backoff with jitter, 3 attempts by default:

| Situation | Behaviour |
|---|---|
| Network error / connection dropped | Retried |
| `5xx` server errors | Retried |
| `429 Too Many Requests` | Waits for the server's `Retry-After`, then retries |
| Any other `4xx` (auth, validation, not-found, insufficient credits…) | **Never retried** — it would fail identically |

Configure with `retries` in the constructor (`0` disables). Combine retries with idempotency keys on writes and a flaky network costs you nothing: the SDK re-sends, the server deduplicates.

## Error handling

Every non-2xx response is thrown as a typed error. All of them extend `MeterFlowError`:

| Class | HTTP | `errorType` | Retried by the SDK |
|---|---|---|---|
| `AuthError` | 401 / 403 | `auth_error` | no |
| `InsufficientCreditsError` | 402 | `insufficient_credits` | no |
| `NotFoundError` | 404 | `not_found` | no |
| `ConflictError` | 409 | `conflict` | no |
| `ValidationError` | 422 | `validation_error` | no |
| `RateLimitError` | 429 | `rate_limit` | yes (honours `Retry-After`, exposed as `.retryAfter`) |
| `ServerError` | 5xx | `server_error` | yes |

Every error carries:

- **`requestId`** — the API's `X-Request-ID` for that call. Include it when contacting support; it pinpoints the exact request in our logs.
- **`statusCode`**, **`errorType`**, and **`retryable`** — for programmatic handling and structured logging.

```typescript
import { MeterFlowError, InsufficientCreditsError, RateLimitError } from "meterflow";

try {
  await client.credits.deduct({ customer_external_id: "c1", amount: 999, metadata: {} });
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    // expected business outcome — prompt a top-up
  } else if (err instanceof RateLimitError) {
    console.warn(`rate limited; server asked to wait ${err.retryAfter}s`); // only seen if retries are exhausted/disabled
  } else if (err instanceof MeterFlowError) {
    console.error(`MeterFlow error [${err.errorType}] status=${err.statusCode} requestId=${err.requestId}`);
    throw err;
  } else {
    throw err; // not from MeterFlow
  }
}
```

## Verifying webhooks

MeterFlow notifies your app of events you'd otherwise poll for (low balances, renewals, …). Every delivery is signed with **HMAC-SHA256** in the `X-MeterFlow-Signature` header, using the webhook's secret — verify before trusting:

```typescript
import express from "express";
import { verifyWebhook } from "meterflow/webhook"; // note: separate entry point

const app = express();

// The signature covers the RAW body — capture it before any JSON parsing.
app.post("/meterflow-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.header("X-MeterFlow-Signature") ?? "";

  if (!verifyWebhook(req.body, signature, process.env.METERFLOW_WEBHOOK_SECRET!)) {
    return res.status(401).send("invalid signature"); // forged or corrupted — discard
  }

  const event = JSON.parse(req.body.toString("utf8"));
  // handle the event…
  res.sendStatus(200);
});
```

Details that matter:

- **Import from `meterflow/webhook`**, not the root package. The verifier uses Node's `crypto` and lives in its own entry point so the main client stays browser-safe.
- **Verify the raw bytes.** If you `JSON.parse` first and re-stringify, key ordering/whitespace changes and the signature won't match. `express.json()` users: configure it with a `verify` callback to keep `rawBody`, or use `express.raw` on the webhook route as above.
- The comparison is **timing-safe** (`crypto.timingSafeEqual`) and returns `false` on any mismatch — it never throws on bad input.

Webhooks are registered per-project in the dashboard, which is also where you'll find the secret and each delivery attempt's status.

## Using the SDK in a browser

The root entry point is browser-safe: no Node built-ins, and `fetch` is bound correctly for browser environments. Two rules:

1. **Never ship an `mf_live_` key to a browser.** Anyone can read it in DevTools. Browser usage is for trusted, short-lived contexts (internal tools, dashboards) with `mf_test_` or ephemeral keys — your product's customers should always go through **your** backend, which holds the key. (A leaked `mf_test_` key is contained by design: it can only ever touch the sandboxed test dataset, never live balances.)
2. **Don't import `meterflow/webhook` in browser code** — it needs Node's `crypto` (and verifying webhooks in a browser makes no sense anyway: the secret must stay server-side).

## TypeScript notes

- All request/response types are **generated from MeterFlow's OpenAPI contract**, so anything the API accepts or returns is statically typed — your editor autocompletes every field above.
- Request fields are `snake_case`, matching the HTTP API one-to-one (`customer_external_id`, not `customerExternalId`). What you see in the docs and dashboard is exactly what you type.
- `properties` (usage events) and `metadata` (credits/subscriptions) are required by the generated types — pass `{}` when you have nothing to attach.
- Public exports: `MeterFlow` and the error classes from `"meterflow"`; `verifyWebhook` from `"meterflow/webhook"`. Response types are inferred from method return values.

## Versioning & support

- Semantic versioning on the `0.x` line: breaking changes bump the minor, fixes bump the patch.
- `0.4.0` changed the default API base URL to **`https://api.meter-flow.com/api/v1`** (the platform's domain). If you set `baseUrl` explicitly, nothing changes for you.
- `0.3.0` raised the Node floor to **≥ 20** (Node 18 is end-of-life). `0.2.x` remains available for Node 18.
- Tested in CI on Node **20, 22 and 24**.
- Issues and source: [github.com/meterflowio/meterflow-node](https://github.com/meterflowio/meterflow-node). Include the `requestId` from any `MeterFlowError` when reporting API issues.

## License

MIT

## The full loop, end to end

```typescript
import { MeterFlow } from "meterflow";

const client = new MeterFlow({ apiKey: process.env.METERFLOW_API_KEY! });

// Signup: put the customer on a plan and give them their credits
const [starter] = await client.plans.list();
await client.subscriptions.create({ plan_id: starter.id, customer_external_id: "ana", metadata: {} });
await client.credits.grant(
  { customer_external_id: "ana", amount: 5000, description: "Starter grant", metadata: {} },
  { idempotencyKey: "signup-ana-2026-09" },
);

// Every time Ana uses the product
await client.usage.record({
  event_name: "images.generated",
  customer_external_id: "ana",
  value: 1,
  properties: { model: "sdxl", resolution: "1024x1024" },
});

// Support asks: "what's Ana's situation?"
const balance = await client.credits.balance("ana");
const history = await client.credits.transactions("ana", { limit: 20 });
const usage = await client.usage.summary("ana");
```
