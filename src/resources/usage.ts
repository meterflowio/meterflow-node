import type { MeterFlow } from "../client";
import { PayloadTooLargeError } from "../errors";
import type { components } from "../types/openapi";

type UsageEventRequest = components["schemas"]["UsageEventRequest"];
type UsageEventResponse = components["schemas"]["UsageEventResponse"];
type UsageSummaryResponse = components["schemas"]["UsageSummaryResponse"];

export interface RecordOptions {
  idempotencyKey?: string;
}

export interface SummaryQuery {
  meter_id?: string;
  from_?: string;
  to?: string;
}

/**
 * The API refuses a batch above this with 413. The SDK checks it before sending so an oversized
 * batch fails instantly, offline, with the same `PayloadTooLargeError` — and it does NOT split
 * the batch for you: one call is one request with one idempotency key, and silently turning it
 * into N requests would leave partial success indistinguishable from failure. Chunk at the call
 * site, where you can pick a key per chunk.
 */
export const MAX_BATCH_EVENTS = 500;

export class UsageResource {
  constructor(private readonly client: MeterFlow) {}

  record(body: UsageEventRequest, opts?: RecordOptions): Promise<UsageEventResponse> {
    return this.client.request<UsageEventResponse>("POST", "usage/events", {
      body,
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
  }

  /** Record up to `MAX_BATCH_EVENTS` events in one request. Larger arrays are rejected locally, never sent. */
  recordBatch(events: UsageEventRequest[], opts?: RecordOptions): Promise<UsageEventResponse[]> {
    if (events.length > MAX_BATCH_EVENTS) {
      return Promise.reject(
        new PayloadTooLargeError(`A batch may contain at most ${MAX_BATCH_EVENTS} events; this one has ${events.length}. Split it.`),
      );
    }
    return this.client.request<UsageEventResponse[]>("POST", "usage/events/batch", {
      body: { events },
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
  }

  summary(customerId: string, query?: SummaryQuery): Promise<UsageSummaryResponse> {
    return this.client.request<UsageSummaryResponse>("GET", `usage/${encodeURIComponent(customerId)}`, {
      ...(query !== undefined && { query: query as Record<string, string | number | boolean> }),
    });
  }
}
