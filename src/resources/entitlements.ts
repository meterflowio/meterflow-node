import type { EntitlementFallbackContext, MeterFlow } from "../client";
import type { components } from "../types/openapi";
import { isOutage, maxAgeSeconds } from "../utils/entitlement-cache";

type EntitlementResponse = components["schemas"]["EntitlementResponse"];
type EntitlementsResponse = components["schemas"]["EntitlementsResponse"];

/**
 * What `check()` answers: the API's answer, or a fallback while MeterFlow is unreachable. `stale: true`
 * marks the last answer reused past its `max-age`; `reason: "offline_default"` marks your configured
 * `entitlementDefaults` entry, which knows nothing of the plan, so its `feature_type` is null.
 */
export type EntitlementCheck = Omit<EntitlementResponse, "reason" | "feature_type"> & {
  feature_type: EntitlementResponse["feature_type"] | null;
  reason?: EntitlementResponse["reason"] | "offline_default";
  stale?: true;
};

/** What `get()` answers: the API's answer, with `stale: true` when it is the last one reused during an outage. */
export type EntitlementList = EntitlementsResponse & { stale?: true };

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
 * Answers are reused for the `Cache-Control: max-age` the API sends (15 s), per customer, feature
 * and quantity, unless `entitlementsCache: false`. A usage record, grant or deduct for a customer
 * makes their answers stale. While MeterFlow is unreachable, a call answers its last answer with
 * `stale: true`, or else `check()` answers the `entitlementDefaults` entry for the feature.
 */
export class EntitlementsResource {
  constructor(private readonly client: MeterFlow) {}

  /** Every feature on the customer's plan, with this period's usage; a metered row answers for the next unit, as `check()` would. Empty without a subscription. */
  get(customerId: string): Promise<EntitlementList> {
    const path = `entitlements/${encodeURIComponent(customerId)}`;
    return this.answer<EntitlementList>(`get\u0000${customerId}`, { customerId, feature: null }, (onHeaders) =>
      this.client.request<EntitlementList>("GET", path, { onHeaders }),
    );
  }

  /** May this customer use `feature` (`quantity` more units of it) right now? */
  check(customerId: string, feature: string, opts?: CheckOptions): Promise<EntitlementCheck> {
    const query: Record<string, string | number | boolean> = { feature };
    if (opts?.quantity !== undefined) query["quantity"] = opts.quantity;
    const path = `entitlements/${encodeURIComponent(customerId)}/check`;
    const key = `check\u0000${customerId}\u0000${feature}\u0000${opts?.quantity ?? 1}`;
    return this.answer<EntitlementCheck>(key, { customerId, feature }, (onHeaders) =>
      this.client.request<EntitlementCheck>("GET", path, { query, onHeaders }),
    );
  }

  /**
   * Answer from the cache while fresh, else from the API; during an outage, from the last answer or the feature's default.
   * key: the call's cache key.
   * call: which customer and feature, as `onError` is told.
   * fetch: makes the request, handing the response's headers to the callback it is given.
   */
  private async answer<T extends object>(
    key: string,
    call: Omit<EntitlementFallbackContext, "fallback">,
    fetch: (onHeaders: (headers: Headers) => void) => Promise<T>,
  ): Promise<T> {
    const cache = this.client.entitlementCache;
    const cached = cache?.read(key);
    if (cached?.fresh) return cached.value as T;
    let seconds = 0;
    try {
      const value = await fetch((headers) => (seconds = maxAgeSeconds(headers.get("cache-control"))));
      cache?.write(key, call.customerId, value, seconds);
      return value;
    } catch (error) {
      if (!isOutage(error)) throw error;
      if (cached) {
        this.tell(error, { ...call, fallback: "stale" });
        return { ...(cached.value as T), stale: true };
      }
      const fallback = call.feature === null ? undefined : this.offlineDefault(call.feature);
      if (fallback === undefined) throw error;
      this.tell(error, { ...call, fallback: "default" });
      return fallback as T;
    }
  }

  /**
   * The configured answer for a feature while MeterFlow is unreachable: its own entry, else `"*"`; undefined when neither is set.
   * feature: the feature checked.
   */
  private offlineDefault(feature: string): EntitlementCheck | undefined {
    const defaults = this.client.options.entitlementDefaults;
    const setting = defaults[feature] ?? defaults["*"];
    if (setting === undefined) return undefined;
    return { feature, feature_type: null, allowed: setting === "allow", reason: "offline_default" };
  }

  /**
   * Hand the error and the fallback to `onError`, ignoring anything it throws: it is the caller's code.
   * error: what the call threw.
   * context: the call and the fallback it answers with.
   */
  private tell(error: unknown, context: EntitlementFallbackContext): void {
    try {
      this.client.options.onError(error, context);
    } catch {
      // The hook is the caller's; a failure in it must not turn a fallback back into an error.
    }
  }
}
