# Changelog

Notable changes to `meterflow` (npm). Dates are the day the version was cut; what is published is
in [the project roadmap](https://github.com/Donovantxy/MeterFlow/blob/main/docs/ROADMAP.md#where-we-are-2026-10-07).

## 0.10.0 — 2026-10-28

**`entitlements.check()` and `get()` cache their answers and keep answering through an outage.**
Nothing to change to benefit; three options to tune it:
- Answers are reused for the `Cache-Control: max-age` the API sends (15 s), per customer, feature and
  `quantity`, `allowed: false` included, up to 1,000 per client. A successful `usage.record()`,
  `recordBatch()`, `credits.grant()` or `deduct()` makes that customer's answers stale, so a
  check right after a record asks again. **If you relied on two checks in a row both reaching the API,
  pass `entitlementsCache: false`.**
- When MeterFlow cannot be reached (network error, timeout, 5xx or 429 after the retries), a call
  answers its last answer, marked `stale: true`. With none, `check()` answers your
  `entitlementDefaults` entry for the feature, or its `"*"` entry, as
  `{ feature, feature_type: null, allowed, reason: "offline_default" }`. With neither, it throws as
  before. A 401, 403, 404 or 422 is always thrown.
- `onError(error, { customerId, feature, fallback })` is called before a fallback is used.
- Types: `check()` now resolves to `EntitlementCheck` and `get()` to `EntitlementList` (both exported),
  the API's types plus `stale`, with `reason` also allowing `"offline_default"` and `feature_type`
  allowing `null`. Code that assigns `gate.feature_type` or `gate.reason` to the narrower generated
  type needs a check for those values first. `MeterFlowOptions` is now exported too.

**A test key (`mf_test_*`) now has its own monthly event allowance, a tenth of your plan's.** Until
now test events were never refused. From this release `usage.record()` and `usage.recordBatch()` on a
test key throw `AuthError` (status 403, *Plan limit reached: … test usage events per month*) once the
organization's test events this month pass 10 % of the plan's live allowance plus the usual 10 %
grace: 5,500 on Drip, 22,000 on Flow, 77,000 on Stream, 440,000 on Torrent. Test events never count
toward the live quota, event packs raise only the live one, and no warning email is sent for test.
Live keys are unchanged.

**A test key is rate-limited at 60 requests a minute; a live key stays at 300.** Past it the SDK's
`RateLimitError` (429, retried after `Retry-After`) arrives sooner on a test key. If your test suite
fires more than 60 calls a minute, pace it or batch with `usage.recordBatch()`.

**Test data expires.** Test usage events are deleted after 30 days, and a test subscription with no
usage event for 90 days is deleted with its test credit balance and ledger. Live usage events are
kept for your plan's analytics retention (45, 90, 180 or 365 days) and then deleted. Nothing in the
SDK's calls changes; a `subscriptions.list()` on a test key simply stops returning an expired one.

## 0.9.0 — 2026-10-26

**`webhooks.deliveryPage(webhookId, { limit, cursor })` reads an endpoint's receipts past the newest 100.**
It answers `{ data, next_cursor }` like `subscriptions.list()`: newest first, scoped to your key's
environment, and `cursor: page.next_cursor` reads the page after. `webhooks.deliveries()` is
unchanged and still returns the newest 100 as an array, so nothing you wrote changes.

**`subscriptions.list()` searches and filters by status on the server.** Two new options:
`q`, a case-insensitive contains on the customer id (`%` and `_` are matched literally), and
`status`, an array of subscription statuses (`["past_due", "paused"]`). Both apply before the page
is cut, so pass them again with `cursor` to read the next page of the same matches. An unknown status
is a `ValidationError`. Nothing you wrote changes; until now the only filter was the exact
`customer_id`, which still works and combines with both.

**A query option left `undefined` is no longer sent.** 0.8.0 sent it as the text `undefined`, so
`subscriptions.list({ cursor: page.next_cursor ?? undefined })` on the last page asked for a cursor
named `undefined` (a `ValidationError`), and `customer_id: undefined` asked for a customer with that
id (an empty page). Both are now left out of the request, as an omitted option always was, and so
is `null`: `cursor` accepts `string | null`, so `page.next_cursor` can be passed back as it came
(null reads the first page). If you built the options object conditionally to avoid this, you can stop.

**`plans.list()`, `plans.get()` and `webhooks.list()` carry two new fields, `created_by` and `created_by_email`, both always `null` for an API-key caller.** They name the dashboard user who created the row, which is for the dashboard's own tables, not for an integration holding a key; they exist on the type so the one response serves both. Nothing you call changes; a test fixture you typed as `PlanResponse` or `WebhookResponse` needs the two fields added to compile.

**A canceled subscription can be reactivated.** `subscriptions.update(id, { status: 'active' })` on a
canceled subscription now succeeds instead of answering 409: `canceled_at` is cleared, and if the old
period has ended a fresh one starts now — with the plan's price granted in credits and a
`subscription.renewed` webhook whose `reason` is `period_reactivated`. A trial canceled before its end
comes back as `trialing` with the same end date. A plan that is unpublished or switched off since the
cancel refuses with a 409, as it refuses a new subscription. Any other status on a canceled subscription is still a 409,
and so is a reactivation of a subscription your payment-provider connector drives — reactivate it at
the provider. The signature is unchanged; code that caught the 409 to mean "gone for good" should
expect a 200.

**`entitlements.get()` answers each metered row for the next unit**, exactly as `check()` does. A
row can now read `allowed: false` with `reason` `insufficient_credits`, `spend_cap_reached` or
`hard_limit_reached` (and a soft row `soft_limit_exceeded`) where it used to read `allowed: true`
until the line was crossed — a hard limit at exactly its allowance is now refused, because the next
unit would be. `used` and `remaining` are unchanged. Reading the list never fires a webhook; only
`check()` announces `balance.exhausted`. Both reads now also send `Vary: Authorization`, so a browser
never serves one key's answer to another. The signature is unchanged; if you drew "allowed" from the
list, it now agrees with the gate.

**A malformed item in `usage.recordBatch()` is a 422, not a 500.** An item that is not an object used
to crash the API's error handler; it now answers `ValidationError` with the item named by its path
(`events.0`). Nothing changes for a well-formed body.

**`usage.summary()` rows carry `aggregation_field`** — the meter's own property name, null on a
count meter. A row's `value` is in a different unit per meter (events on a count meter, the property
on a sum / max / min one, distinct values of it on a unique_count one), so this is what lets you label
it. Additive: nothing you wrote changes.

