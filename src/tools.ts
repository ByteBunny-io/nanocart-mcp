/**
 * NanoCart MCP tools. Read tools carry readOnlyHint; anything irreversible carries
 * destructiveHint and a description instructing the agent to confirm with the user.
 * Money-touching operations (refunds, billing) and key management are deliberately
 * NOT exposed — merchants do those in the dashboard.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api, publicApi, redact, resolveStore, Ctx, NanoCartError } from './api.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

type GetCtx = () => Ctx;

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(e: unknown) {
  const msg = e instanceof NanoCartError ? e.message : e instanceof Error ? e.message : String(e);
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

async function sid(ctx: Ctx): Promise<string> {
  if (!ctx.storeId) await resolveStore(ctx);
  return ctx.storeId!;
}

const priceCents = z.number().int().min(0).describe('Price in integer CENTS (e.g. 1999 = $19.99). Never send dollars.');

const variantSchema = z.object({
  name: z.string(),
  price_cents: priceCents,
  sku: z.string().optional(),
  inventory: z.number().int().min(0).nullable().optional().describe('null = untracked/unlimited'),
  optionValues: z.record(z.string()).optional().describe('Axis map, e.g. {"Size":"M","Color":"Navy"}'),
});

function mapVariants(variants?: z.infer<typeof variantSchema>[]) {
  return variants?.map(v => ({
    name: v.name,
    price: v.price_cents,
    sku: v.sku,
    inventory: v.inventory,
    optionValues: v.optionValues,
  }));
}

export function registerTools(server: McpServer, getCtx: GetCtx) {
  const RO = { readOnlyHint: true };
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true };

  // ── Reads ──────────────────────────────────────────────────────────────────
  server.registerTool('get_store_info', {
    description: 'Get the store bound to this API key: name, slug (storeId), tier, domain, currency, configured payment processors, allowed domains. Secrets are never included.',
    annotations: RO,
  }, async () => {
    try { return ok((await resolveStore(getCtx())).store); } catch (e) { return err(e); }
  });

  server.registerTool('get_tier_usage', {
    description: 'Current plan tier, its limits, and live usage (active products, coupons, monthly orders). Check this before bulk-creating products.',
    annotations: RO,
  }, async () => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'GET', `/shop/${await sid(ctx)}/admin/tier`))); } catch (e) { return err(e); }
  });

  server.registerTool('list_products', {
    description: 'List ALL products including drafts and archived. Optionally filter by status or search by name/slug substring (filtering happens client-side).',
    annotations: RO,
    inputSchema: {
      status: z.enum(['active', 'draft', 'archived']).optional(),
      search: z.string().optional().describe('Case-insensitive substring match on name or slug'),
    },
  }, async ({ status, search }) => {
    const ctx = getCtx();
    try {
      const data = await api(ctx, 'GET', `/shop/${await sid(ctx)}/admin/products`);
      let products: any[] = data.products || [];
      if (status) products = products.filter(p => (p.status || 'draft') === status);
      if (search) {
        const q = search.toLowerCase();
        products = products.filter(p => (p.name || '').toLowerCase().includes(q) || (p.slug || '').toLowerCase().includes(q));
      }
      return ok(redact({ count: products.length, products }));
    } catch (e) { return err(e); }
  });

  server.registerTool('list_categories', {
    description: 'List the store’s categories (via the public API).',
    annotations: RO,
  }, async () => {
    const ctx = getCtx();
    try { return ok(await publicApi(`/shop/${await sid(ctx)}/categories`)); } catch (e) { return err(e); }
  });

  server.registerTool('list_orders', {
    description: 'List orders, newest first. Filter by status and/or ISO date range; paginate with limit/lastKey.',
    annotations: RO,
    inputSchema: {
      status: z.enum(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'paid']).optional(),
      from: z.string().optional().describe('ISO date, e.g. 2026-07-01'),
      to: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      lastKey: z.string().optional().describe('Cursor from a previous page'),
    },
  }, async (args) => {
    const ctx = getCtx();
    try {
      return ok(redact(await api(ctx, 'GET', `/shop/${await sid(ctx)}/admin/orders`, undefined, args as any)));
    } catch (e) { return err(e); }
  });

  server.registerTool('list_coupons', {
    description: 'List all coupons with usage counts.',
    annotations: RO,
  }, async () => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'GET', `/shop/${await sid(ctx)}/admin/coupons`))); } catch (e) { return err(e); }
  });

  server.registerTool('list_subscribers', {
    description: 'List email subscribers (Product Alerts). Paginate with limit/lastKey.',
    annotations: RO,
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
      lastKey: z.string().optional(),
    },
  }, async (args) => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'GET', `/shop/${await sid(ctx)}/admin/subscribers`, undefined, args as any))); } catch (e) { return err(e); }
  });

  server.registerTool('get_settings', {
    description: 'Get store settings: shipping_config, tax_config, email_config, order_config.',
    annotations: RO,
  }, async () => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'GET', `/shop/${await sid(ctx)}/admin/settings`))); } catch (e) { return err(e); }
  });

  server.registerTool('get_storefront', {
    description: 'Get hosted-storefront configuration (template, hero, sections). Only meaningful on hosted plans.',
    annotations: RO,
  }, async () => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'GET', `/shop/${await sid(ctx)}/admin/storefront`))); } catch (e) { return err(e); }
  });

  server.registerTool('sales_report', {
    description: 'Sales report for a date range: revenue, orders, AOV, tax collected (total + by state), shipping, discounts, top products.',
    annotations: RO,
    inputSchema: {
      from: z.string().optional().describe('ISO date, default all-time'),
      to: z.string().optional(),
    },
  }, async (args) => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'GET', `/shop/${await sid(ctx)}/admin/reports`, undefined, args as any))); } catch (e) { return err(e); }
  });

  server.registerTool('analytics_funnel', {
    description: 'Cart funnel analytics for a date range: sessions that viewed, added to cart, reached checkout, purchased; abandoned value.',
    annotations: RO,
    inputSchema: { from: z.string().optional(), to: z.string().optional() },
  }, async (args) => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'GET', `/shop/${await sid(ctx)}/admin/analytics`, undefined, args as any))); } catch (e) { return err(e); }
  });

  server.registerTool('list_webhook_deliveries', {
    description: 'Recent signed-webhook delivery attempts and results.',
    annotations: RO,
  }, async () => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'GET', `/shop/${await sid(ctx)}/admin/webhooks/deliveries`))); } catch (e) { return err(e); }
  });

  // ── Writes ─────────────────────────────────────────────────────────────────
  server.registerTool('create_product', {
    description: 'Create a product. Defaults to DRAFT (invisible to shoppers) unless status "active". Prices in integer cents. Upload images first with upload_image and pass the returned fileUrls.',
    annotations: WRITE,
    inputSchema: {
      name: z.string().min(1),
      price_cents: priceCents,
      description: z.string().optional().describe('HTML allowed'),
      status: z.enum(['draft', 'active']).optional(),
      categoryId: z.string().optional(),
      compare_at_price_cents: z.number().int().min(0).optional(),
      inventory: z.number().int().min(0).nullable().optional(),
      images: z.array(z.string().url()).optional(),
      productType: z.enum(['physical', 'digital']).optional(),
      featured: z.boolean().optional(),
      slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).optional(),
      variants: z.array(variantSchema).optional(),
    },
  }, async (args) => {
    const ctx = getCtx();
    try {
      const body: any = {
        name: args.name, price: args.price_cents, description: args.description,
        status: args.status, categoryId: args.categoryId,
        compareAtPrice: args.compare_at_price_cents, inventory: args.inventory,
        images: args.images, productType: args.productType, featured: args.featured,
        slug: args.slug, tags: args.tags, options: args.options,
        variants: mapVariants(args.variants),
      };
      Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
      return ok(redact(await api(ctx, 'POST', `/shop/${await sid(ctx)}/admin/products`, body)));
    } catch (e) { return err(e); }
  });

  server.registerTool('update_product', {
    description: 'Update any fields of an existing product by productId (partial update). Prices in integer cents.',
    annotations: WRITE,
    inputSchema: {
      productId: z.string(),
      name: z.string().optional(),
      price_cents: priceCents.optional(),
      description: z.string().optional(),
      status: z.enum(['draft', 'active']).optional(),
      categoryId: z.string().optional(),
      compare_at_price_cents: z.number().int().min(0).optional(),
      inventory: z.number().int().min(0).nullable().optional(),
      images: z.array(z.string().url()).optional(),
      featured: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).optional(),
      variants: z.array(variantSchema).optional(),
    },
  }, async (args) => {
    const ctx = getCtx();
    try {
      const body: any = {
        productId: args.productId, name: args.name, price: args.price_cents,
        description: args.description, status: args.status, categoryId: args.categoryId,
        compareAtPrice: args.compare_at_price_cents, inventory: args.inventory,
        images: args.images, featured: args.featured, tags: args.tags,
        options: args.options, variants: mapVariants(args.variants),
      };
      Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
      return ok(redact(await api(ctx, 'PUT', `/shop/${await sid(ctx)}/admin/products`, body)));
    } catch (e) { return err(e); }
  });

  server.registerTool('archive_product', {
    description: 'Archive (soft-delete) a product — it disappears from the store but stays in the database. CONFIRM WITH THE USER before calling; name the product, not just the id.',
    annotations: DESTRUCTIVE,
    inputSchema: { productId: z.string() },
  }, async ({ productId }) => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'DELETE', `/shop/${await sid(ctx)}/admin/products`, { productId }))); } catch (e) { return err(e); }
  });

  server.registerTool('create_category', {
    description: 'Create a category. parentId makes it a subcategory.',
    annotations: WRITE,
    inputSchema: {
      name: z.string().min(1),
      description: z.string().optional(),
      image: z.string().url().optional(),
      parentId: z.string().optional(),
      sortOrder: z.number().int().optional(),
    },
  }, async (args) => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'POST', `/shop/${await sid(ctx)}/admin/categories`, args))); } catch (e) { return err(e); }
  });

  server.registerTool('update_category', {
    description: 'Update a category by categoryId (partial).',
    annotations: WRITE,
    inputSchema: {
      categoryId: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      image: z.string().url().optional(),
      parentId: z.string().optional(),
      sortOrder: z.number().int().optional(),
      status: z.enum(['active', 'hidden']).optional(),
    },
  }, async (args) => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'PUT', `/shop/${await sid(ctx)}/admin/categories`, args))); } catch (e) { return err(e); }
  });

  server.registerTool('create_coupon', {
    description: 'Create a coupon. value = 1-100 for percent_off, integer cents for fixed_amount, ignored for free_shipping.',
    annotations: WRITE,
    inputSchema: {
      code: z.string().min(1).describe('Auto-uppercased'),
      type: z.enum(['percent_off', 'fixed_amount', 'free_shipping']),
      value: z.number().int().min(0),
      min_order_cents: z.number().int().min(0).optional(),
      maxUses: z.number().int().min(1).optional(),
      expiresAt: z.string().optional().describe('ISO timestamp'),
    },
  }, async (args) => {
    const ctx = getCtx();
    try {
      const body: any = { code: args.code, type: args.type, value: args.value,
        minOrderAmount: args.min_order_cents, maxUses: args.maxUses, expiresAt: args.expiresAt };
      Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
      return ok(redact(await api(ctx, 'POST', `/shop/${await sid(ctx)}/admin/coupons`, body)));
    } catch (e) { return err(e); }
  });

  server.registerTool('delete_coupon', {
    description: 'Delete a coupon by code. CONFIRM WITH THE USER before calling.',
    annotations: DESTRUCTIVE,
    inputSchema: { code: z.string() },
  }, async ({ code }) => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'DELETE', `/shop/${await sid(ctx)}/admin/coupons`, { code }))); } catch (e) { return err(e); }
  });

  server.registerTool('update_order', {
    description: 'Update an order’s status, tracking number, or notes. Status transitions to "shipped" notify the customer webhook. Allowed statuses: pending, confirmed, processing, shipped, delivered, cancelled, refunded. NOTE: to actually refund money, the merchant must use the dashboard — this tool only changes the label.',
    annotations: WRITE,
    inputSchema: {
      orderId: z.string(),
      status: z.enum(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']).optional(),
      trackingNumber: z.string().optional(),
      notes: z.string().optional(),
    },
  }, async (args) => {
    const ctx = getCtx();
    try {
      const { orderId, ...body } = args;
      return ok(redact(await api(ctx, 'PUT', `/shop/${await sid(ctx)}/admin/orders/${orderId}`, body)));
    } catch (e) { return err(e); }
  });

  server.registerTool('resend_order_confirmation', {
    description: 'Resend the order confirmation email to the customer for an order.',
    annotations: WRITE,
    inputSchema: { orderId: z.string() },
  }, async ({ orderId }) => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'POST', `/shop/${await sid(ctx)}/admin/orders/${orderId}/resend-confirmation`, {}))); } catch (e) { return err(e); }
  });

  server.registerTool('upload_image', {
    description: 'Upload an image (or digital file) to the store’s storage and get back a public fileUrl for product/category images. Provide EITHER file_path (local server only) OR source_url (fetched server-side).',
    annotations: WRITE,
    inputSchema: {
      file_path: z.string().optional().describe('Absolute local path (stdio/local mode only)'),
      source_url: z.string().url().optional().describe('Publicly reachable URL to fetch'),
      file_name: z.string().optional().describe('Defaults to the basename of the path/url'),
      content_type: z.string().optional().describe('e.g. image/jpeg — inferred from extension if omitted'),
      upload_type: z.enum(['product_image', 'category_image', 'storefront_image', 'digital_file']).optional(),
    },
  }, async (args) => {
    const ctx = getCtx();
    try {
      if (!args.file_path && !args.source_url) throw new NanoCartError(400, 'Provide file_path or source_url.');
      let bytes: Buffer;
      let name = args.file_name || '';
      if (args.file_path) {
        bytes = Buffer.from(await readFile(args.file_path));
        name = name || basename(args.file_path);
      } else {
        const r = await fetch(args.source_url!);
        if (!r.ok) throw new NanoCartError(r.status, `Could not fetch source_url (HTTP ${r.status})`);
        bytes = Buffer.from(await r.arrayBuffer());
        name = name || basename(new URL(args.source_url!).pathname) || 'upload';
      }
      const ext = (name.split('.').pop() || '').toLowerCase();
      const ct = args.content_type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', zip: 'application/zip' } as Record<string, string>)[ext] || 'application/octet-stream';
      const presign = await api(ctx, 'POST', `/shop/${await sid(ctx)}/admin/upload-url`, {
        fileName: name,
        contentType: ct,
        uploadType: args.upload_type || 'product_image',
        fileSizeMB: Math.max(0.01, +(bytes.length / (1024 * 1024)).toFixed(2)),
      });
      const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': ct }, body: new Uint8Array(bytes) });
      if (!put.ok) throw new NanoCartError(put.status, `S3 upload failed (HTTP ${put.status})`);
      return ok({ fileUrl: presign.fileUrl, fileName: name, contentType: ct, bytes: bytes.length });
    } catch (e) { return err(e); }
  });

  server.registerTool('update_settings', {
    description: 'Update ONE settings key: shipping_config, tax_config, email_config, or order_config. Read get_settings first and send the full desired value for that key. Tier limits apply to shipping methods.',
    annotations: WRITE,
    inputSchema: {
      settingKey: z.enum(['shipping_config', 'tax_config', 'email_config', 'order_config']),
      value: z.record(z.any()).describe('The complete new value object for that key'),
    },
  }, async ({ settingKey, value }) => {
    const ctx = getCtx();
    try { return ok(redact(await api(ctx, 'PUT', `/shop/${await sid(ctx)}/admin/settings`, { settingKey, value }))); } catch (e) { return err(e); }
  });

  server.registerTool('update_store_config', {
    description: 'Update store display config: name, domain, brandColor, currency, allowedDomains. Payment credentials can NOT be changed here (dashboard only). Changing allowedDomains affects which sites the widget works on — confirm with the user.',
    annotations: WRITE,
    inputSchema: {
      name: z.string().optional(),
      domain: z.string().optional(),
      brandColor: z.string().optional(),
      currency: z.string().length(3).optional(),
      allowedDomains: z.array(z.string()).max(10).optional(),
    },
  }, async (args) => {
    const ctx = getCtx();
    try {
      const body: any = { ...args };
      Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
      if (!Object.keys(body).length) throw new NanoCartError(400, 'Provide at least one field to update.');
      return ok(redact(await api(ctx, 'PUT', `/shop/admin/stores/${await sid(ctx)}`, body)));
    } catch (e) { return err(e); }
  });
}
