import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  totalOrders: number; totalSpent: number; avgOrderValue: number;
  totalDeliveryFees: number; totalItemLines: number;
  suppliedCount: number; missingCount: number; altCount: number; totalSaved: number;
}
interface MonthlyEntry  { month: string; label: string; total: number; count: number }
interface CategoryEntry { category: string; total: number; count: number }
interface ProductEntry  {
  barcode: string; name: string; image_url: string | null;
  orderCount: number; totalQty: number; totalSpent: number; category: string | null;
}
interface HealthEntry { order_number: string; date: string; supplied: number; missing: number; alternative: number }
interface DowEntry    { day: string; count: number }
interface MissingProductEntry { barcode: string; name: string; image_url: string | null; count: number; category: string | null }
interface Stats {
  summary: Summary;
  monthlySpending: MonthlyEntry[];
  categoryBreakdown: CategoryEntry[];
  topProducts: ProductEntry[];
  orderHealth: HealthEntry[];
  ordersByDow: DowEntry[];
  topMissingProducts: MissingProductEntry[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PIE_COLORS = ['#f97316','#fb923c','#fbbf24','#34d399','#38bdf8','#818cf8','#f472b6','#a78bfa'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shekel(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

// ─── ExpandableChart wrapper ──────────────────────────────────────────────────

function ExpandableChart({
  title, className = '', onExport,
  renderChart,
}: {
  title: string;
  className?: string;
  onExport?: () => void;
  renderChart: (height: number) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  // Close on Escape
  const onKey = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); }, []);
  useEffect(() => {
    if (expanded) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, onKey]);

  const actions = (
    <div className="flex items-center gap-1">
      {onExport && (
        <button
          onClick={onExport}
          title="ייצוא CSV"
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-xs"
        >
          ⬇ CSV
        </button>
      )}
      <button
        onClick={() => setExpanded(true)}
        title="הגדל"
        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
      >
        ⛶
      </button>
    </div>
  );

  return (
    <>
      <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
          {actions}
        </div>
        {renderChart(220)}
      </div>

      {expanded && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={() => setExpanded(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
              <div className="flex items-center gap-2">
                {onExport && (
                  <button onClick={onExport} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                    ⬇ ייצוא CSV
                  </button>
                )}
                <button onClick={() => setExpanded(false)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg text-xl leading-none">
                  ✕
                </button>
              </div>
            </div>
            {renderChart(520)}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = 'orange', icon }: {
  label: string; value: string; sub?: string; color?: string; icon: string;
}) {
  const styles: Record<string, { bg: string; text: string }> = {
    orange: { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-600' },
    green:  { bg: 'bg-green-50 border-green-200',   text: 'text-green-600'  },
    blue:   { bg: 'bg-blue-50 border-blue-200',     text: 'text-blue-600'   },
    red:    { bg: 'bg-red-50 border-red-200',       text: 'text-red-600'    },
    purple: { bg: 'bg-purple-50 border-purple-200', text: 'text-purple-600' },
  };
  const { bg, text } = styles[color] ?? styles.orange;
  return (
    <div className={`rounded-2xl border p-5 flex items-start gap-4 ${bg}`}>
      <span className="text-3xl">{icon}</span>
      <div>
        <p className="text-xs text-gray-500 font-medium mb-0.5">{label}</p>
        <p className={`text-2xl font-bold ${text}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function ProductRow({ p, rank }: { p: ProductEntry; rank: number }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs font-bold text-gray-300 w-5 shrink-0">{rank}</span>
      {p.image_url && !imgErr ? (
        <img src={p.image_url} alt={p.name} className="w-10 h-10 object-contain rounded-lg shrink-0" onError={() => setImgErr(true)} />
      ) : (
        <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-300 shrink-0 text-lg">🛒</div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
        <p className="text-xs text-gray-400">{p.category ?? ''}</p>
      </div>
      <div className="text-left shrink-0">
        <p className="text-sm font-bold text-gray-700">{p.orderCount}×</p>
        <p className="text-xs text-gray-400">{shekel(p.totalSpent)}</p>
      </div>
    </div>
  );
}

function MissingProductRow({ p, rank }: { p: MissingProductEntry; rank: number }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs font-bold text-gray-300 w-5 shrink-0">{rank}</span>
      {p.image_url && !imgErr ? (
        <img src={p.image_url} alt={p.name} className="w-10 h-10 object-contain rounded-lg shrink-0" onError={() => setImgErr(true)} />
      ) : (
        <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-300 shrink-0 text-lg">🚫</div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
        <p className="text-xs text-gray-400">{p.category ?? ''}</p>
      </div>
      <span className="text-sm font-bold text-red-500 shrink-0">{p.count}×</span>
    </div>
  );
}

const AreaTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-4 py-3 text-sm">
      <p className="text-gray-500 text-xs mb-1">{label}</p>
      <p className="font-bold text-orange-600">{shekel(payload[0].value)}</p>
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats, setStats]     = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  function load() {
    setLoading(true);
    fetch('/api/stats')
      .then(r => r.json()).then(setStats)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function runSync() {
    setSyncing(true);
    try { await fetch('/api/sync/orders', { method: 'POST' }); load(); }
    catch (e) { setError(String(e)); }
    finally { setSyncing(false); }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">טוען...</div>;
  if (error || !stats) return <p className="text-red-500 text-sm">{error ?? 'שגיאה'}</p>;

  const { summary: s, monthlySpending, categoryBreakdown, topProducts, orderHealth, ordersByDow, topMissingProducts } = stats;
  const supplyRate = Math.round((s.suppliedCount / (s.totalItemLines || 1)) * 100);

  // Thin out X-axis: show ~6 labels max over 21 months
  const xInterval = Math.max(1, Math.ceil(monthlySpending.length / 6));

  return (
    <div dir="rtl" className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">לוח בקרה</h1>
          <p className="text-sm text-gray-400 mt-0.5">{s.totalOrders} הזמנות · כל הזמנים</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (!stats) return;
              exportCsv('orders-summary.csv', monthlySpending.map(m => ({
                חודש: m.label, הוצאות: m.total, הזמנות: m.count,
              })));
            }}
            className="px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm"
          >
            ⬇ ייצוא CSV
          </button>
          <button onClick={runSync} disabled={syncing}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 shadow-sm"
          >
            {syncing ? '⏳ מסנכרן...' : '🔄 סנכרן'}
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard icon="🧾" label="סה״כ הוצאות"   value={shekel(s.totalSpent)}      sub={`${s.totalOrders} הזמנות`}          color="orange" />
        <KpiCard icon="🛒" label="ממוצע להזמנה"  value={shekel(s.avgOrderValue)}   sub="לכל הזמנה"                            color="blue"   />
        <KpiCard icon="💰" label="חסכתי"          value={shekel(s.totalSaved)}      sub="בהנחות ומבצעים"                       color="green"  />
        <KpiCard icon="📦" label="שורות מוצר"     value={s.totalItemLines.toLocaleString()} sub={`${supplyRate}% סופקו`}      color="purple" />
        <KpiCard icon="🚚" label="עלויות משלוח"   value={shekel(s.totalDeliveryFees)} sub={`ממוצע ${shekel(Math.round(s.totalDeliveryFees/s.totalOrders))}`} color="red" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Monthly spending */}
        <ExpandableChart
          title="הוצאות לפי חודש"
          className="lg:col-span-2"
          onExport={() => exportCsv('monthly-spending.csv', monthlySpending.map(m => ({ חודש: m.label, סכום: m.total, הזמנות: m.count })))}
          renderChart={(height) => (
            <ResponsiveContainer width="100%" height={height}>
              <AreaChart data={monthlySpending} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis
                  dataKey="label"
                  interval={xInterval}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickLine={false} axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `₪${(v / 1000).toFixed(0)}K`}
                />
                <Tooltip content={<AreaTooltip />} />
                <Area type="monotone" dataKey="total" stroke="#f97316" strokeWidth={2.5}
                  fill="url(#spendGrad)" dot={{ r: 3, fill: '#f97316', strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        />

        {/* Category donut — inner radius reduced to look fuller */}
        <ExpandableChart
          title="קטגוריות"
          onExport={() => exportCsv('categories.csv', categoryBreakdown.map(c => ({ קטגוריה: c.category, סכום: c.total, פריטים: c.count })))}
          renderChart={(height) => (
            <ResponsiveContainer width="100%" height={height}>
              <PieChart>
                <Pie
                  data={categoryBreakdown}
                  dataKey="total"
                  nameKey="category"
                  cx="50%" cy="42%"
                  innerRadius={height < 300 ? 42 : 65}
                  outerRadius={height < 300 ? 80 : 115}
                  paddingAngle={2}
                >
                  {categoryBreakdown.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: unknown) => shekel(Number(v))} />
                <Legend
                  iconType="circle" iconSize={8}
                  formatter={(v) => <span className="text-xs text-gray-600">{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Top products */}
        <ExpandableChart
          title="המוצרים הנרכשים ביותר"
          className="lg:col-span-2"
          onExport={() => exportCsv('top-products.csv', topProducts.map(p => ({
            שם: p.name, ברקוד: p.barcode, קטגוריה: p.category ?? '', פעמים: p.orderCount, כמות: p.totalQty, סכום: p.totalSpent,
          })))}
          renderChart={() => (
            <div className="divide-y divide-gray-50 overflow-y-auto max-h-96">
              {topProducts.map((p, i) => <ProductRow key={p.barcode} p={p} rank={i + 1} />)}
            </div>
          )}
        />

        {/* Right column */}
        <div className="space-y-6">

          {/* Supply health */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">איכות סיפוק</h2>
            <div className="space-y-3">
              {[
                { label: 'סופקו',    count: s.suppliedCount, color: 'bg-green-400' },
                { label: 'חלופיים', count: s.altCount,       color: 'bg-blue-400'  },
                { label: 'חסרים',   count: s.missingCount,   color: 'bg-red-400'   },
              ].map(row => (
                <div key={row.label}>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{row.label}</span>
                    <span>{row.count.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${row.color}`}
                      style={{ width: `${(row.count / s.totalItemLines) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Orders by day of week */}
          <ExpandableChart
            title="הזמנות לפי יום"
            onExport={() => exportCsv('orders-by-day.csv', ordersByDow.map(d => ({ יום: d.day, הזמנות: d.count })))}
            renderChart={(height) => (
              <ResponsiveContainer width="100%" height={height < 300 ? 140 : height}>
                <BarChart data={ordersByDow} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip formatter={(v: unknown) => [`${v} הזמנות`, '']} />
                  <Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          />
        </div>
      </div>

      {/* Top missing products */}
      {topMissingProducts?.length > 0 && (
        <ExpandableChart
          title="המוצרים שהכי הרבה לא סופקו"
          onExport={() => exportCsv('missing-products.csv', topMissingProducts.map(p => ({
            שם: p.name, ברקוד: p.barcode, קטגוריה: p.category ?? '', 'פעמים חסר': p.count,
          })))}
          renderChart={() => (
            <div className="divide-y divide-gray-50 overflow-y-auto max-h-80">
              {topMissingProducts.map((p, i) => <MissingProductRow key={p.barcode || p.name} p={p} rank={i + 1} />)}
            </div>
          )}
        />
      )}

      {/* Order health — last 6 orders */}
      <ExpandableChart
        title="פירוט סיפוק — 6 הזמנות אחרונות"
        onExport={() => exportCsv('order-health.csv', orderHealth.map(h => ({
          מספר: h.order_number, תאריך: h.date, סופקו: h.supplied, חלופיים: h.alternative, חסרים: h.missing,
        })))}
        renderChart={(height) => (
          <ResponsiveContainer width="100%" height={height < 300 ? 130 : height}>
            <BarChart data={orderHealth.slice(-6)} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="order_number" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="supplied"    name="סופקו"   stackId="a" fill="#34d399" radius={0} />
              <Bar dataKey="alternative" name="חלופיים" stackId="a" fill="#38bdf8" radius={0} />
              <Bar dataKey="missing"     name="חסרים"   stackId="a" fill="#f87171" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      />

    </div>
  );
}
