/**
 * MeterFlow Node.js SDK — Quickstart
 *
 * It's a smoke test / demo script that exercises every major SDK method against a live local API (http://localhost:8000/api/v1). In order:
 *
 *  1 - Grant 500 credits to a test customer (quickstart-customer-1)
 *  2 - Check balance — confirms the 500 landed
 *  3 - Deduct 100 credits — verifies write + balance update
 *  4 - Record a usage event (api_call, value=1)
 *  5 - List credit transactions — prints each transaction type, amount, and balance_after
 *  6 - Verify a webhook signature — synthesizes a payload, signs it with HMAC-SHA256, 
 *      then calls verifyWebhook twice: once with the correct secret (should be true) and once with a wrong secret (should be false)
 * 
 * Prerequisites:
 *   1. Start the API — make dev-d && make dev-migrate (from repo root)
 *   2. Register — POST http://127.0.0.1:8000/api/v1/auth/registration
 *   3. Login — POST http://127.0.0.1:8000/api/v1/auth/login → copy access_token
 *   4. Get org id — GET http://127.0.0.1:8000/api/v1/organizations → copy id
 *   5. Create a project — POST /api/v1/organizations/{org_id}/projects → copy id
 *   6. Generate an API key — POST /api/v1/organizations/{org_id}/projects/{project_id}/api-keys → copy raw_key
 *   7. Create a meter — POST /api/v1/meters { "name": "api_call", "project_id": "{project_id}", "aggregation_type": "count", "aggregation_field": null }
 *   8. Run (from sdks/node): METERFLOW_API_KEY={raw_key} METERFLOW_BASE_URL=http://127.0.0.1:8000/api/v1 npm run quickstart
 *
 */

import { MeterFlow, verifyWebhook } from "../dist/index";
import { createHmac } from "crypto";

const apiKey = process.env["METERFLOW_API_KEY"];
if (!apiKey) {
  console.error("Set METERFLOW_API_KEY before running this example.");
  process.exit(1);
}

const client = new MeterFlow({ apiKey, baseUrl: process.env["METERFLOW_BASE_URL"] ?? "http://localhost:8000/api/v1" });

const CUSTOMER_ID = "quickstart-customer-1";

async function run() {
  console.log("=== MeterFlow SDK Quickstart ===\n");

  // 1. Grant credits
  console.log("1. Granting 500 credits...");
  const grant = await client.credits.grant(
    { amount: 500, customer_external_id: CUSTOMER_ID, metadata: { reason: "quickstart" } },
    { idempotencyKey: `qs-grant-${CUSTOMER_ID}-1` },
  );
  console.log(`   ✓ Granted — tx id=${grant.id}, balance_after=${grant.balance_after}\n`);

  // 2. Check balance
  console.log("2. Checking balance...");
  const balance = await client.credits.balance(CUSTOMER_ID);
  console.log(`   ✓ Balance=${balance.balance}\n`);

  // 3. Deduct credits
  console.log("3. Deducting 100 credits...");
  const deduct = await client.credits.deduct(
    { amount: 100, customer_external_id: CUSTOMER_ID, description: "API call fee", metadata: {} },
    { idempotencyKey: `qs-deduct-${CUSTOMER_ID}-1` },
  );
  console.log(`   ✓ Deducted — tx id=${deduct.id}, balance_after=${deduct.balance_after}\n`);

  // 4. Record a usage event
  console.log("4. Recording a usage event...");
  const event = await client.usage.record(
    { event_name: "api_call", customer_external_id: CUSTOMER_ID, value: 1, properties: {} },
    { idempotencyKey: `qs-usage-${CUSTOMER_ID}-1` },
  );
  console.log(`   ✓ Event recorded — id=${event.id}\n`);

  // 5. List recent transactions
  console.log("5. Listing credit transactions...");
  const txns = await client.credits.transactions(CUSTOMER_ID);
  console.log(`   ✓ Found ${txns.length} transaction(s)`);
  for (const tx of txns) {
    console.log(`     [${tx.transaction_type}] amount=${tx.amount} balance_after=${tx.balance_after}`);
  }
  console.log();

  // 6. Verify a sample webhook signature
  console.log("6. Webhook signature verification...");
  const webhookSecret = "example-webhook-secret";
  const payload = JSON.stringify({ event: "credit.granted", customer_id: CUSTOMER_ID, amount: 500 });
  const sig = createHmac("sha256", webhookSecret).update(Buffer.from(payload, "utf8")).digest("hex");

  const valid = verifyWebhook(payload, sig, webhookSecret);
  const tampered = verifyWebhook(payload, sig, "wrong-secret");
  console.log(`   ✓ Valid signature:    ${valid}`);
  console.log(`   ✓ Tampered signature: ${tampered}\n`);

  console.log("=== Quickstart complete ===");
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
