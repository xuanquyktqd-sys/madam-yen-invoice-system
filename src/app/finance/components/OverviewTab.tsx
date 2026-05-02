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
            <div key={k.key} className={`bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white shadow-xl hover:border-indigo-500/50 transition-all group`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl">{k.icon}</span>
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${k.gradient} opacity-20 group-hover:opacity-100 transition-opacity`} />
              </div>
              <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">{k.label}</div>
              <div className="text-2xl font-bold mt-1">
                {k.key === 'profit_margin' ? `${val.toFixed(1)}%` : formatNZD(val)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue vs Expenses Chart */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl p-6">
          <h3 className="text-sm font-bold text-slate-100 mb-6 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            Doanh Thu & Chi Phí (30 ngày gần nhất)
          </h3>
          {chartData.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm italic">Chưa có dữ liệu</div>
          ) : (
            <div className="flex items-end gap-[3px] h-48 overflow-x-auto pb-2 scrollbar-hide">
              {chartData.map(([date, v]) => (
                <div key={date} className="flex flex-col items-center gap-[2px] flex-1 min-w-[14px] group relative">
                  <div className="w-full bg-emerald-500/80 group-hover:bg-emerald-400 rounded-t-sm transition-all" style={{ height: `${(v.revenue/maxVal)*140}px` }} />
                  <div className="w-full bg-rose-500/80 group-hover:bg-rose-400 rounded-t-sm transition-all" style={{ height: `${(v.expense/maxVal)*140}px` }} />
                  <div className="hidden group-hover:block absolute -top-16 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-700 text-white text-[10px] rounded-lg px-2 py-1.5 whitespace-nowrap z-20 shadow-2xl">
                    <div className="font-bold text-slate-400 mb-1">{date}</div>
                    <div className="text-emerald-400">Thu: {formatNZD(v.revenue)}</div>
                    <div className="text-rose-400">Chi: {formatNZD(v.expense)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-6 mt-6 text-[10px] uppercase tracking-widest font-bold text-slate-500">
            <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" /> Doanh thu</span>
            <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 bg-rose-500 rounded-full" /> Chi phí</span>
          </div>
        </div>

        {/* Expense Breakdown */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl p-6">
          <h3 className="text-sm font-bold text-slate-100 mb-6 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            Cơ cấu Chi Phí
          </h3>
          <div className="space-y-5">
            {breakdownItems.map(item => (
              <div key={item.label}>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-slate-400 font-medium">{item.label}</span>
                  <span className="font-bold text-slate-200">{formatNZD(item.value)} <span className="text-slate-600 ml-1">{item.pct.toFixed(1)}%</span></span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div className={`${item.color} h-full rounded-full transition-all duration-1000 shadow-[0_0_8px_rgba(0,0,0,0.5)]`} style={{ width: `${item.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 pt-5 border-t border-slate-800 flex justify-between items-center">
            <span className="text-sm text-slate-400 font-medium">Tổng chi phí</span>
            <span className="text-lg font-black text-white tracking-tight">{formatNZD(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
