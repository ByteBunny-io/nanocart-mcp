import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['bin/stdio.js'],
  env: { ...process.env, NANOCART_API_KEY: process.env.TESTKEY, NANOCART_STORE_ID: 'test-tier-store' },
});
const client = new Client({ name: 'e2e', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('TOOLS:', tools.length);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  if (r.isError) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text);
};

const info = await call('get_store_info');
console.log('STORE:', info.storeId, '| tier:', info.tier, '| apiKey leaked:', JSON.stringify(info).includes('sc_live_'));

const tier = await call('get_tier_usage');
console.log('TIER:', tier.tier, 'products', tier.usage?.activeProducts, '/', tier.limits?.maxProducts);

const before = await call('list_products');
console.log('PRODUCTS BEFORE:', before.count);

const created = await call('create_product', { name: 'MCP E2E Test Product', price_cents: 1234, description: 'Created by nanocart-mcp e2e — safe to delete', status: 'draft' });
const pid = created.product.productId;
console.log('CREATED:', pid, created.product.slug, 'price', created.product.price);

const updated = await call('update_product', { productId: pid, price_cents: 2345, name: 'MCP E2E Updated' });
console.log('UPDATED ok');

const after = await call('list_products', { search: 'MCP E2E' });
console.log('FOUND AFTER UPDATE:', after.count, after.products[0]?.name, after.products[0]?.price);

const archived = await call('archive_product', { productId: pid });
console.log('ARCHIVED ok');

const report = await call('sales_report', { from: '2026-07-01' });
console.log('REPORT: revenue', report.totalRevenue, 'orders', report.totalOrders);

await client.close();
console.log('E2E PASS');
