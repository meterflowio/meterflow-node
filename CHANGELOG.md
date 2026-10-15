# Changelog

Notable changes to `meterflow` (npm). Dates are the day the version was cut; what is published is
in [the project roadmap](https://github.com/Donovantxy/MeterFlow/blob/main/docs/ROADMAP.md#where-we-are-2026-10-07).

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
