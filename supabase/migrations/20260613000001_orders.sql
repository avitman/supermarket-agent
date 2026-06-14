-- Orders from Bullmarket (shopo.co.il)
create table orders (
  id                   bigserial primary key,
  order_number         text        not null unique,
  order_date           timestamptz not null,
  delivery_date        timestamptz,
  status               text        not null,          -- e.g. חויבה, בוטלה, הושלמה
  delivery_address     text,
  items_supplied_count int,
  subtotal             numeric(10,2),
  delivery_fee         numeric(10,2),
  vat                  numeric(10,2),
  total_amount         numeric(10,2),
  payment_last4        text,
  payment_installments int         default 1,
  raw_html             text,
  synced_at            timestamptz not null default now()
);

-- One row per item line on an order
create table order_items (
  id                  bigserial primary key,
  order_id            bigint      not null references orders(id) on delete cascade,

  -- Product identity
  product_name        text        not null,
  brand               text,
  barcode             text,
  image_url           text,

  -- What was ordered
  qty_ordered         numeric(10,3) not null,
  unit_price_ordered  numeric(10,2),
  total_price_ordered numeric(10,2),

  -- What was actually received (null = not yet known / out of stock)
  qty_received        numeric(10,3),
  unit_price_received numeric(10,2),
  total_price_received numeric(10,2),

  -- Sale / promotion
  is_on_sale          boolean     not null default false,
  original_price      numeric(10,2),   -- price before discount
  sale_price          numeric(10,2),   -- discounted price

  -- Item status
  item_status         text        not null default 'supplied',
  -- 'supplied' | 'out_of_stock' | 'alternative' | 'partial'

  -- If this row is a substitute, point to the original item
  substitutes_item_id bigint      references order_items(id),

  -- API's line.id — used internally to resolve substitute FK links on import
  source_line_id      bigint,

  created_at          timestamptz not null default now()
);

create index on order_items(order_id);
create index on order_items(barcode);

-- Canonical product registry (populated as orders are synced)
create table products (
  barcode      text        primary key,
  name         text        not null,
  brand        text,
  category     text,
  image_url    text,
  last_seen_at timestamptz not null default now()
);
