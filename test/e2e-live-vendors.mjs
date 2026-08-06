// v2p12-u63 — live stdio e2e for the vendor tools against prod API.
// Usage: TESTKEY=sc_live_... node test/e2e-live-vendors.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const key = process.env.TESTKEY;
if (!key) { console.error('Set TESTKEY'); process.exit(1); }

const transport = new StdioClientTransport({
  command: 'node', args: ['bin/stdio.js'],
  env: { ...process.env, NANOCART_API_KEY: key, NANOCART_STORE_ID: 'test-tier-store' },
});
const client = new Client({ name: 'e2e-vendors', version: '1.0.0' });
await client.connect(transport);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  if (res.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};

const before = await call('list_vendors');
console.log('list_vendors ok —', before.vendors.length, 'existing');

const created = await call('create_vendor', {
  name: 'MCP E2E Vendor', to: ['success@simulator.amazonses.com'],
  template_html: '<h1>{{store.name}} order {{order.number}}</h1>{{items_table}}',
  notes: 'e2e standing note',
});
const vid = created.vendor.vendorId;
console.log('create_vendor ok —', vid);

// Partial update must preserve the template (read-merge-write)
const updated = await call('update_vendor', { vendorId: vid, status: 'paused' });
if (updated.vendor.templateHtml !== '<h1>{{store.name}} order {{order.number}}</h1>{{items_table}}')
  throw new Error('template NOT preserved on partial update');
if (updated.vendor.status !== 'paused') throw new Error('status not updated');
console.log('update_vendor ok — template preserved, status paused');

const fetched = await call('get_vendor', { vendorId: vid });
if (fetched.vendor.notes !== 'e2e standing note') throw new Error('notes drifted');
console.log('get_vendor ok');

const test = await call('send_vendor_test', { vendorId: vid });
console.log('send_vendor_test ok — sentTo', test.sentTo);

await call('delete_vendor', { vendorId: vid });
const after = await call('list_vendors');
if (after.vendors.some(v => v.vendorId === vid)) throw new Error('vendor not deleted');
console.log('delete_vendor ok');

console.log('E2E VENDORS PASS');
await client.close();
