import type { MeterFlow } from "../client";
import type { components } from "../types/openapi";

type PortalLinkRequest = components["schemas"]["PortalLinkRequest"];
type PortalLinkResponse = components["schemas"]["PortalLinkResponse"];

export class PortalResource {
  constructor(private readonly client: MeterFlow) {}

  /**
   * Mint a link to the hosted balance page for one of your customers.
   *
   * Call this from **your** server and send the `url` to that customer — it carries a short-lived
   * token that can read their balance and their ledger and nothing else, in the environment of the
   * key you called with. It is never your API key, and it can write nothing.
   *
   * The page shows the balance and sends "buy more" to your own checkout (`topup_url`): MeterFlow
   * never takes the payment. `expires_in_minutes` defaults to 60 and may not exceed 1440.
   *
   * The two reads behind the page are **not** on this client by design: they belong to the person
   * holding the link, and this client holds a secret key.
   */
  createSession(body: PortalLinkRequest): Promise<PortalLinkResponse> {
    return this.client.request<PortalLinkResponse>("POST", "portal/sessions", { body });
  }
}
