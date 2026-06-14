# 🛒 Supermarket Agent

An automated grocery intelligence dashboard for Israeli supermarket shopping. Scrapes your Bullmarket (shopo.co.il) order history, stores it in Supabase, visualizes spending patterns, and compares your purchased products against live prices from competing chains using Israel's mandatory Price Transparency Law feeds.

![Dashboard](https://img.shields.io/badge/stack-Node.js%20%7C%20React%20%7C%20Supabase-orange)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

### 📊 Dashboard
- Monthly spending trend (area chart)
- Category breakdown (donut chart)
- Top purchased products with images
- Order supply health — supplied vs. missing vs. alternative items
- Orders by day of week
- **Top products that were never supplied** (out-of-stock frequency)
- All charts are expandable to full screen and exportable to CSV

### 📦 Orders
- Full order history list with status, item count, and totals
- Drill into any order to see every line item with product images, status badges, and sale prices
- CSV export

### 🏷️ Price Comparison
- Fetches live prices from Israeli chain XML feeds (Price Transparency Law)
- Compares your purchased products across **Shufersal** and **Rami Levy** (expandable to more chains)
- Highlights cheapest and most expensive options per product
- Shows potential savings vs. what you paid at Bullmarket
- CSV export

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20, Express 5, TypeScript |
| Scraping | Playwright (headless Chromium, Bearer token capture) |
| Price feeds | Israeli Price Transparency Law XML feeds (Shufersal Direct, Cerberus/PublishedPrices) |
| Frontend | React 18, Vite, TailwindCSS, Recharts |
| Database | Supabase (PostgreSQL) |
| XML parsing | fast-xml-parser |

---

## Architecture

```
supermarket-agent/
├── backend/
│   └── src/
│       ├── routes/
│       │   ├── orders.ts        # GET /api/orders, GET /api/orders/:id
│       │   ├── stats.ts         # GET /api/stats (dashboard aggregations)
│       │   ├── sync.ts          # POST /api/sync/orders
│       │   └── prices.ts        # POST /api/prices/sync, GET /api/prices/compare
│       ├── services/
│       │   ├── supabase.ts      # Supabase client singleton
│       │   ├── sync.ts          # Order upsert logic
│       │   └── priceComparison.ts  # Shufersal + Cerberus XML feed fetcher
│       └── scripts/
│           ├── fetch-orders-api.ts  # Bullmarket API scraper (Playwright)
│           └── sync-orders.ts       # CLI entry point
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── DashboardPage.tsx
│       │   ├── OrdersPage.tsx
│       │   ├── OrderDetailPage.tsx
│       │   └── PricesPage.tsx
│       └── App.tsx
└── supabase/
    └── migrations/
```

---

## Data Model

```sql
orders              -- order header (date, status, total, delivery fee)
order_items         -- line items (product, qty ordered/received, price, status)
products            -- canonical product registry (barcode, name, category, image)
price_snapshots     -- live prices per product per chain (from XML feeds)
```

Item statuses: `supplied` | `alternative` | `out_of_stock` | `substituted`

---

## How the Scraper Works

Bullmarket's web app (Angular) fetches order data from an internal REST API using a `Bearer` token. The scraper:

1. Opens the orders page in a headless Chromium browser (Playwright)
2. Intercepts the outgoing `Authorization: Bearer <token>` header
3. Reuses that token to paginate through all orders via direct API calls
4. Navigates to each order's detail page to capture the full item list
5. Upserts everything to Supabase

Session state is saved to `.session.json` to avoid re-logging in on subsequent runs.

---

## Price Feed Integration

Under Israel's [Promotion of Competition in Food and Pharma Law (2014)](https://he.wikipedia.org/wiki/חוק_קידום_התחרות_בענפי_המזון_והפארם), chains with 3+ stores must publish daily XML price feeds.

| Chain | Platform | Auth |
|-------|----------|------|
| Shufersal | prices.shufersal.co.il | None (public) |
| Rami Levy | url.publishedprices.co.il (Cerberus) | CSRF + session cookie |
| Carrefour / Mega / Yeinot Bitan | prices.carrefour.co.il | None (public) |

The service downloads a `PriceFull` gzipped XML file, parses it in memory with `fast-xml-parser`, and filters to only the barcodes present in your purchase history.

---

## Local Setup

### Prerequisites
- Node.js 20+
- A [Supabase](https://supabase.com) project
- A Bullmarket account (shopo.co.il)

### 1. Install dependencies

```bash
npm install
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # from Supabase Dashboard → Settings → API
BULLMARKET_EMAIL=your@email.com
BULLMARKET_PASSWORD=yourpassword
PORT=3001
FRONTEND_URL=http://localhost:5173
```

### 3. Apply database migrations

Run the SQL files in `supabase/migrations/` in order via the Supabase Dashboard SQL editor, or with the Supabase CLI:

```bash
npx supabase link --project-ref your-project-ref
npx supabase db push
```

### 4. Start dev servers

```bash
npm run dev   # starts backend on :3001 and frontend on :5173
```

### 5. Sync your orders

Click **🔄 סנכרן** in the dashboard, or run from the terminal:

```bash
cd backend && npm run sync
```

This opens a browser window — log in to Bullmarket if prompted. Session is saved for future runs.

### 6. Compare prices

Navigate to the **השוואת מחירים** tab and click **🔄 עדכן מחירים**. This fetches live prices from Shufersal and Rami Levy for all products in your order history. Allow 1–3 minutes — it downloads and parses large gzipped XML files.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (needed for DB writes) |
| `BULLMARKET_EMAIL` | Login email for shopo.co.il |
| `BULLMARKET_PASSWORD` | Login password for shopo.co.il |
| `PORT` | Backend port (default: 3001) |
| `FRONTEND_URL` | Frontend origin for CORS (default: http://localhost:5173) |

---

## License

MIT