**`credits.balance()` says whether usage will draw on the balance**: a new `usage_draws_credits`
field. `true` when the customer's active or trialing subscription is on a plan with a metered limit
at a rate (on a meter whose value is a quantity), so recorded usage beyond the allowance is charged
to it; `false` when it has such a subscription and no such limit — not an error: the balance moves
only when your app calls `credits.deduct`; `null` without an active or trialing subscription, when
there is no plan to say anything about. The portal's balance read carries it too. Additive.

**`webhooks.deliveries(id)` no longer returns `next_retry_at`.** It was null on every receipt: a
delivery is tried up to five times with backoff inside the same run, and no later attempt is ever
scheduled, so there was never a time to report. `attempts` still counts the tries. Code that
reads `next_retry_at` stops compiling — drop the read.

**A webhook receipt read during a delivery shows where it stands.** `webhooks.deliveries(id)` now
returns `pending` before the first try and `retrying` between tries, with the live `attempts`,
`response_code` and `response_body`; before, a receipt only ever showed the final `success` or
`failed`. Additive: the four statuses were already in the type, and nothing stops compiling.

**Webhook retries survive a worker restart.** A failed delivery's next try is now scheduled
through the queue after the same delays (30 s, 5 min, 30 min, 2 h) instead of a worker waiting in
place, so a retry waiting in the queue survives a deploy instead of leaving its receipt at
`retrying`. Nothing changes
for a reader of `webhooks.deliveries(id)`: the same statuses, `attempts` and timing.

**An idempotency key is remembered for 24 hours.** A write retried with the same key more than a
day after the original is now a new write, not a replay of the original (and no longer a 409 when
the body differs). Nothing changes for a client that retries promptly; a key you reuse on purpose,
like an order id, identifies one operation per day. A subscription is the one shape that differs: its customer already has one, so a late retry meets the usual one-per-customer 409 rather than a replay.

