# supermarket-agent

Automated grocery intelligence agent for Israeli supermarket shopping. Retrieves order history from Bullmarket (shopo.co.il), stores data in Supabase, displays a dashboard, and uses the Israeli Grocery Price Intelligence skill to find better deals across competing chains.

## Architecture

```
supermarket-agent/
├── backend/          # Node.js + Express API
│   └── src/
│       ├── scrapers/ # Playwright-based order scraper
│       ├── routes/   # REST endpoints
│       └── services/ # Supabase + price intelligence
├── frontend/         # React + Vite dashboard
│   └── src/
│       ├── pages/    # Dashboard, Orders, Prices
│       └── components/
└── supabase/         # DB migrations
```

## Tech Stack

| Layer     | Technology                              |
|-----------|----------------------------------------|
| Backend   | Node.js 20, Express 5, Playwright      |
| Frontend  | React 18, Vite, TailwindCSS            |
| Database  | Supabase (PostgreSQL)                  |
| Hosting   | Vercel (frontend + serverless backend) |
| Scraping  | Playwright (headless Chromium)         |
| AI skill  | Israeli Grocery Price Intelligence MCP |

## Core Workflows

### 1. Sync Orders
Scrapes Bullmarket order history and upserts into Supabase.
```bash
npm run sync          # from backend/
# or via slash command:
/scrape-orders
```

### 2. Price Comparison
Uses the MCP grocery skill to compare items from your orders against other Israeli chains (Shufersal, Rami Levy, Yeinot Bitan, Carrefour, Victory, Mega).
```bash
/sync-prices
```

### 3. Build Basket (roadmap)
Agent constructs optimal basket minimizing cost across chains, then submits it back to Bullmarket.
```bash
/build-basket
```

## Local Development

```bash
# 1. Install dependencies
npm install           # root
cd backend && npm install
cd frontend && npm install

# 2. Copy env and fill credentials
cp .env.example .env

# 3. Run Supabase migrations
npx supabase db push

# 4. Start dev servers
npm run dev           # starts both backend (3001) and frontend (5173)
```

## Environment Variables

See `.env.example` for all required variables. Store secrets in `.env` (never commit).

## Agents

| Agent             | File                              | Purpose                                 |
|-------------------|-----------------------------------|-----------------------------------------|
| order-scraper     | `.claude/agents/order-scraper.md` | Logs into Bullmarket, extracts orders   |
| price-comparator  | `.claude/agents/price-comparator.md` | Finds cheapest chain per item        |
| basket-builder    | `.claude/agents/basket-builder.md` | Builds and submits optimal basket      |

## Commands

| Command         | File                                 | Purpose                          |
|-----------------|--------------------------------------|----------------------------------|
| /scrape-orders  | `.claude/commands/scrape-orders.md`  | Run order sync                   |
| /sync-prices    | `.claude/commands/sync-prices.md`    | Update price intelligence        |
| /build-basket   | `.claude/commands/build-basket.md`   | Build optimized shopping basket  |

## MCP Skill

The `.mcp.json` configures the **Israeli Grocery Price Intelligence** skill (v1.4.0).
It parses XML price feeds from major Israeli chains under the mandatory Price Transparency Law.

Supported chains: Shufersal, Rami Levy, Yeinot Bitan, Carrefour, Victory, Mega.

## Data Model

```
orders
  id, order_number, order_date, status, total_amount, raw_html

order_items
  id, order_id, product_name, barcode, quantity, unit_price, total_price

products
  id, barcode, name, category, last_seen_at

price_snapshots
  id, product_barcode, chain, branch_id, price, recorded_at
```

## Deployment (Vercel)

```bash
vercel --prod         # deploy frontend
cd backend && vercel  # deploy backend as serverless functions
```

Set all env vars in the Vercel project dashboard to match `.env`.
