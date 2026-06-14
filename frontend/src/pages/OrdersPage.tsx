import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Order {
  id: number;
  order_number: string;
  order_date: string;
  delivery_date: string | null;
  status: string;
  total_amount: number;
  delivery_fee: number | null;
  items_supplied_count: number | null;
}

const STATUS_LABEL: Record<string, string> = { '2': 'הושלמה', '3': 'בוטלה', '4': 'בוצעה' };

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(','),
    ...rows.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(',')),
  ].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetch('/api/orders?limit=50')
      .then((r) => r.json())
      .then((j) => setOrders(j.data ?? []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function runSync() {
    setSyncing(true);
    setError(null);
    try {
      const r = await fetch('/api/sync/orders', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Sync failed');
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-800">הזמנות</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCsv('orders.csv', orders.map(o => ({
              'מספר הזמנה': o.order_number,
              'תאריך הזמנה': fmt(o.order_date),
              'תאריך משלוח': o.delivery_date ? fmt(o.delivery_date) : '',
              'סטטוס': STATUS_LABEL[o.status] ?? o.status,
              'פריטים': o.items_supplied_count ?? '',
              'סה"כ': o.total_amount?.toFixed(2) ?? '',
              'משלוח': o.delivery_fee?.toFixed(2) ?? '',
            })))}
            disabled={orders.length === 0}
            className="px-3 py-2 text-sm font-medium rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            ⬇ CSV
          </button>
          <button
            onClick={runSync}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium rounded bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {syncing ? 'מסנכרן...' : '🔄 סנכרן'}
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded p-3">{error}</p>}

      {loading ? (
        <p className="text-gray-400 text-sm">טוען...</p>
      ) : orders.length === 0 ? (
        <p className="text-gray-400 text-sm">אין הזמנות. לחץ על סנכרן.</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-right">מספר</th>
                <th className="px-4 py-3 text-right">תאריך הזמנה</th>
                <th className="px-4 py-3 text-right">תאריך משלוח</th>
                <th className="px-4 py-3 text-right">סטטוס</th>
                <th className="px-4 py-3 text-right">פריטים</th>
                <th className="px-4 py-3 text-right">סה"כ</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => navigate(`/orders/${o.id}`)}
                  className="border-t border-gray-50 hover:bg-orange-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-gray-600">{o.order_number}</td>
                  <td className="px-4 py-3 text-gray-700">{fmt(o.order_date)}</td>
                  <td className="px-4 py-3 text-gray-500">{o.delivery_date ? fmt(o.delivery_date) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{o.items_supplied_count ?? '—'}</td>
                  <td className="px-4 py-3 font-semibold text-gray-800">₪{o.total_amount?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
