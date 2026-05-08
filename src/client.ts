import { httpRequest } from "./utils/http";
import { CreditsResource } from "./resources/credits";
import { UsageResource } from "./resources/usage";
import { SubscriptionsResource } from "./resources/subscriptions";
import { PlansResource } from "./resources/plans";

export interface MeterFlowOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean>;
  idempotencyKey?: string;
  timeout?: number;
}

export class MeterFlow {
  readonly options: Required<MeterFlowOptions>;

  private _credits?: CreditsResource;
  private _usage?: UsageResource;
  private _subscriptions?: SubscriptionsResource;
  private _plans?: PlansResource;

  constructor(options: MeterFlowOptions) {
    if (!options.apiKey.startsWith("mf_live_") && !options.apiKey.startsWith("mf_test_")) {
      throw new Error("apiKey must start with mf_live_ or mf_test_");
    }
    this.options = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? "https://api.meterflow.com/api/v1",
      timeout: options.timeout ?? 30_000,
      retries: options.retries ?? 3,
      fetch: options.fetch ?? globalThis.fetch,
    };
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

  /** @internal — used by resource classes only; not part of the public API */
  request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    return httpRequest<T>(this.options, method, path, opts);
  }
}
