import type { MeterFlow } from "../client";
import type { components } from "../types/openapi";

type CreditGrantRequest = components["schemas"]["CreditGrantRequest"];
type CreditDeductRequest = components["schemas"]["CreditDeductRequest"];
type CreditTransactionResponse = components["schemas"]["CreditTransactionResponse"];
type CreditTransactionPage = components["schemas"]["CreditTransactionPage"];
type CreditBalanceResponse = components["schemas"]["CreditBalanceResponse"];

export interface GrantOptions {
  idempotencyKey?: string;
}

export interface DeductOptions {
  idempotencyKey?: string;
}

/** One page of a list: how many rows, and where to carry on from. */
export interface PageQuery {
  limit?: number;
  /** `next_cursor` from the previous page; omit it, or pass null, for the first page. */
  cursor?: string | null;
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

  /**
   * One page of the customer's ledger, newest first.
   *
   * The ledger grows with every charge, so it is read a page at a time: `data` holds the rows and
   * `next_cursor` the mark for the page after this one (`null` on the last). Pass it back as
   * `cursor` unchanged — it is opaque, and nothing but this API reads it.
   */
  transactions(customerId: string, query?: PageQuery): Promise<CreditTransactionPage> {
    return this.client.request<CreditTransactionPage>("GET", `credits/${encodeURIComponent(customerId)}/transactions`, {
      ...(query !== undefined && { query: query as Record<string, string | number | boolean> }),
    });
  }
}
