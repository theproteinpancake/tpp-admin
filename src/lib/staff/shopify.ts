import "server-only";
import type { OrderContext } from "./database.types";

/**
 * Optional enrichment: when a message mentions an order number, look it up so
 * the task carries the customer's details instead of sending someone to dig
 * through Shopify first.
 *
 * Entirely optional — with no credentials configured, suggestions are still
 * created, just without the order block.
 */
const DEFAULT_API_VERSION = "2026-04";

function config() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const token = process.env.SHOPIFY_ADMIN_TOKEN?.trim();
  if (!domain || !token) return null;

  return {
    domain: domain.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    token,
    version: process.env.SHOPIFY_API_VERSION?.trim() || DEFAULT_API_VERSION,
  };
}

export function shopifyConfigured(): boolean {
  return config() !== null;
}

const ORDER_QUERY = `
  query LookupOrder($q: String!) {
    orders(first: 1, query: $q) {
      edges {
        node {
          name
          email
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          customer { displayName }
          lineItems(first: 10) { edges { node { title quantity } } }
        }
      }
    }
  }
`;

type OrderNode = {
  name: string;
  email: string | null;
  createdAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  currentTotalPriceSet: {
    shopMoney: { amount: string; currencyCode: string };
  } | null;
  customer: { displayName: string | null } | null;
  lineItems: { edges: Array<{ node: { title: string; quantity: number } }> };
};

/** Pull an order by its number, e.g. "2627" or "#2627". */
export async function lookupOrder(
  orderNumber: string,
): Promise<OrderContext | null> {
  const settings = config();
  if (!settings) return null;

  const digits = orderNumber.replace(/[^0-9]/g, "");
  if (!digits) return null;

  try {
    const response = await fetch(
      `https://${settings.domain}/admin/api/${settings.version}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": settings.token,
        },
        body: JSON.stringify({
          query: ORDER_QUERY,
          variables: { q: `name:#${digits}` },
        }),
        // Never let a slow storefront hold up ingestion.
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data?: { orders?: { edges?: Array<{ node: OrderNode }> } };
    };

    const node = payload.data?.orders?.edges?.[0]?.node;
    if (!node) return null;

    const money = node.currentTotalPriceSet?.shopMoney;

    return {
      orderName: node.name,
      customerName: node.customer?.displayName ?? null,
      email: node.email,
      financialStatus: node.displayFinancialStatus,
      fulfillmentStatus: node.displayFulfillmentStatus,
      total: money ? `${money.amount} ${money.currencyCode}` : null,
      placedAt: node.createdAt,
      items: node.lineItems.edges.map(
        (edge) => `${edge.node.quantity}× ${edge.node.title}`,
      ),
    };
  } catch {
    // Enrichment is a nice-to-have; a failure here must not lose the task.
    return null;
  }
}
