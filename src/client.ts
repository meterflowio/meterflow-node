import { httpRequest } from "./utils/http";
import { CreditsResource } from "./resources/credits";
import { UsageResource } from "./resources/usage";
import { SubscriptionsResource } from "./resources/subscriptions";
import { PlansResource } from "./resources/plans";
import { PortalResource } from "./resources/portal";
import { EntitlementsResource } from "./resources/entitlements";
import { WebhooksResource } from "./resources/webhooks";
import { EntitlementCache } from "./utils/entitlement-cache";

/** What `entitlements.check()` answers for a feature while MeterFlow cannot be reached and no earlier answer is cached. */
export type EntitlementDefault = "allow" | "deny";

/** Which call fell back, and to what, as `onError` is told. */
export interface EntitlementFallbackContext {
  customerId: string;
  /** The feature checked; null for `entitlements.get()`. */
  feature: string | null;
  /** `stale`: the last answer, past its `max-age`. `default`: the configured `entitlementDefaults` entry. */
  fallback: "stale" | "default";
}

export interface MeterFlowOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
  fetch?: typeof globalThis.fetch;
  /** Reuse `entitlements.check()` / `get()` answers for the `max-age` the API sends (15 s today). On by default. */
  entitlementsCache?: boolean;
  /** Per feature, what `check()` answers while MeterFlow is unreachable and nothing is cached; `"*"` covers every other feature. */
  entitlementDefaults?: Record<string, EntitlementDefault>;
  /** Called before an entitlements call answers from a fallback, with the error that caused it. What it throws is ignored. */
  onError?: (error: unknown, context: EntitlementFallbackContext) => void;
}

/** One query parameter's value: a list is sent as the key repeated once per item; `undefined` and `null` are not sent. */
export type QueryValue = string | number | boolean | readonly (string | number | boolean)[] | null | undefined;

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, QueryValue>;
  idempotencyKey?: string;
  timeout?: number;
  /** @internal — given a successful response's headers; how the entitlements cache reads `Cache-Control`. */
  onHeaders?: (headers: Headers) => void;
}

export class MeterFlow {
  readonly options: Required<MeterFlowOptions>;

  private _credits?: CreditsResource;
  private _usage?: UsageResource;
  private _subscriptions?: SubscriptionsResource;
  private _plans?: PlansResource;
  private _portal?: PortalResource;
  private _entitlements?: EntitlementsResource;
  private _webhooks?: WebhooksResource;
  /** @internal — the entitlement answers this client has read; null when `entitlementsCache` is false. */
  readonly entitlementCache: EntitlementCache | null;

  constructor(options: MeterFlowOptions) {
    if (!options.apiKey.startsWith("mf_live_") && !options.apiKey.startsWith("mf_test_")) {
      throw new Error("apiKey must start with mf_live_ or mf_test_");
    }
    this.options = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? "https://api.meter-flow.com/api/v1",
      timeout: options.timeout ?? 30_000,
      retries: options.retries ?? 3,
      // Bind to globalThis: browsers throw "Illegal invocation" if window.fetch is
      // called detached from window (Node tolerates it, so this only bites in the browser).
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      entitlementsCache: options.entitlementsCache ?? true,
      entitlementDefaults: options.entitlementDefaults ?? {},
      onError: options.onError ?? ((): void => undefined),
    };
    this.entitlementCache = this.options.entitlementsCache ? new EntitlementCache() : null;
  }

  get portal(): PortalResource {
    return (this._portal ??= new PortalResource(this));
  }

  get credits(): CreditsResource {
    return (this._credits ??= new CreditsResource(this));
  }

  get usage(): UsageResource {
    return (this._usage ??= new UsageResource(this));
  }

  get subscriptions(): SubscriptionsResource {
    return (this._subscriptions ??= new SubscriptionsResource(this));
  }

  get plans(): PlansResource {
    return (this._plans ??= new PlansResource(this));
  }

  get entitlements(): EntitlementsResource {
    return (this._entitlements ??= new EntitlementsResource(this));
  }

  /** Read-only: the endpoints registered for this project, and what we sent them. */
  get webhooks(): WebhooksResource {
    return (this._webhooks ??= new WebhooksResource(this));
  }

  /** @internal — used by resource classes only; not part of the public API */
  request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    return httpRequest<T>(this.options, method, path, opts);
  }
}
