/**
 * NanoCart Admin API client for the MCP server.
 *
 * Security invariants (do not weaken):
 *  - The API key is held per-request context, never logged, never returned in output.
 *  - Every store-shaped payload passes through redact() before leaving a tool.
 */

export const API_BASE = process.env.NANOCART_API_URL || 'https://api.nanocart.io';

export interface Ctx {
  apiKey: string;
  storeId?: string;
}

export class NanoCartError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Keys that must never appear in tool output, at any nesting depth. */
const SECRET_KEYS = new Set([
  'apiKey', 'hashedApiKey',
  'stripeSecretKey', 'stripeWebhookSecret', 'stripeTestSecretKey', 'stripeTestWebhookSecret',
  'paypalSecret', 'paypalSandboxSecret',
  'printfulApiKey', 'printifyApiKey',
  'stripeTaxRateIds',
]);

export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k)) continue;
      out[k] = redact(v);
    }
    return out as unknown as T;
  }
  return value;
}

export async function api(
  ctx: Ctx,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<any> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url, {
    method,
    headers: {
      'x-api-key': ctx.apiKey,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data: any = {};
  try {
    data = await resp.json();
  } catch {
    /* non-JSON body */
  }
  if (!resp.ok) {
    const msg =
      resp.status === 401
        ? 'Invalid or missing NanoCart API key. Check NANOCART_API_KEY (or the Authorization header for the hosted server).'
        : resp.status === 403 && data?.code === 'TIER_SHIPPING_RESTRICTED'
          ? data.error
          : data?.error || data?.message || `NanoCart API error (HTTP ${resp.status})`;
    throw new NanoCartError(resp.status, msg, data?.code);
  }
  return data;
}

/**
 * Validate the (apiKey, storeId) pair and assemble store info. The store-list
 * endpoint is Cognito-only at the gateway, so the store ID must be provided
 * (env NANOCART_STORE_ID locally; ?store= or X-Store-Id on the hosted server).
 */
export async function resolveStore(ctx: Ctx): Promise<{ storeId: string; store: any }> {
  if (!ctx.storeId) {
    throw new NanoCartError(
      400,
      'Store ID is required. Locally: set NANOCART_STORE_ID. Hosted: add ?store=your-store-id to the MCP URL (or send an X-Store-Id header). It is shown in your dashboard under Settings → Store Information.',
    );
  }
  // Validates that the key belongs to this store (401/403 otherwise).
  const tier = await api(ctx, 'GET', `/shop/${ctx.storeId}/admin/tier`);
  let storefront: any = null;
  try {
    storefront = await publicApi(`/shop/${ctx.storeId}/storefront-config`);
  } catch {
    /* widget-only stores have no storefront config */
  }
  const store = redact({
    storeId: ctx.storeId,
    tier: tier.tier,
    limits: tier.limits,
    usage: tier.usage,
    hostedTier: tier.hostedTier,
    storefront: storefront || undefined,
  });
  return { storeId: ctx.storeId, store };
}

/** Public (unauthenticated) API — used for category reads and verification. */
export async function publicApi(path: string, query?: Record<string, string | number | undefined>): Promise<any> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new NanoCartError(resp.status, data?.error || `NanoCart API error (HTTP ${resp.status})`);
  return data;
}
