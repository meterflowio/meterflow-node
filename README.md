# meterflow

[![npm version](https://img.shields.io/npm/v/meterflow)](https://www.npmjs.com/package/meterflow)
[![node](https://img.shields.io/node/v/meterflow)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/meterflow)](./LICENSE)

Official Node.js SDK for [MeterFlow](https://meter-flow.com) — usage-based billing, credit management, and metering.

Track what your customers use, enforce credit balances, and manage subscriptions with a few lines of code. TypeScript-first, zero runtime dependencies, built on native `fetch`.

- **Flat $29, never a percentage of your revenue.** MeterFlow's [plans](https://meter-flow.com/pricing) follow how many usage events you send, not what your customers pay you.
- **Works next to any payment provider.** MeterFlow never moves money: your provider charges your customers, and this SDK records their usage, keeps their credit balances and asks whether they may go on. Paddle, Polar, Lemon Squeezy, Chargebee and Razorpay connect from the dashboard; anything else calls `credits.grant` when a payment lands.
- **Test and live by key prefix.** An `mf_test_` key reads and writes test data, an `mf_live_` key live data — the same code, two worlds that never mix.

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
  - [Holding credits for a long job](#holding-credits-for-a-long-job)
  - [Usage events](#usage-events)
  - [Subscriptions](#subscriptions)
  - [Plans](#plans)
  - [Webhook receipts](#webhook-receipts)
  - [Entitlements — ask before you act](#entitlements--ask-before-you-act)
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
  entitlementsCache: true,                      // optional — reuse entitlement answers for their max-age (default on)
  entitlementDefaults: { "*": "deny" },         // optional — what check() answers while MeterFlow is unreachable
  onError: (error, context) => {},              // optional — told when an entitlements call answers from a fallback
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

**Deduct** — remove credits. Throws `InsufficientCreditsError` (HTTP 402) if the available credits can't cover it (the balance less what [holds](#holding-credits-for-a-long-job) keep) — the customer is never taken below zero:

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
bal.reserved;       // "200.000000"   ← held by reservations, still in balance
bal.available;      // "3345.000000"  ← balance − reserved: what can be spent now
bal.usage_draws_credits; // true | false | null
```

`usage_draws_credits` says whether the customer's plan charges usage to this balance: `true` when a metered limit carries a rate, `false` when the plan never does (the balance then moves only through your own `credits.deduct`), `null` without an active or trialing subscription.

**Transactions** — the customer's history, newest first, **a page at a time**:

```typescript
const page = await client.credits.transactions("customer_123");          // 50 rows by default
for (const t of page.data) {
  console.log(t.transaction_type, t.amount, t.balance_after, t.description, t.created_at);
}

// The whole history, page by page. `next_cursor` is null once there is nothing after it.
let cursor: string | undefined;
do {
  const page = await client.credits.transactions("customer_123", { limit: 200, cursor });
  handle(page.data);
  cursor = page.next_cursor ?? undefined;
} while (cursor);
```

> **The cursor is opaque.** Pass back exactly what `next_cursor` gave you; do not build one, and do
> not read anything out of it. `limit` is 1–200 and defaults to 50.

> **Amounts are decimal strings.** Balances and amounts come back as strings (`"3545.000000"`) to avoid floating-point drift on money-like values. Parse deliberately (`Number(...)` or a decimal library) when you need arithmetic.

### Holding credits for a long job

A job that runs for minutes — a render, an agent run — should not find, at the end, that other spending took the credits it was counting on. **Reserve** them first: the balance stays where it is, but `available` drops, and every other spend (`credits.deduct()`, usage charged by a metered plan, a `check()` that would charge, another hold) is measured against `available`.

```typescript
const hold = await client.credits.reserve(
  { customer_external_id: "customer_123", amount: 200, ttl_seconds: 600, description: "render #42" },
  { idempotencyKey: "render-42" },
);

try {
  const used = await render();                                              // the long job
  await client.credits.confirmReservation(hold.id, { amount: used.credits }); // take what it used; the rest is freed
} catch (err) {
  await client.credits.releaseReservation(hold.id);                         // nothing taken
  throw err;
}
```

- **Reserve** throws `InsufficientCreditsError` (402) when `available` cannot cover the amount, and `ConflictError` (409) when held credits would pass the subscription's spend cap: a hold counts against the cap as it will when confirmed. `ttl_seconds` defaults to 300 and is at most 86,400 (a day).
- **Confirm** writes one ordinary `deduct` to the ledger, with your hold's description and `metadata.reservation_id`, and fires the same webhooks a deduct does. Leave out `amount` to take the whole hold; more than the hold is a `ValidationError` (422). Whatever it does not take is freed.
- **Release** frees the hold with nothing taken. A hold left alone expires at `expires_at` and frees itself: `reservation(id)` then answers `status: "expired"`, a confirm throws `ConflictError` (409), and a release answers it as expired.
- Confirming or releasing a hold that is already confirmed or released throws `ConflictError` (409). If a retry of a confirm meets a 409, `client.credits.reservation(hold.id)` tells you whether the first attempt landed.

### Usage events

Record an event every time a customer does the thing you charge for. Events are matched to a meter by `event_name` and processed asynchronously into totals (and, if the meter is metered on a plan, into credit deductions).

**Record one event:**

```typescript
await client.usage.record({
  event_name: "images.generated",
  customer_external_id: "customer_123",
  value: 1,                                  // optional — what the meter aggregates: 1 for counts, seconds/MB/etc. for sums
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

A batch holds at most **500 events** (exported as `MAX_BATCH_EVENTS`). A larger array is rejected locally with `PayloadTooLargeError` before anything is sent — the SDK deliberately does **not** split it for you, because one call is one request with one idempotency key, and turning it into several would make a partial failure indistinguishable from success. Chunk at the call site and give each chunk its own key:

```typescript
import { MAX_BATCH_EVENTS } from "meterflow";

for (let i = 0; i < events.length; i += MAX_BATCH_EVENTS) {
  const chunk = events.slice(i, i + MAX_BATCH_EVENTS);
  await client.usage.recordBatch(chunk, { idempotencyKey: `job-42:chunk-${i / MAX_BATCH_EVENTS}` });
}
```

### Record quantities, not calls

**A batch of 100 events is still 100 events.** Batching saves HTTP requests, not quota: each item in a `recordBatch` is its own record, and your plan's monthly allowance counts records. The thing that actually moves the number is sending **one event that carries the quantity**.

If your meter's aggregation is `sum`, MeterFlow adds up the `value` of its events — so one event with `value: 100` is **one** event against your monthly allowance and **100 units** against the meter. Record per unit of work instead of per API call:

```typescript
// ❌ One event per call — 100 calls is 100 events against your plan.
for (const chunk of completion.chunks) {
  await client.usage.record({
    event_name: "tokens.used",
    customer_external_id: "customer_123",
    value: 1,
    properties: {},
  });
}

// ✅ One event carrying the quantity — 1 event against your plan, 1,300 units on the meter.
await client.usage.record({
  event_name: "tokens.used",
  customer_external_id: "customer_123",
  value: 1300,                 // a `sum` meter adds these up
  properties: { model: "gpt-4o-mini" },
});
```

This is usually the difference between fitting a plan and outgrowing it: 1,000 users × 100 calls a day is ~3M events a month recorded per call, and ~30k recorded per session. Aggregate in your app over whatever window you can afford to lose on a crash — a request, a job, a minute — then send one event.

Two things to keep in mind:

- **It only helps a `sum` meter.** A `count` meter ignores `value` and counts occurrences, so there each occurrence has to be its own event. `max` and `min` read `value` as a measurement, not a quantity to add, and `unique_count` does not read it at all — it counts distinct values of the property its meter names.
- **`value` is optional.** Leave it out and MeterFlow fills it in: for a `sum`, `max` or `min` meter that names an `aggregation_field`, the numeric value of that property on the event; otherwise `1`. So the event above can be written `properties: { tokens: 1300 }` with no `value`, as long as the meter's `aggregation_field` is `tokens`. An explicit `value` always wins, a property that is absent or is not a number falls through to `1`, and a negative one is refused with a `422`.
- **Billing is unchanged.** A metered plan limit charges per unit — the event's `value` — so 100 units cost the same whether they arrived as 100 events or one. You are not rounding anyone's bill by batching.

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
const page = await client.subscriptions.list();                                 // whole project (in your key's environment)
const theirs = await client.subscriptions.list({ customer_id: "customer_123" }); // one customer
const more = await client.subscriptions.list({ limit: 200, cursor: page.next_cursor ?? undefined });
const behind = await client.subscriptions.list({ q: "acme", status: ["past_due", "paused"] }); // ids containing "acme", in either status
const one = await client.subscriptions.get(sub.id);

page.data.forEach((subscription) => console.log(subscription.customer_external_id, subscription.status));
```

> **`list()` answers a page**, `{ data, next_cursor }` — `get()` still answers one subscription.

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

### Webhook receipts

Webhooks are **read-only** through the SDK too: endpoints are registered in the dashboard, where the signing secret is shown once and never again. What the SDK gives you is the other half — which endpoints exist, and what MeterFlow actually sent them.

```typescript
const endpoints = await client.webhooks.list();                   // this project's endpoints
const receipts = await client.webhooks.deliveries(endpoint_id);   // newest first
receipts[0].event_type;    // "usage.recorded"
receipts[0].status;        // "pending" | "retrying" | "success" | "failed"
receipts[0].response_code; // what your server answered — 200, 500, or null if it never answered
receipts[0].attempts;      // how many times we have tried
receipts[0].payload;       // exactly what we sent

const page = await client.webhooks.deliveryPage(endpoint_id, { limit: 200 });          // the same rows, a page at a time
const older = await client.webhooks.deliveryPage(endpoint_id, { cursor: page.next_cursor }); // null on the last page
```

A delivery is tried up to five times: at once, then after 30 s, 5 min, 30 min and 2 h, each later try scheduled through the queue, where it survives a worker restart. `attempts` counts the tries; the receipt shows `pending` before the first try and `retrying` between tries.

Typical use: answering "did that event reach my endpoint?" from your own tooling instead of opening the dashboard — and reading `response_body` when the answer is no.

Two things to know. `deliveries()` returns the **most recent 100** attempts per endpoint; `deliveryPage()` reads further back, one page at a time. And both follow your key: a `mf_test_*` key reads test receipts, a `mf_live_*` key live ones, while the endpoint list itself is shared by both worlds, because an endpoint is configuration and receives events from each.

> This is not the same as [verifying webhooks](#verifying-webhooks) below. That proves a request your server just received really came from us; this reads what we sent.

### Entitlements — ask before you act

The one call to make **before** doing work for a customer: "may they use this feature — and how much is left?" A **hard** limit says no here; recording usage afterwards never blocks, so an app that skips this call gets an honest ledger but no enforcement.

```typescript
const gate = await client.entitlements.check("customer_123", "images.generated");

if (!gate.allowed) {
  // gate.reason: "hard_limit_reached" | "no_subscription" | "not_in_plan" | "insufficient_credits" | "spend_cap_reached"
  return showUpgradePrompt(gate); // gate.used / gate.included / gate.period_end are there for the copy
}

await generateImage();
await client.usage.record({ event_name: "images.generated", customer_external_id: "customer_123", value: 1, properties: {} });
```

- `feature` is a meter's `event_name` (metered — `included`, `used`, `remaining` filled in) or a plan feature key like `"sso"` (boolean).
- `{ quantity: 5 }` asks "may they do **5** more?" — one call instead of one per item for batch work.
- A **soft** limit answers `allowed: true` with `reason: "soft_limit_exceeded"` — let it through, nudge the upgrade.
- A **metered** limit stays allowed while the customer's credits cover the overage; otherwise `insufficient_credits`.
- `allowed: false` is a normal resolved answer, never an exception. A feature key the project does not know at all is a `NotFoundError` — that is a typo, not a plan.
- The SDK reuses an answer for the `Cache-Control: max-age` it came with (15 s today), per customer, feature and `quantity` — `allowed: false` included. See [When MeterFlow can't be reached](#when-meterflow-cant-be-reached).

**All of them at once** — for a settings or pricing screen:

```typescript
const { entitlements, period_end } = await client.entitlements.get("customer_123");
// [{ feature: "sso", feature_type: "boolean", allowed: true }, { feature: "images.generated", feature_type: "metered", used: "120", included: 500, remaining: "380", ... }]
```

Each metered row answers for the **next** unit, exactly as `check()` would, so its `allowed` and `reason` match the gate. Reading the list fires no webhook; only `check()` announces `balance.exhausted`.

Prefer to be told rather than to ask? Subscribe a webhook to `limit.reached` (see below).

#### When MeterFlow can't be reached

A MeterFlow blip should never take your product down with it. Three things keep `check()` answering:

- **The cache.** Answers from `check()` and `get()` are reused for the `max-age` the API sends (15 s), per client, up to 1,000 of them. A response without `Cache-Control` is never cached. A successful `usage.record()`, `usage.recordBatch()`, `credits.grant()`, `credits.deduct()`, `credits.reserve()`, `confirmReservation()` or `releaseReservation()` makes that customer's answers stale, so the next `check()` asks again. `entitlementsCache: false` turns the cache off.
- **The last answer.** When the API cannot be reached — a network error, a timeout, a 5xx or a 429, once the retries are spent — a call answers its last answer for that customer and feature, past its age, marked `stale: true`.
- **Your defaults.** With no earlier answer, `check()` answers your `entitlementDefaults` entry for the feature, else its `"*"` entry: `{ feature, feature_type: null, allowed, reason: "offline_default" }`. With neither, it throws as before. `get()` has no default: a whole plan cannot be guessed.

```typescript
const client = new MeterFlow({
  apiKey: process.env.METERFLOW_API_KEY!,
  timeout: 2_000,                  // a gate on your hot path should give up fast
  retries: 1,
  entitlementDefaults: { "images.generated": "allow", "*": "deny" },
  onError: (error, { customerId, feature, fallback }) => log.warn("meterflow fallback", { customerId, feature, fallback, error }),
});
```

A 401, 403, 404 or 422 is an answer, not an outage: it is thrown, never replaced by a fallback. `onError` is called before a fallback is used; anything it throws is ignored. `check()` resolves to an `EntitlementCheck` and `get()` to an `EntitlementList` (both exported types): the API's types, widened for `stale` and `offline_default`.

### The balance portal — a page you don't have to build

Mint a short-lived link to a MeterFlow-hosted page showing **one** customer's balance and ledger.
Call it from your server; send the `url` to that customer.

```typescript
const link = await client.portal.createSession({
  customer_external_id: "customer_123",
  topup_url: "https://acme.test/billing",   // your checkout — "buy more" goes here
  return_url: "https://acme.test/app",      // where "done" goes
  expires_in_minutes: 60,                   // default 60, maximum 1440
});

sendEmail(customer.email, `Your balance: ${link.url}`);
```

The token in that link reads **that one customer's** balance and ledger, in the environment of the
key you minted it with, and nothing else: it cannot write, cannot name another customer, and is
refused everywhere else in the API. It is never your API key — never send that to anyone.

> **MeterFlow never takes the payment.** `topup_url` is a link we carry and hand back to the page;
> what happens there is between you and your own payment provider. Grant the credits with
> `credits.grant()` when your checkout tells you it was paid.

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

MeterFlow remembers a key for 24 hours; after that the same key starts a new operation, so a retry must come within the day (a late subscription retry meets the one-per-customer rule instead of replaying).

**A key is bound to the body you first used it with.** MeterFlow stores a fingerprint of the request alongside the key, so a retry only replays when it is genuinely the same request. Reuse the key with a *different* body and the call is refused with `ConflictError` (409) instead of quietly handing back the original record:

```typescript
await client.credits.grant({ customer_external_id: "customer_123", amount: 100, metadata: {} }, { idempotencyKey: "welcome-123" });

// Same key, different amount → ConflictError. Nothing is written, and the first grant stands.
await client.credits.grant({ customer_external_id: "customer_123", amount: 250, metadata: {} }, { idempotencyKey: "welcome-123" });
```

That is deliberate: silently returning the first record would turn two different operations into one and report success. One key per operation, reused only to retry that same operation. Keys stay namespaced per environment, so a `mf_test_` and a `mf_live_` key never collide.

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
| `PayloadTooLargeError` | 413 | `payload_too_large` | no — split the batch (see `MAX_BATCH_EVENTS`) |
| `ValidationError` | 422 | `validation_error` | no — per-field detail in `.fields` |
| `RateLimitError` | 429 | `rate_limit` | yes (honours `Retry-After`, exposed as `.retryAfter`) |
| `ServerError` | 5xx | `server_error` | yes |

Every error carries:

- **`requestId`** — the API's `X-Request-ID` for that call. Include it when contacting support; it pinpoints the exact request in our logs.
- **`statusCode`**, **`errorType`**, and **`retryable`** — for programmatic handling and structured logging.
- **`message`** — the API's own sentence (e.g. `Plan limit reached: the Drip plan includes 50,000 usage events per month…`). A `ValidationError` appends its field detail (`Validation failed: amount: must be greater than 0`) and also exposes it structured as **`.fields`** (`{ field, message }[]`).

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

MeterFlow notifies your app of activity you'd otherwise poll for — credits granted or deducted, usage recorded, subscriptions created or updated, a customer reaching a plan limit. Every delivery is signed with **HMAC-SHA256** in the `X-MeterFlow-Signature` header, using the webhook's secret — verify before trusting:

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

### Payload shape & event types

Every delivery is a flat JSON object (`Content-Type: application/json`) with two envelope fields — `event` (the type) and `environment` (`"live"` or `"test"`, matching the mode of the API key that caused the activity) — plus type-specific fields:

| `event` | Fired when | Extra fields |
|---|---|---|
| `usage.recorded` | a usage event is ingested (single or batch) | `customer_id`, `event_name`, `value`, `event_id` |
| `credit.granted` | credits are granted | `customer_id`, `amount`, `balance_after`, `transaction_id` |
| `credit.deducted` | credits are deducted | `customer_id`, `amount`, `balance_after`, `transaction_id` |
| `subscription.created` | a subscription is created | `customer_id`, `plan_id`, `subscription_id`, `status` |
| `subscription.updated` | a subscription is updated | `customer_id`, `subscription_id`, `status` |
| `limit.reached` | a customer first reaches a **hard** or **soft** limit's included units this billing period (once per meter per period; metered limits report through `credit.deducted` instead) | `customer_id`, `subscription_id`, `feature` (the meter's `event_name`), `meter_id`, `limit_type`, `included`, `used`, `period_start`, `period_end` |
| `balance.low` | a spend takes a customer's balance **down through** this endpoint's `low_balance_threshold` — a crossing, so it fires once and not again while they stay below. Raised by both doors that spend: `credits.deduct` and a metered usage charge. **Both crossing events follow from the endpoint's `low_balance_threshold`: set one and the API adds them, clear it and the API removes them — so a line is the only thing to configure.** | `customer_id`, `balance`, `threshold`, `suggested_topup` (the subscription's `topup_amount`, `null` when unset), `transaction_id` |
| `balance.exhausted` | a balance reaches zero, **or** a request is refused for want of credits (a deduction returning 402, or `entitlements.check` answering `insufficient_credits`). Unlike `balance.low` this repeats: every refused request is its own blocked request | `customer_id`, `balance`, `reason` (`balance_zero` / `insufficient_credits`), `requested_amount` and `feature` where they apply, `transaction_id` on the zero case |
| `subscription.renewed` | a billing period opens — a paid period rolling forward, a **trial converting** to its first paid period, or a canceled subscription **reactivated** after its period lapsed, told apart by `reason` (the renewer emits no `subscription.updated` for the first two) | `customer_id`, `subscription_id`, `plan_id`, `status`, `reason` (`period_renewed` / `trial_converted` / `period_reactivated`), `current_period_start`, `current_period_end`, `credits_granted` |
| `subscription.canceled` | a subscription's status becomes canceled — fired **alongside** `subscription.updated`, once, on the call that actually cancels | `customer_id`, `subscription_id`, `plan_id`, `canceled_at` |
| `balance.topped_up` | a grant takes a customer's balance **up through** this endpoint's `low_balance_threshold` — the upward mirror of `balance.low`, on the same per-endpoint line, so the endpoint told "low" is the one told "recovered". Subscribed together with `balance.low` by setting the threshold, never on its own | `customer_id`, `balance`, `threshold`, `amount`, `transaction_id` |
| `cap.reached` | a customer's credit spending reaches their subscription's `spend_cap` for the period — once per subscription per period, whether they landed on the cap or were refused by it. A refusal that still leaves headroom is not a reach and does not fire | `customer_id`, `subscription_id`, `cap`, `spent`, `period_start`, `period_end` |

For example, a `credit.granted` delivery:

```json
{
  "event": "credit.granted",
  "environment": "live",
  "customer_id": "cust_123",
  "amount": 500.0,
  "balance_after": 1250.0,
  "transaction_id": "9b2f6c1e-…"
}
```

When registering a webhook you pick which of these event types it should receive. Deliveries are retried with backoff on non-2xx responses — respond `200` quickly and do the heavy work asynchronously.

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
const { data: history } = await client.credits.transactions("ana");
const usage = await client.usage.summary("ana");
```
