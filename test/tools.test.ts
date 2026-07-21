import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/server.js';
import { redact } from '../src/api.js';

const FETCH = vi.fn();
vi.stubGlobal('fetch', FETCH);

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as any;
}

async function connectedClient() {
  const server = buildServer(() => ({ apiKey: 'sc_live_test', storeId: 'unit-store' }));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

beforeEach(() => FETCH.mockReset());

describe('redact()', () => {
  it('strips secrets at any depth and keeps everything else', () => {
    const dirty = {
      storeId: 's', apiKey: 'sc_live_LEAK', hashedApiKey: 'x',
      stripeSecretKey: 'sk_live_LEAK', stripePublishableKey: 'pk_live_ok',
      nested: { paypalSecret: 'LEAK', printfulApiKey: 'LEAK', name: 'ok' },
      list: [{ stripeTestSecretKey: 'LEAK', slug: 'ok' }],
      tax_config: { enabled: true, stripeTaxRateIds: { live: 'txr' } },
    };
    const clean = JSON.stringify(redact(dirty));
    expect(clean).not.toContain('LEAK');
    expect(clean).not.toContain('txr');
    expect(clean).toContain('pk_live_ok');
    expect(clean).toContain('"name":"ok"');
    expect(clean).toContain('"slug":"ok"');
  });
});

describe('tool registry', () => {
  it('exposes the full catalog with correct annotations', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'analytics_funnel', 'archive_product', 'create_category', 'create_coupon',
      'create_product', 'delete_coupon', 'get_settings', 'get_store_info',
      'get_storefront', 'get_tier_usage', 'list_categories', 'list_coupons',
      'list_orders', 'list_products', 'list_subscribers', 'list_webhook_deliveries',
      'resend_order_confirmation', 'sales_report', 'update_category', 'update_order',
      'update_product', 'update_settings', 'update_store_config', 'upload_image',
    ]);
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));
    expect(byName.list_products.annotations?.readOnlyHint).toBe(true);
    expect(byName.archive_product.annotations?.destructiveHint).toBe(true);
    expect(byName.delete_coupon.annotations?.destructiveHint).toBe(true);
    expect(byName.create_product.annotations?.readOnlyHint).toBe(false);
    // Money/key operations must NOT exist
    expect(names).not.toContain('refund_order');
    expect(names).not.toContain('regenerate_api_key');
  });
});

describe('tool behavior (mocked API)', () => {
  it('get_store_info validates via tier and redacts secrets end-to-end', async () => {
    FETCH.mockResolvedValueOnce(jsonResponse(200, {
      tier: 'pro', limits: { maxProducts: 100 }, usage: { activeProducts: 3 },
      apiKey: 'sc_live_LEAKME',
    }));
    FETCH.mockResolvedValueOnce(jsonResponse(200, { name: 'Unit Store', stripePublishableKey: 'pk_ok' }));
    const client = await connectedClient();
    const res: any = await client.callTool({ name: 'get_store_info', arguments: {} });
    const text = res.content[0].text;
    expect(text).not.toContain('LEAKME');
    expect(text).toContain('unit-store');
    expect(text).toContain('pro');
  });

  it('create_product maps price_cents -> price and rejects non-integer cents', async () => {
    FETCH.mockResolvedValueOnce(jsonResponse(201, { product: { productId: 'p1', slug: 'tee' } }));
    const client = await connectedClient();
    const res: any = await client.callTool({
      name: 'create_product',
      arguments: { name: 'Tee', price_cents: 2400, status: 'active' },
    });
    expect(res.isError).toBeFalsy();
    const [, init] = FETCH.mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(sent.price).toBe(2400);
    expect(sent.price_cents).toBeUndefined();

    const bad: any = await client.callTool({
      name: 'create_product',
      arguments: { name: 'Tee', price_cents: 19.99 },
    }).catch(e => ({ isError: true, content: [{ text: String(e) }] }));
    expect(bad.isError).toBe(true);
  });

  it('list_orders passes filters as query params with the api key header', async () => {
    FETCH.mockResolvedValueOnce(jsonResponse(200, { orders: [], lastKey: null }));
    const client = await connectedClient();
    await client.callTool({ name: 'list_orders', arguments: { status: 'paid', limit: 5 } });
    const [url, init] = FETCH.mock.calls[0];
    expect(String(url)).toContain('/shop/unit-store/admin/orders');
    expect(String(url)).toContain('status=paid');
    expect(String(url)).toContain('limit=5');
    expect(init.headers['x-api-key']).toBe('sc_live_test');
  });

  it('maps 401 to a friendly key error', async () => {
    FETCH.mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' }));
    const client = await connectedClient();
    const res: any = await client.callTool({ name: 'list_coupons', arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('NANOCART_API_KEY');
  });

  it('update_store_config refuses empty updates and never allows key fields', async () => {
    const client = await connectedClient();
    const res: any = await client.callTool({ name: 'update_store_config', arguments: {} });
    expect(res.isError).toBe(true);
    // schema simply has no key fields — verify a smuggled one is stripped by zod
    FETCH.mockResolvedValueOnce(jsonResponse(200, { message: 'ok' }));
    await client.callTool({ name: 'update_store_config', arguments: { name: 'New Name', stripeSecretKey: 'sk_live_x' } as any });
    const [, init] = FETCH.mock.calls.at(-1)!;
    expect(init.body).not.toContain('sk_live_x');
  });
});
