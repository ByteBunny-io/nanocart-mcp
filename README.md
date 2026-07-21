# nanocart-mcp

Official [NanoCart](https://nanocart.io) MCP server — run your store from any
MCP-capable AI agent (Claude Code, Claude Desktop, Cursor, Codex, and friends).
List and update products (with variants and images), manage orders, coupons,
categories, subscribers and settings, and pull sales reports — by asking.

**24 tools.** Reads are marked read-only; destructive tools (archive product,
delete coupon) are annotated so your agent asks before acting. Refunds, billing
changes, and API-key management are deliberately NOT exposed — do those in your
[dashboard](https://portal.nanocart.io).

## Credentials

From your dashboard: **Settings → API Keys** (`sc_live_...`, keep secret) and
**Settings → Store Information** (your store ID). The key grants full admin
access to your store — treat it like a password.

## Option A — Local (recommended)

Claude Code:
```bash
claude mcp add nanocart --env NANOCART_API_KEY=sc_live_... --env NANOCART_STORE_ID=your-store-id -- npx -y nanocart-mcp
```

Any client that speaks stdio MCP (JSON config style):
```json
{
  "mcpServers": {
    "nanocart": {
      "command": "npx",
      "args": ["-y", "nanocart-mcp"],
      "env": {
        "NANOCART_API_KEY": "sc_live_...",
        "NANOCART_STORE_ID": "your-store-id"
      }
    }
  }
}
```

## Option B — Hosted (no install)

Endpoint: `https://mcp.nanocart.io/mcp?store=your-store-id` with header
`Authorization: Bearer sc_live_...` (Streamable HTTP).

Claude Code:
```bash
claude mcp add nanocart --transport http "https://mcp.nanocart.io/mcp?store=your-store-id" --header "Authorization: Bearer sc_live_..."
```

Note: web clients that only support OAuth-based custom connectors (e.g.
claude.ai's connector UI) can't send API-key headers yet — use Option A there.

## Example prompts

- "List my draft products and publish the ones with images"
- "Create a SUMMER20 coupon — 20% off, min order $50, expires end of August"
- "What did I sell last week? Any orders I still need to ship?"
- "Mark order NCT-1042 shipped with tracking 9400 1000 0000 0000 0000 00"
- "Upload the photos in ./shots and create products from them at $24 each"

## Safety

- Secrets are redacted from every response; your key is never echoed or logged.
- Destructive tools carry MCP `destructiveHint` annotations — well-behaved
  clients prompt before running them.
- Prices are explicit `price_cents` integers (no dollars/cents ambiguity).

Pairs with the [NanoCart skill](https://github.com/ByteBunny-io/nanocart-skill)
(integration knowledge for building the cart into websites). Docs:
https://docs.nanocart.io/#ai-build · AI-readable: https://docs.nanocart.io/llms-full.txt

MIT · © 2026 NanoCart · a ByteBunny, LLC company
