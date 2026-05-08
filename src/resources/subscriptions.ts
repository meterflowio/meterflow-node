import type { MeterFlow } from "../client";
import type { components } from "../types/openapi";

type SubscriptionCreateRequest = components["schemas"]["SubscriptionCreateRequest"];
type SubscriptionUpdateRequest = components["schemas"]["SubscriptionUpdateRequest"];
type SubscriptionResponse = components["schemas"]["SubscriptionResponse"];

export interface CreateOptions {
  idempotencyKey?: string;
}

export interface ListQuery {
  customer_id?: string;
}

export class SubscriptionsResource {
  constructor(private readonly client: MeterFlow) {}

  create(body: SubscriptionCreateRequest, opts?: CreateOptions): Promise<SubscriptionResponse> {
    return this.client.request<SubscriptionResponse>("POST", "subscriptions", {
      body,
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
  }

  list(query?: ListQuery): Promise<SubscriptionResponse[]> {
    return this.client.request<SubscriptionResponse[]>("GET", "subscriptions", {
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
