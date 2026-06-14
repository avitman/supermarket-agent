-- Add unique constraint to support upsert by (product_barcode, chain)
alter table price_snapshots
  add constraint price_snapshots_barcode_chain_unique unique (product_barcode, chain);
