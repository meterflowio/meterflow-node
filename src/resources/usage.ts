import type { MeterFlow } from "../client";
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

export class UsageResource {
  constructor(private readonly client: MeterFlow) {}

  record(body: UsageEventRequest, opts?: RecordOptions): Promise<UsageEventResponse> {
    return this.client.request<UsageEventResponse>("POST", "usage/events", {
      body,
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
  }

  recordBatch(events: UsageEventRequest[], opts?: RecordOptions): Promise<UsageEventResponse[]> {
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
