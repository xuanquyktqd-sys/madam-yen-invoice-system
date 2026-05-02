'use client';
import { useState } from 'react';
import { formatNZD, fmtDate, type DailySale } from './types';

type Props = {
  sales: DailySale[];
  loading: boolean;
  onAdd: (data: { sale_date: string; total_revenue: string; order_count: string; notes: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export default function RevenueTab({ sales, loading, onAdd, onDelete }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ sale_date: fmtDate(new Date()), total_revenue: '', order_count: '', notes: '' });

  const handleSubmit = async () => {
    if (!form.sale_date || !form.total_revenue) return;
    setSaving(true);
    await onAdd(form);
    window.dispatchEvent(new CustomEvent('finance-data-changed'));
    setForm({ sale_date: fmtDate(new Date()), total_revenue: '', order_count: '', notes: '' });
    setFormOpen(false);
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Xóa bản ghi doanh thu này?')) return;
    await onDelete(id);
    window.dispatchEvent(new CustomEvent('finance-data-changed'));
  };

  const total = sales.reduce((s, r) => s + r.total_revenue, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">
          {sales.length} entries · Tổng: <span className="font-bold text-emerald-400">{formatNZD(total)}</span>
        </div>
        <button onClick={() => setFormOpen(!formOpen)} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${formOpen ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-900/40 hover:bg-emerald-500'}`}>
          {formOpen ? 'Hủy' : '+ Thêm Doanh Thu'}
        </button>
      </div>

      {formOpen && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl animate-in slide-in-from-top-2 duration-300">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Ngày *</label>
              <input type="date" value={form.sale_date} onChange={e => setForm({...form, sale_date: e.target.value})} className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Doanh thu (NZD) *</label>
              <input type="number" step="0.01" value={form.total_revenue} onChange={e => setForm({...form, total_revenue: e.target.value})} placeholder="0.00" className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Số đơn hàng</label>
              <input type="number" value={form.order_count} onChange={e => setForm({...form, order_count: e.target.value})} placeholder="0" className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Ghi chú</label>
              <input type="text" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="..." className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleSubmit} disabled={saving || !form.sale_date || !form.total_revenue} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-500 disabled:opacity-50 transition-all shadow-lg shadow-indigo-900/40">
              {saving ? 'Đang lưu...' : 'Lưu dữ liệu'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500" /></div>
      ) : sales.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/50 rounded-2xl border border-dashed border-slate-800 text-slate-500 text-sm italic">Chưa có dữ liệu doanh thu</div>
      ) : (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-slate-800">
              <tr>
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Ngày</th>
                <th className="text-right px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Doanh thu</th>
                <th className="text-right px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Đơn hàng</th>
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Nguồn</th>
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Ghi chú</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sales.map(s => (
                <tr key={s.id} className="hover:bg-slate-800/50 transition-colors group">
                  <td className="px-6 py-4 font-bold text-slate-200">{s.sale_date}</td>
                  <td className="px-6 py-4 text-right font-black text-emerald-400">{formatNZD(s.total_revenue)}</td>
                  <td className="px-6 py-4 text-right text-slate-300">{s.order_count}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${s.source === 'api' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-slate-700 text-slate-400'}`}>
                      {s.source}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-500 truncate max-w-[150px]">{s.notes || '—'}</td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => handleDelete(s.id)} className="p-2 text-slate-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
