import type { MeterFlow } from "../client";
import type { components } from "../types/openapi";

type WebhookResponse = components["schemas"]["WebhookResponse"];
type WebhookDeliveryResponse = components["schemas"]["WebhookDeliveryResponse"];

/**
 * Webhook **receipts** — read-only on purpose.
 *
 * An endpoint is registered, edited and deleted in the dashboard, where the signing secret is
 * shown once and never again. What an SDK consumer needs at 3am is the other half: which
 * endpoints exist, and what MeterFlow actually sent them. That is this.
 *
 * Not to be confused with `meterflow/webhook`, which verifies the signature on a webhook your
 * server has just received. This reads what we sent; that proves we sent it.
 */
export class WebhooksResource {
  constructor(private readonly client: MeterFlow) {}

  /** Every endpoint registered for the key's project. Never includes a secret. */
  list(): Promise<WebhookResponse[]> {
    return this.client.request<WebhookResponse[]>("GET", "webhooks");
  }

  /**
   * One endpoint's delivery attempts, newest first: the payload sent, the HTTP status that came
   * back, how many attempts and when the next retry is due.
   *
   * Capped at the most recent 100, and scoped to the key's own environment — a `mf_test_*` key
   * reads test receipts, a `mf_live_*` key live ones. A webhook belonging to another project
   * answers 404.
   */
  deliveries(webhookId: string): Promise<WebhookDeliveryResponse[]> {
    return this.client.request<WebhookDeliveryResponse[]>("GET", `webhooks/${encodeURIComponent(webhookId)}/deliveries`);
  }
}
