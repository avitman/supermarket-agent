import { useEffect, useState } from 'react';

interface ProductComparison {
  barcode: string;
  name: string;
  image_url: string | null;
  category: string | null;
  our_price: number | null;
  chains: Record<string, number>;
  recorded_at: string;
}

interface CompareResponse {
  products: ProductComparison[];
  last_sync: string | null;
}

const CHAIN_LABELS: Record<string, string> = {
  shufersal: 'שופרסל',
  rami_levy: 'רמי לוי',
  carrefour: 'קרפור',
  victory: 'ויקטורי',
  osher_ad: 'אושר עד',
};

function chainLabel(chain: string) {
  return CHAIN_LABELS[chain] ?? chain;
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

function ProductImage({ url, name }: { url: string | null; name: string }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-300 text-lg shrink-0">🛒</div>;
  }
  return <img src={url} alt={name} className="w-10 h-10 object-contain rounded-lg shrink-0" onError={() => setErr(true)} />;
}

export default function PricesPage() {
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  function load() {
    setLoading(true);
    fetch('/api/prices/compare')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function runSync() {
    setSyncing(true);
    setError(null);
    setSyncErrors({});
    try {
      const r = await fetch('/api/prices/sync', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Sync failed');
      if (j.errors && Object.keys(j.errors).length) setSyncErrors(j.errors);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }

  const products = data?.products ?? [];
  const filtered = search
    ? products.filter(p => p.name.includes(search) || p.barcode.includes(search))
    : products;

  // All chains across all products
  const allChains = [...new Set(products.flatMap(p => Object.keys(p.chains)))].sort();

  // Summary stats
  const withOurPrice = products.filter(p => p.our_price != null);
  const totalSavings = withOurPrice.reduce((sum, p) => {
    const cheapest = Math.min(...Object.values(p.chains));
    return sum + Math.max(0, (p.our_price ?? 0) - cheapest);
  }, 0);

  const cheapestCounts: Record<string, number> = {};
  for (const p of products) {
    if (!Object.keys(p.chains).length) continue;
    const minPrice = Math.min(...Object.values(p.chains));
    const winners = Object.entries(p.chains).filter(([, v]) => v === minPrice).map(([k]) => k);
    for (const w of winners) cheapestCounts[w] = (cheapestCounts[w] ?? 0) + 1;
  }
  const bestChain = Object.entries(cheapestCounts).sort((a, b) => b[1] - a[1])[0];

  return (
    <div dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">השוואת מחירים</h1>
          {data?.last_sync && (
            <p className="text-xs text-gray-400 mt-0.5">
              עדכון אחרון: {new Date(data.last_sync).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {filtered.length > 0 && (
            <button
              onClick={() => exportCsv('price-comparison.csv', filtered.map(p => {
                const row: Record<string, unknown> = { שם: p.name, ברקוד: p.barcode, 'מחיר שלנו': p.our_price ?? '' };
                for (const chain of allChains) row[chainLabel(chain)] = p.chains[chain] ?? '';
                const cheapest = Object.keys(p.chains).reduce((a, b) => p.chains[a] < p.chains[b] ? a : b, '');
                row['הזול ביותר'] = chainLabel(cheapest);
                row['חיסכון פוטנציאלי'] = p.our_price != null ? Math.max(0, p.our_price - Math.min(...Object.values(p.chains))).toFixed(2) : '';
                return row;
              }))}
              className="px-3 py-2 text-sm font-medium rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              ⬇ CSV
            </button>
          )}
          <button
            onClick={runSync}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium rounded bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {syncing ? '⏳ מעדכן מחירים...' : '🔄 עדכן מחירים'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {Object.keys(syncErrors).length > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-100 rounded-lg text-sm text-yellow-700">
          <p className="font-medium mb-1">שגיאות חלקיות בסנכרון:</p>
          {Object.entries(syncErrors).map(([chain, msg]) => (
            <p key={chain}>{chainLabel(chain)}: {msg}</p>
          ))}
        </div>
      )}

      {/* KPIs */}
      {products.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">מוצרים שהושוו</p>
            <p className="text-2xl font-bold text-orange-500">{products.length}</p>
          </div>
          <div className="bg-green-50 rounded-xl border border-green-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">חיסכון פוטנציאלי</p>
            <p className="text-2xl font-bold text-green-600">₪{totalSavings.toFixed(0)}</p>
            <p className="text-xs text-gray-400">לעומת המחיר שלנו</p>
          </div>
          <div className="bg-blue-50 rounded-xl border border-blue-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">הזול ביותר בממוצע</p>
            <p className="text-2xl font-bold text-blue-600">{bestChain ? chainLabel(bestChain[0]) : '—'}</p>
            <p className="text-xs text-gray-400">{bestChain ? `זול ב-${bestChain[1]} מוצרים` : ''}</p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">טוען...</p>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-4xl mb-3">🏷️</p>
          <p className="text-gray-600 font-medium mb-1">אין נתוני מחירים עדיין</p>
          <p className="text-gray-400 text-sm mb-4">לחץ על "עדכן מחירים" כדי לשלוף מחירים משופרסל ורמי לוי</p>
          <button
            onClick={runSync}
            disabled={syncing}
            className="px-5 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            {syncing ? '⏳ מעדכן...' : '🔄 עדכן מחירים'}
          </button>
          <p className="text-xs text-gray-300 mt-3">הסנכרון מוריד קבצי XML גדולים — עלול לקחת 1-3 דקות</p>
        </div>
      ) : (
        <>
          <input
            type="text"
            placeholder="חיפוש מוצר..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full mb-4 px-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300"
          />

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-right">מוצר</th>
                  <th className="px-4 py-3 text-right">בול מרקט</th>
                  {allChains.map(chain => (
                    <th key={chain} className="px-4 py-3 text-right">{chainLabel(chain)}</th>
                  ))}
                  <th className="px-4 py-3 text-right">הזול ביותר</th>
                  <th className="px-4 py-3 text-right">חיסכון</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const chainPrices = Object.values(p.chains);
                  const minPrice = chainPrices.length ? Math.min(...chainPrices) : null;
                  const maxPrice = chainPrices.length ? Math.max(...chainPrices) : null;
                  const cheapestChain = minPrice != null
                    ? Object.entries(p.chains).find(([, v]) => v === minPrice)?.[0]
                    : null;
                  const savings = p.our_price != null && minPrice != null
                    ? p.our_price - minPrice
                    : null;

                  return (
                    <tr key={p.barcode} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProductImage url={p.image_url} name={p.name} />
                          <div>
                            <p className="font-medium text-gray-800 max-w-xs truncate">{p.name}</p>
                            {p.category && <p className="text-xs text-gray-400">{p.category}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-700">
                        {p.our_price != null ? `₪${p.our_price.toFixed(2)}` : '—'}
                      </td>
                      {allChains.map(chain => {
                        const price = p.chains[chain];
                        const isCheapest = price != null && price === minPrice;
                        const isMostExpensive = price != null && price === maxPrice && minPrice !== maxPrice;
                        return (
                          <td key={chain} className={`px-4 py-3 font-semibold ${
                            price == null ? 'text-gray-300' :
                            isCheapest ? 'text-green-600' :
                            isMostExpensive ? 'text-red-400' :
                            'text-gray-700'
                          }`}>
                            {price != null ? `₪${price.toFixed(2)}` : '—'}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3">
                        {cheapestChain ? (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
                            {chainLabel(cheapestChain)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {savings != null ? (
                          <span className={savings > 0 ? 'text-green-600' : savings < 0 ? 'text-red-500' : 'text-gray-400'}>
                            {savings > 0 ? `−₪${savings.toFixed(2)}` : savings < 0 ? `+₪${Math.abs(savings).toFixed(2)}` : '—'}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
