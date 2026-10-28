import type { MeterFlow } from "../client";
import type { components } from "../types/openapi";

type CreditGrantRequest = components["schemas"]["CreditGrantRequest"];
type CreditDeductRequest = components["schemas"]["CreditDeductRequest"];
type CreditTransactionResponse = components["schemas"]["CreditTransactionResponse"];
type CreditTransactionPage = components["schemas"]["CreditTransactionPage"];
type CreditBalanceResponse = components["schemas"]["CreditBalanceResponse"];
type CreditReservationRequest = components["schemas"]["CreditReservationRequest"];
type CreditReservationConfirmRequest = components["schemas"]["CreditReservationConfirmRequest"];
type CreditReservationResponse = components["schemas"]["CreditReservationResponse"];

export interface GrantOptions {
  idempotencyKey?: string;
}

export interface DeductOptions {
  idempotencyKey?: string;
}

export interface ReserveOptions {
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

  /** Add credits to a customer's balance; their cached entitlement answers go stale once it lands. */
  async grant(body: CreditGrantRequest, opts?: GrantOptions): Promise<CreditTransactionResponse> {
    const result = await this.client.request<CreditTransactionResponse>("POST", "credits/grant", {
      body,
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
    this.client.entitlementCache?.invalidate(body.customer_external_id);
    return result;
  }

  /** Take credits from a customer's balance; their cached entitlement answers go stale once it lands. */
  async deduct(body: CreditDeductRequest, opts?: DeductOptions): Promise<CreditTransactionResponse> {
    const result = await this.client.request<CreditTransactionResponse>("POST", "credits/deduct", {
      body,
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
    this.client.entitlementCache?.invalidate(body.customer_external_id);
    return result;
  }

  /**
   * Hold credits until you confirm or release them, or `ttl_seconds` (default 300) runs out; the balance stays, `available` drops.
   * Throws `InsufficientCreditsError` (402) when the customer's available credits cannot cover it. Their cached entitlement answers go stale.
   * body: the customer, the amount, how long to hold it, a description and metadata.
   * opts: an idempotency key, so a retried hold is the same hold.
   */
  async reserve(body: CreditReservationRequest, opts?: ReserveOptions): Promise<CreditReservationResponse> {
    const result = await this.client.request<CreditReservationResponse>("POST", "credits/reservations", {
      body,
      ...(opts?.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    });
    this.client.entitlementCache?.invalidate(body.customer_external_id);
    return result;
  }

  /**
   * Take some or all of a hold from the balance, as one `deduct` ledger row, and free the rest. Throws `ConflictError` (409)
   * unless it is still held, `ValidationError` (422) above the amount held. The customer's cached entitlement answers go stale.
   * reservationId: the hold's `id`.
   * body: `amount` to take; the whole hold when left out.
   */
  async confirmReservation(reservationId: string, body: CreditReservationConfirmRequest = {}): Promise<CreditReservationResponse> {
    const result = await this.client.request<CreditReservationResponse>("POST", `credits/reservations/${encodeURIComponent(reservationId)}/confirm`, {
      body,
    });
    this.client.entitlementCache?.invalidate(result.customer_external_id);
    return result;
  }

  /**
   * Free a hold with nothing taken. An expired hold is answered with `status: "expired"`; a confirmed or released one throws
   * `ConflictError` (409). The customer's cached entitlement answers go stale.
   * reservationId: the hold's `id`.
   */
  async releaseReservation(reservationId: string): Promise<CreditReservationResponse> {
    const result = await this.client.request<CreditReservationResponse>("POST", `credits/reservations/${encodeURIComponent(reservationId)}/release`);
    this.client.entitlementCache?.invalidate(result.customer_external_id);
    return result;
  }

  /**
   * One hold and how it ended: `held`, `confirmed`, `released`, or `expired` once held past `expires_at`.
   * reservationId: the hold's `id`.
   */
  reservation(reservationId: string): Promise<CreditReservationResponse> {
    return this.client.request<CreditReservationResponse>("GET", `credits/reservations/${encodeURIComponent(reservationId)}`);
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
