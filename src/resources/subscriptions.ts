import type { MeterFlow } from "../client";
import type { components } from "../types/openapi";

type SubscriptionCreateRequest = components["schemas"]["SubscriptionCreateRequest"];
type SubscriptionUpdateRequest = components["schemas"]["SubscriptionUpdateRequest"];
type SubscriptionResponse = components["schemas"]["SubscriptionResponse"];
type SubscriptionPage = components["schemas"]["SubscriptionPage"];

export interface CreateOptions {
  idempotencyKey?: string;
}

export interface ListQuery {
  customer_id?: string;
  /** Rows per page, 1–200 (50 by default). */
  limit?: number;
  /** `next_cursor` from the previous page; omit for the first. */
  cursor?: string;
}

export class SubscriptionsResource {
  constructor(private readonly client: MeterFlow) {}

  create(body: SubscriptionCreateRequest, opts?: CreateOptions): Promise<SubscriptionResponse> {
    return this.client.request<SubscriptionResponse>("POST", "subscriptions", {
      body,
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
  }

  /**
   * One page of the project's subscriptions in this key's environment, newest first.
   *
   * `data` holds the rows and `next_cursor` the mark for the page after this one (`null` on the
   * last). Pass it back as `cursor` unchanged — it is opaque, and nothing but this API reads it.
   */
  list(query?: ListQuery): Promise<SubscriptionPage> {
    return this.client.request<SubscriptionPage>("GET", "subscriptions", {
      ...(query !== undefined && { query: query as Record<string, string | number | boolean> }),
    });
  }

  get(subscriptionId: string): Promise<SubscriptionResponse> {
    return this.client.request<SubscriptionResponse>("GET", `subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  update(subscriptionId: string, body: SubscriptionUpdateRequest, opts?: { idempotencyKey?: string }): Promise<SubscriptionResponse> {
    return this.client.request<SubscriptionResponse>("PATCH", `subscriptions/${encodeURIComponent(subscriptionId)}`, {
      body,
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
  }

  delete(subscriptionId: string): Promise<void> {
    return this.client.request<void>("DELETE", `subscriptions/${encodeURIComponent(subscriptionId)}`);
  }
}
