'use client';
import { formatNZD, type FinanceSummary } from './types';

const KPI_STYLES = [
  { label: 'Tổng Doanh Thu', key: 'total_revenue' as const, gradient: 'from-emerald-500 to-teal-600', icon: '📈' },
  { label: 'Tổng Chi Phí', key: 'total_expenses' as const, gradient: 'from-rose-500 to-pink-600', icon: '📉' },
  { label: 'Lợi Nhuận Ròng', key: 'net_profit' as const, gradient: 'from-blue-500 to-indigo-600', icon: '💰' },
  { label: 'Biên LN %', key: 'profit_margin' as const, gradient: 'from-amber-500 to-orange-600', icon: '📊' },
];

export default function OverviewTab({ summary, loading }: { summary: FinanceSummary | null; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500" /></div>;
  if (!summary) return <div className="text-center py-20 text-gray-400">No data available</div>;

  const bd = summary.expense_breakdown;
  const total = bd.purchase + bd.utility + bd.labour + bd.other;
  const pcts = total > 0
    ? { purchase: bd.purchase/total*100, utility: bd.utility/total*100, labour: bd.labour/total*100, other: bd.other/total*100 }
    : { purchase: 0, utility: 0, labour: 0, other: 0 };

  const breakdownItems = [
    { label: 'Nguyên vật liệu', value: bd.purchase, pct: pcts.purchase, color: 'bg-blue-500' },
    { label: 'Vận hành', value: bd.utility, pct: pcts.utility, color: 'bg-amber-500' },
    { label: 'Nhân công', value: bd.labour, pct: pcts.labour, color: 'bg-emerald-500' },
    { label: 'Chi phí khác', value: bd.other, pct: pcts.other, color: 'bg-rose-500' },
  ];

  // Simple bar chart from daily data
  const allDates = new Map<string, { revenue: number; expense: number }>();
  for (const d of summary.daily_revenue) {
    const entry = allDates.get(d.date) ?? { revenue: 0, expense: 0 };
    entry.revenue = d.revenue;
    allDates.set(d.date, entry);
  }
  for (const d of summary.daily_expenses) {
    const entry = allDates.get(d.date) ?? { revenue: 0, expense: 0 };
    entry.expense = d.amount;
    allDates.set(d.date, entry);
  }
  const chartData = [...allDates.entries()].sort((a,b) => a[0].localeCompare(b[0])).slice(-30);
  const maxVal = Math.max(1, ...chartData.map(([,v]) => Math.max(v.revenue, v.expense)));

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_STYLES.map(k => {
          const val = k.key === 'profit_margin' ? summary[k.key] : summary[k.key];
          return (
            <div key={k.key} className={`bg-gradient-to-br ${k.gradient} rounded-2xl p-5 text-white shadow-lg hover:scale-[1.02] transition-transform`}>
              <div className="text-2xl mb-1">{k.icon}</div>
              <div className="text-sm opacity-80">{k.label}</div>
              <div className="text-2xl font-bold mt-1">
                {k.key === 'profit_margin' ? `${val.toFixed(1)}%` : formatNZD(val)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue vs Expenses Chart */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Doanh Thu & Chi Phí theo ngày</h3>
          {chartData.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">Chưa có dữ liệu</div>
          ) : (
            <div className="flex items-end gap-[2px] h-44 overflow-x-auto">
              {chartData.map(([date, v]) => (
                <div key={date} className="flex flex-col items-center gap-[1px] flex-1 min-w-[12px] group relative">
                  <div className="w-full bg-emerald-400 rounded-t-sm transition-all" style={{ height: `${(v.revenue/maxVal)*140}px` }} />
                  <div className="w-full bg-rose-400 rounded-t-sm transition-all" style={{ height: `${(v.expense/maxVal)*140}px` }} />
                  <div className="hidden group-hover:block absolute -top-16 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                    {date.slice(5)}: Rev {formatNZD(v.revenue)} | Exp {formatNZD(v.expense)}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-4 mt-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-400 rounded-sm inline-block" /> Doanh thu</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-rose-400 rounded-sm inline-block" /> Chi phí</span>
          </div>
        </div>

        {/* Expense Breakdown */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Cơ cấu Chi Phí</h3>
          <div className="space-y-3">
            {breakdownItems.map(item => (
              <div key={item.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">{item.label}</span>
                  <span className="font-medium">{formatNZD(item.value)} <span className="text-gray-400">({item.pct.toFixed(1)}%)</span></span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5">
                  <div className={`${item.color} h-2.5 rounded-full transition-all duration-500`} style={{ width: `${item.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between text-sm font-semibold">
            <span>Tổng chi phí</span>
            <span>{formatNZD(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
