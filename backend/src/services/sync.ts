import { getSupabase } from './supabase.js';
import type { ApiOrderDetail, ApiOrderLine } from '../scripts/fetch-orders-api.js';

// ─── Status mapping ───────────────────────────────────────────────────────────
// API status codes observed in the data:
//   2 = item was supplied (or is a substitute — determined by substituteId)
//   3 = out of stock, no substitute
//   4 = out of stock (different sub-type)
//   5 = original item that was replaced by a substitute

type ItemStatus = 'supplied' | 'out_of_stock' | 'alternative' | 'substituted';

function itemStatus(line: ApiOrderLine): ItemStatus {
  if (line.status === 2 && line.substituteId !== null) return 'alternative';
  if (line.status === 3 || line.status === 4) return 'out_of_stock';
  if (line.status === 5) return 'substituted';
  return 'supplied';
}

// ─── Image URL resolver ───────────────────────────────────────────────────────
// API returns Angular template strings like {{size}} and {{extension||'jpg'}}

function resolveImageUrl(images: ApiOrderLine['images'] | undefined): string | null {
  const template = images?.large ?? images?.small ?? images?.medium;
  if (!template) return null;
  return template
    .replace(/\{\{size\}\}/g, 'small')
    .replace(/\{\{[^}]+\|\|'([^']+)'\}\}/g, '$1');
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: string[];
}

export async function syncOrders(orders: ApiOrderDetail[]): Promise<SyncResult> {
  const db = getSupabase();
  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const order of orders) {
    try {
      const subtotal = (order.totalAmount ?? 0) - (order.deliveryFee ?? 0);

      // ── 1. Upsert order row ─────────────────────────────────────────────────
      const { data: orderRow, error: orderErr } = await db
        .from('orders')
        .upsert(
          {
            order_number: String(order.id),
            order_date: order.timePlaced,
            delivery_date: order.shippingTimeTo ?? null,
            status: String(order.statusId),
            delivery_address: [order.addressText, order.city].filter(Boolean).join(', ') || null,
            items_supplied_count: order.lines.filter((l) => l.status === 2 && l.substituteId === null).length,
            subtotal: Number(subtotal.toFixed(2)),
            delivery_fee: order.deliveryFee ?? null,
            vat: order.totalTax ?? null,
            total_amount: order.totalAmount,
            payment_last4: order.paymentData?.mainPayment?.lastFourDigits ?? null,
            payment_installments: order.paymentData?.mainPayment?.paymentsNumber ?? 1,
            raw_html: null,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'order_number' },
        )
        .select('id')
        .single();

      if (orderErr) throw new Error(`orders upsert: ${orderErr.message}`);
      const orderId = (orderRow as { id: number }).id;

      // ── 2. Replace all items (idempotent) ───────────────────────────────────
      const { error: delErr } = await db.from('order_items').delete().eq('order_id', orderId);
      if (delErr) throw new Error(`order_items delete: ${delErr.message}`);

      const itemRows = order.lines.map((line) => {
        const status = itemStatus(line);
        return {
          order_id: orderId,
          source_line_id: line.id,
          product_name: line.name,
          brand: null,
          barcode: line.barcode || null,
          image_url: resolveImageUrl(line.images),
          qty_ordered: line.quantity,
          unit_price_ordered: line.price,
          total_price_ordered: Number((line.quantity * line.price).toFixed(2)),
          qty_received: line.actualQuantity,
          unit_price_received: line.price,
          total_price_received: line.totalPrice ?? null,
          is_on_sale: line.isLineWithSale ?? false,
          original_price: line.regularPrice !== line.price ? line.regularPrice : null,
          sale_price: line.isLineWithSale ? line.price : null,
          item_status: status,
          substitutes_item_id: null, // resolved in step 3
        };
      });

      const { data: insertedItems, error: insertErr } = await db
        .from('order_items')
        .insert(itemRows)
        .select('id, source_line_id');

      if (insertErr) throw new Error(`order_items insert: ${insertErr.message}`);

      // ── 3. Resolve substitute FK links ──────────────────────────────────────
      const substituteLines = order.lines.filter((l) => l.substituteId !== null);
      if (substituteLines.length > 0 && insertedItems) {
        const lineIdToDbId = new Map<number, number>(
          (insertedItems as { id: number; source_line_id: number }[]).map((r) => [r.source_line_id, r.id]),
        );
        for (const line of substituteLines) {
          const originalDbId = lineIdToDbId.get(line.substituteId!);
          const thisDbId = lineIdToDbId.get(line.id);
          if (originalDbId && thisDbId) {
            const { error: linkErr } = await db
              .from('order_items')
              .update({ substitutes_item_id: originalDbId })
              .eq('id', thisDbId);
            if (linkErr) console.warn(`  substitute link failed: ${linkErr.message}`);
          }
        }
      }

      // ── 4. Upsert products ──────────────────────────────────────────────────
      const productRows = order.lines
        .filter((l) => l.barcode)
        .map((l) => ({
          barcode: l.barcode,
          name: l.name,
          brand: null as null,
          category: l.categoryName ?? null,
          image_url: resolveImageUrl(l.images),
          last_seen_at: order.timePlaced,
        }));

      if (productRows.length > 0) {
        const { error: prodErr } = await db
          .from('products')
          .upsert(productRows, { onConflict: 'barcode' });
        if (prodErr) throw new Error(`products upsert: ${prodErr.message}`);
      }

      synced++;
      console.log(`  ✓ ${order.id}: ${order.lines.length} lines → Supabase (order_id=${orderId})`);
    } catch (err) {
      const msg = `Order ${order.id}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`  ✗ ${msg}`);
      skipped++;
    }
  }

  return { synced, skipped, errors };
}
