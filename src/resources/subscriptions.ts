import type { MeterFlow, QueryValue } from "../client";
import type { components } from "../types/openapi";

type SubscriptionCreateRequest = components["schemas"]["SubscriptionCreateRequest"];
type SubscriptionUpdateRequest = components["schemas"]["SubscriptionUpdateRequest"];
type SubscriptionResponse = components["schemas"]["SubscriptionResponse"];
type SubscriptionPage = components["schemas"]["SubscriptionPage"];
type SubscriptionStatus = components["schemas"]["SubscriptionStatus"];

export interface CreateOptions {
  idempotencyKey?: string;
}

export interface ListQuery {
  /** Only this customer's subscriptions, matched exactly. */
  customer_id?: string;
  /** Only customers whose id contains this, ignoring case; `%` and `_` are matched literally. */
  q?: string;
  /** Only subscriptions in one of these statuses. */
  status?: readonly SubscriptionStatus[];
  /** Rows per page, 1–200 (50 by default). */
  limit?: number;
  /** `next_cursor` from the previous page; omit it, or pass null, for the first page. */
  cursor?: string | null;
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
   * last). Pass it back as `cursor` unchanged — it is opaque, and nothing but this API reads it,
   * with the same `q`, `status` and `customer_id`: the filters apply before the page is cut.
   */
  list(query?: ListQuery): Promise<SubscriptionPage> {
    return this.client.request<SubscriptionPage>("GET", "subscriptions", {
      ...(query !== undefined && { query: query as Record<string, QueryValue> }),
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
