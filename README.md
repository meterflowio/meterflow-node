# meterflow

Official Node.js SDK for [MeterFlow](https://meterflow.com) — usage-based billing, credit management, and metering.

## Requirements

- Node.js ≥ 18

## Installation

```bash
npm install meterflow
```

## Quick start

```typescript
import { MeterFlow } from "meterflow";

const client = new MeterFlow({ apiKey: "mf_live_your_api_key" });

// Grant credits to a customer
await client.credits.grant({
  customer_external_id: "customer_123",
  amount: 100,
  description: "Welcome credits",
});

// Record a usage event
await client.usage.record({
  customer_external_id: "customer_123",
  meter_name: "api_calls",
  quantity: 1,
});

// Check credit balance
const balance = await client.credits.balance("customer_123");
console.log(balance.balance);
```

## Configuration

```typescript
const client = new MeterFlow({
  apiKey: "mf_live_your_api_key",   // required; mf_live_* or mf_test_*
  baseUrl: "https://api.meterflow.com/api/v1",  // optional override
  timeout: 30_000,                  // ms; default 30 s
  retries: 3,                       // default 3; 0 to disable
});
```

## Resources

| Resource | Methods |
|---|---|
| `client.credits` | `grant`, `deduct`, `balance`, `transactions` |
| `client.usage` | `record`, `recordBatch`, `summary` |
| `client.subscriptions` | `create`, `list`, `get`, `update`, `delete` |
| `client.plans` | `list`, `get` |

## Webhook verification

```typescript
import { verifyWebhook } from "meterflow";

const isValid = verifyWebhook(rawBody, req.headers["x-meterflow-signature"], webhookSecret);
```

## Error handling

```typescript
import { MeterFlowError, InsufficientCreditsError, RateLimitError } from "meterflow";

try {
  await client.credits.deduct({ customer_external_id: "cust_1", amount: 999 });
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    console.log("Not enough credits");
  } else if (err instanceof RateLimitError) {
    console.log(`Rate limited, retry after ${err.retryAfter}s`);
  } else if (err instanceof MeterFlowError) {
    console.log(`Request ID for support: ${err.requestId}`);
  }
}
```

## License

MIT
