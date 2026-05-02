'use client';
import { useState } from 'react';
import { formatNZD, fmtDate, UTILITY_CATEGORIES, type UtilityBill } from './types';

type Props = {
  bills: UtilityBill[];
  loading: boolean;
  onAdd: (data: Record<string, string>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export default function UtilityTab({ bills, loading, onAdd, onDelete }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ category: 'electricity', supplier: '', bill_number: '', period_start: fmtDate(new Date()), period_end: '', total_amount: '', notes: '' });

  const handleSubmit = async () => {
    if (!form.category || !form.total_amount) return;
    setSaving(true);
    await onAdd(form);
    window.dispatchEvent(new CustomEvent('finance-data-changed'));
    setForm({ category: 'electricity', supplier: '', bill_number: '', period_start: fmtDate(new Date()), period_end: '', total_amount: '', notes: '' });
    setFormOpen(false);
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await onDelete(id);
    window.dispatchEvent(new CustomEvent('finance-data-changed'));
  };

  const total = bills.reduce((s, b) => s + b.total_amount, 0);
  const catIcons: Record<string, string> = { electricity: '⚡', water: '💧', gas: '🔥', internet: '🌐', phone: '📱', other: '📦' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">{bills.length} hóa đơn · Tổng: <span className="font-bold text-amber-400">{formatNZD(total)}</span></div>
        <button onClick={() => setFormOpen(!formOpen)} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${formOpen ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-amber-600 text-white border-amber-500 shadow-lg shadow-amber-900/40 hover:bg-amber-500'}`}>
          {formOpen ? 'Hủy' : '+ Thêm Hóa Đơn'}
        </button>
      </div>

      {formOpen && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl animate-in slide-in-from-top-2 duration-300">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Loại *</label>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all">
                {UTILITY_CATEGORIES.map(c => <option key={c} value={c}>{catIcons[c] || ''} {c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Nhà cung cấp</label>
              <input type="text" value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} placeholder="e.g. Mercury" className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Tổng tiền (NZD) *</label>
              <input type="number" step="0.01" value={form.total_amount} onChange={e => setForm({...form, total_amount: e.target.value})} className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Số hóa đơn</label>
              <input type="text" value={form.bill_number} onChange={e => setForm({...form, bill_number: e.target.value})} className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Kỳ từ</label>
              <input type="date" value={form.period_start} onChange={e => setForm({...form, period_start: e.target.value})} className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Kỳ đến</label>
              <input type="date" value={form.period_end} onChange={e => setForm({...form, period_end: e.target.value})} className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Ghi chú</label>
              <input type="text" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleSubmit} disabled={saving || !form.total_amount} className="px-6 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-500 disabled:opacity-50 transition-all shadow-lg shadow-amber-900/40">
              {saving ? 'Đang lưu...' : 'Lưu hóa đơn'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-500" /></div>
      ) : bills.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/50 rounded-2xl border border-dashed border-slate-800 text-slate-500 text-sm italic">Chưa có hóa đơn vận hành</div>
      ) : (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-slate-800">
              <tr>
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Loại</th>
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">NCC</th>
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Kỳ thanh toán</th>
                <th className="text-right px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Tổng cộng</th>
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Ghi chú</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {bills.map(b => (
                <tr key={b.id} className="hover:bg-slate-800/50 transition-colors group">
                  <td className="px-6 py-4"><span className="flex items-center gap-1.5 text-slate-200 font-bold">{catIcons[b.category] || '📦'} <span className="capitalize">{b.category}</span></span></td>
                  <td className="px-6 py-4 text-slate-300">{b.supplier || '—'}</td>
                  <td className="px-6 py-4 text-[10px] text-slate-500 font-medium tracking-tight uppercase">{b.period_start || '?'} → {b.period_end || '?'}</td>
                  <td className="px-6 py-4 text-right font-black text-amber-400">{formatNZD(b.total_amount)}</td>
                  <td className="px-6 py-4 text-slate-500 truncate max-w-[120px]">{b.notes || '—'}</td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => onDelete(b.id)} className="p-2 text-slate-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100">
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
