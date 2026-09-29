import type { MeterFlow } from "../client";
import type { components } from "../types/openapi";

type EntitlementResponse = components["schemas"]["EntitlementResponse"];
type EntitlementsResponse = components["schemas"]["EntitlementsResponse"];

export interface CheckOptions {
  /** How many more units the app is about to use — "may they do 5 more?". Defaults to 1 on the server. */
  quantity?: number;
}

/**
 * Ask BEFORE doing the work. `check()` is where a hard limit says no; recording usage afterwards
 * never blocks, so an app that skips this call gets no enforcement at all — only an honest ledger.
 *
 * `allowed: false` is a normal answer, not an error: the promise resolves and `reason` says why
 * (`no_subscription`, `not_in_plan`, `hard_limit_reached`, `insufficient_credits`). A feature key
 * the project does not know at all is a 404 → `NotFoundError`, because that is a typo, not a plan.
 *
 * Both calls return `Cache-Control: private, max-age=15` — cache per customer for a few seconds
 * on hot paths rather than calling on every request.
 */
export class EntitlementsResource {
  constructor(private readonly client: MeterFlow) {}

  /** Every feature on the customer's plan, with this period's usage. Empty `entitlements` without a subscription. */
  get(customerId: string): Promise<EntitlementsResponse> {
    return this.client.request<EntitlementsResponse>("GET", `entitlements/${encodeURIComponent(customerId)}`);
  }

  /** May this customer use `feature` (`quantity` more units of it) right now? */
  check(customerId: string, feature: string, opts?: CheckOptions): Promise<EntitlementResponse> {
    const query: Record<string, string | number | boolean> = { feature };
    if (opts?.quantity !== undefined) query["quantity"] = opts.quantity;
    return this.client.request<EntitlementResponse>("GET", `entitlements/${encodeURIComponent(customerId)}/check`, { query });
  }
}