## 0.8.0 — 2026-10-15

**`portal.createSession()` reads your project's defaults.** `topup_url`, `return_url` and
`expires_in_minutes` are now settings on the project (set in the dashboard, under Portal), and a
call that leaves one out uses the project's value instead of nothing. Passing a value still wins.
If you were relying on "omitted means no Buy more button", set the project's checkout to empty.

**`entitlements.get()` now answers with `plan_name`** beside `plan_id`, null exactly when `plan_id`
is. A screen that shows a customer the plan they are on no longer has to follow the id with a
second read to print one word.

**`portal.createSession()` returns the link that customer already holds.** Calling it with only
`customer_external_id`, while a link minted earlier is still valid, gives back **that** link rather
than minting a second one — a customer has one live link, not a pile nobody can withdraw. Naming
`topup_url`, `return_url` or `expires_in_minutes` is asking for a different link, and replaces it.
The signature and the response shape are unchanged; only "every call is a fresh link" is no longer
true.

## 0.7.1 — 2026-10-15

**Fixed: the package now ships its types.** `0.5.0` through `0.7.0` built `dist/resources/*.d.ts`
that import `../types/openapi`, and never put that file in the tarball — `tsc` emits declarations
for `.ts` sources and copies no hand-written `.d.ts`. Under `skipLibCheck`, which is on by default
in most apps, the dangling import is silent: **every request body and every return type you wrote
against those versions was `any`**, and your compiler said nothing.

Nothing in the API or in this SDK's behaviour changed. What changes is that your editor and your
build now see the real types — so an upgrade across 0.6.0 or 0.7.0 may surface errors that were
always there. In particular the 0.7.0 pagination change below is now caught where it was not:

```typescript
const page = await client.credits.transactions("customer_123");
page.length;        // now an error: a page is { data, next_cursor }, not an array
page.data.length;   // this is the one
```

A tarball check runs on every CI build (`npm run verify:pack`): every relative import inside a
packed declaration must resolve to another packed file, so this cannot return quietly.

**Also fixed, and only visible once the types shipped: a field with a default is optional.**
`metadata`, `properties`, `environment` and the others the API defaults were being generated as
**required**, so `credits.grant({ customer_external_id, amount })` — which the API accepts — would
not compile. The generator now ignores defaults when deciding what is required, which is what the
API's own schema says. 39 fields across 19 types; none of them changed meaning on the wire.

## 0.7.0 — 2026-10-14

**New: `portal.createSession()`** — mint a short-lived link to the MeterFlow-hosted balance page
for one of your customers. The link reads that one customer's balance and ledger and nothing else;
"buy more" goes to your own checkout, and MeterFlow never takes the payment. The two reads behind
the page are deliberately not on this client: they belong to the person holding the link.

**Breaking: the two lists that grow without a limit now answer a page.**

- `credits.transactions(customerId)` returns `{ data, next_cursor }` instead of
  `CreditTransactionResponse[]`, and takes `{ limit, cursor }`.
- `subscriptions.list()` returns `{ data, next_cursor }` instead of `SubscriptionResponse[]`, and
  its query takes `limit` and `cursor` beside `customer_id`.

`data` holds the rows, newest first; `next_cursor` is the opaque mark for the page after this one
and is `null` on the last page. Pass it back as `cursor` unchanged. `limit` is 1–200 and defaults
to 50 — a `limit` outside that range, or a cursor this API did not mint, is a `422`.

**Migrating** — wherever a call was used as an array:

```diff
-const txns = await client.credits.transactions("customer_123");
-for (const t of txns) { … }
+const page = await client.credits.transactions("customer_123");
+for (const t of page.data) { … }
```

The compiler finds every one of these **from 0.7.1 onward** — 0.7.0 itself shipped without its
type declarations (see above), so on that version the change was invisible to a consumer's build
and showed up only at runtime. Nothing else in the SDK changed — `plans.list()`, `webhooks.list()` and the
rest stay plain arrays, because what they return is bounded by a plan cap or by configuration.

Why a cursor rather than a page number: [DECISIONS,
2026-10-14](https://github.com/Donovantxy/MeterFlow/blob/main/docs/DECISIONS.md).
