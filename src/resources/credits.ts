import type { MeterFlow } from "../client";
import type { components } from "../types/openapi";

type CreditGrantRequest = components["schemas"]["CreditGrantRequest"];
type CreditDeductRequest = components["schemas"]["CreditDeductRequest"];
type CreditTransactionResponse = components["schemas"]["CreditTransactionResponse"];
type CreditBalanceResponse = components["schemas"]["CreditBalanceResponse"];

export interface GrantOptions {
  idempotencyKey?: string;
}

export interface DeductOptions {
  idempotencyKey?: string;
}

export interface TransactionsQuery {
  page?: number;
  limit?: number;
}

export class CreditsResource {
  constructor(private readonly client: MeterFlow) {}

  grant(body: CreditGrantRequest, opts?: GrantOptions): Promise<CreditTransactionResponse> {
    return this.client.request<CreditTransactionResponse>("POST", "credits/grant", {
      body,
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
  }

  deduct(body: CreditDeductRequest, opts?: DeductOptions): Promise<CreditTransactionResponse> {
    return this.client.request<CreditTransactionResponse>("POST", "credits/deduct", {
      body,
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
  }

  balance(customerId: string): Promise<CreditBalanceResponse> {
    return this.client.request<CreditBalanceResponse>("GET", `credits/${encodeURIComponent(customerId)}/balance`);
  }

  transactions(customerId: string, query?: TransactionsQuery): Promise<CreditTransactionResponse[]> {
    return this.client.request<CreditTransactionResponse[]>("GET", `credits/${encodeURIComponent(customerId)}/transactions`, {
      ...(query !== undefined && { query: query as Record<string, string | number | boolean> }),
    });
  }
}
