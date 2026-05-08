import type { MeterFlow } from "../client";
import type { components } from "../types/openapi";

type PlanResponse = components["schemas"]["PlanResponse"];

export interface ListQuery {
  project_id?: string;
}

export class PlansResource {
  constructor(private readonly client: MeterFlow) {}

  list(query?: ListQuery): Promise<PlanResponse[]> {
    return this.client.request<PlanResponse[]>("GET", "plans", {
      ...(query !== undefined && { query: query as Record<string, string | number | boolean> }),
    });
  }

  get(planId: string, query?: ListQuery): Promise<PlanResponse> {
    return this.client.request<PlanResponse>("GET", `plans/${encodeURIComponent(planId)}`, {
      ...(query !== undefined && { query: query as Record<string, string | number | boolean> }),
    });
  }
}
