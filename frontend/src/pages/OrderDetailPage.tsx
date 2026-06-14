import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

interface OrderItem {
  id: number;
  product_name: string;
  barcode: string | null;
  image_url: string | null;
  qty_ordered: number;
  qty_received: number | null;
  unit_price_ordered: number | null;
  total_price_received: number | null;
  is_on_sale: boolean;
  original_price: number | null;
  sale_price: number | null;
  item_status: string;
}

interface Order {
  id: number;
  order_number: string;
  order_date: string;
  delivery_date: string | null;
  delivery_address: string | null;
  status: string;
  total_amount: number;
  delivery_fee: number | null;
  vat: number | null;
  payment_last4: string | null;
  items_supplied_count: number | null;
  order_items: OrderItem[];
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  supplied:    { label: 'סופק',   cls: 'bg-green-100 text-green-700' },
  alternative: { label: 'חלופי',  cls: 'bg-blue-100 text-blue-700' },
  out_of_stock:{ label: 'חסר',   cls: 'bg-red-100 text-red-700' },
  substituted: { label: 'הוחלף', cls: 'bg-gray-100 text-gray-500' },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ItemImage({ url, name }: { url: string | null; name: string }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return (
      <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-xs">
        🛒
      </div>
    );
  }
  return <img src={url} alt={name} className="w-12 h-12 object-contain rounded" onError={() => setErr(true)} />;
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`/api/orders/${id}`)
      .then((r) => { if (!r.ok) throw new Error('הזמנה לא נמצאה'); return r.json(); })
      .then(setOrder)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-gray-400 text-sm" dir="rtl">טוען...</p>;
  if (error || !order) return <p className="text-red-500 text-sm" dir="rtl">{error ?? 'שגיאה'}</p>;

  const items = order.order_items ?? [];
  const filtered = search
    ? items.filter((i) => i.product_name.includes(search) || (i.barcode ?? '').includes(search))
    : items;

  const suppliedCount = items.filter((i) => i.item_status === 'supplied').length;
  const missingCount  = items.filter((i) => i.item_status === 'out_of_stock').length;
  const altCount      = items.filter((i) => i.item_status === 'alternative').length;

  return (
    <div dir="rtl">
      {/* Back */}
      <button onClick={() => navigate('/orders')} className="mb-4 text-sm text-orange-500 hover:underline">
        ← חזרה להזמנות
      </button>

      {/* Order header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-800">הזמנה #{order.order_number}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{fmt(order.order_date)}</p>
            {order.delivery_address && (
              <p className="text-sm text-gray-500 mt-0.5">📍 {order.delivery_address}</p>
            )}
            {order.payment_last4 && (
              <p className="text-sm text-gray-500 mt-0.5">💳 ****{order.payment_last4}</p>
            )}
          </div>
          <div className="text-left">
            <p className="text-2xl font-bold text-gray-800">₪{order.total_amount?.toFixed(2)}</p>
            {order.delivery_fee != null && (
              <p className="text-xs text-gray-400">כולל משלוח ₪{order.delivery_fee?.toFixed(2)}</p>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-4 mt-4 text-sm">
          <span className="px-3 py-1 rounded-full bg-green-50 text-green-700">{suppliedCount} סופקו</span>
          {missingCount > 0 && <span className="px-3 py-1 rounded-full bg-red-50 text-red-700">{missingCount} חסרים</span>}
          {altCount > 0 && <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700">{altCount} חלופיים</span>}
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="חיפוש מוצר..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full mb-4 px-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300"
      />

      {/* Items table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-right">מוצר</th>
              <th className="px-4 py-3 text-right">ברקוד</th>
              <th className="px-4 py-3 text-right">הוזמן</th>
              <th className="px-4 py-3 text-right">סופק</th>
              <th className="px-4 py-3 text-right">מחיר</th>
              <th className="px-4 py-3 text-right">סה"כ</th>
              <th className="px-4 py-3 text-right">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const badge = STATUS_BADGE[item.item_status] ?? { label: item.item_status, cls: 'bg-gray-100 text-gray-600' };
              const isMissing = item.item_status === 'out_of_stock' || item.item_status === 'substituted';
              return (
                <tr key={item.id} className={`border-t border-gray-50 ${isMissing ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <ItemImage url={item.image_url} name={item.product_name} />
                      <span className="font-medium text-gray-800">{item.product_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-400 text-xs">{item.barcode ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{item.qty_ordered}</td>
                  <td className="px-4 py-3 text-gray-600">{item.qty_received ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {item.is_on_sale && item.original_price ? (
                      <span>
                        <span className="line-through text-gray-400 text-xs ml-1">₪{item.original_price}</span>
                        <span className="text-orange-600 font-medium">₪{item.sale_price}</span>
                      </span>
                    ) : (
                      item.unit_price_ordered != null ? `₪${item.unit_price_ordered}` : '—'
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-800">
                    {item.total_price_received != null ? `₪${item.total_price_received.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 py-8 text-sm">לא נמצאו מוצרים</p>
        )}
      </div>
    </div>
  );
}
