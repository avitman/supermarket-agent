-- Price snapshots from the Israeli grocery price transparency feeds
create table price_snapshots (
  id              bigserial primary key,
  product_barcode text        not null references products(barcode),
  chain           text        not null,   -- shufersal | rami_levy | yeinot_bitan | carrefour | victory | mega
  branch_id       text,
  price           numeric(10,2) not null,
  unit_qty        numeric(10,3),          -- e.g. 250 (grams), 1 (unit)
  unit_type       text,                   -- 'gram' | 'ml' | 'unit'
  recorded_at     timestamptz not null default now()
);

create index on price_snapshots(product_barcode, chain, recorded_at desc);

-- Materialised best-price view per product (refreshed after each sync)
create materialized view best_prices as
select distinct on (product_barcode)
  product_barcode,
  chain,
  branch_id,
  price,
  recorded_at
from price_snapshots
order by product_barcode, price asc, recorded_at desc;

create unique index on best_prices(product_barcode);
