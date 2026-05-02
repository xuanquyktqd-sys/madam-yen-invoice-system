'use client';
import { useState } from 'react';
import { formatNZD, fmtDate, OTHER_CATEGORIES, type OtherExpense } from './types';

type Props = {
  expenses: OtherExpense[];
  loading: boolean;
  onAdd: (data: Record<string, string>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export default function OtherExpTab({ expenses, loading, onAdd, onDelete }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ category: 'rent', description: '', amount: '', expense_date: fmtDate(new Date()), supplier: '', notes: '' });

  const handleSubmit = async () => {
    if (!form.category || !form.amount || !form.expense_date) return;
    setSaving(true);
    await onAdd(form);
    setForm({ category: 'rent', description: '', amount: '', expense_date: fmtDate(new Date()), supplier: '', notes: '' });
    setFormOpen(false);
    setSaving(false);
  };

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const catIcons: Record<string, string> = { rent: '🏠', marketing: '📣', insurance: '🛡️', equipment: '🔧', misc: '📎' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">
          {expenses.length} entries · Tổng cộng: <span className="font-bold text-rose-500 text-base">{formatNZD(total)}</span>
        </div>
        <button 
          onClick={() => setFormOpen(!formOpen)} 
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg ${
            formOpen 
              ? 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700' 
              : 'bg-rose-600 text-white hover:bg-rose-500 shadow-rose-900/40'
          }`}
        >
          {formOpen ? 'Hủy' : '+ Thêm chi phí'}
        </button>
      </div>

      {formOpen && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl animate-in slide-in-from-top-4 duration-300">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Loại chi phí *</label>
              <select 
                value={form.category} 
                onChange={e => setForm({...form, category: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none transition-all"
              >
                {OTHER_CATEGORIES.map(c => <option key={c} value={c}>{catIcons[c] || ''} {c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Số tiền (NZD) *</label>
              <input 
                type="number" 
                step="0.01" 
                placeholder="0.00"
                value={form.amount} 
                onChange={e => setForm({...form, amount: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none transition-all" 
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày phát sinh *</label>
              <input 
                type="date" 
                value={form.expense_date} 
                onChange={e => setForm({...form, expense_date: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none transition-all [color-scheme:dark]" 
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nhà cung cấp</label>
              <input 
                type="text" 
                placeholder="Tên NCC..."
                value={form.supplier} 
                onChange={e => setForm({...form, supplier: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none transition-all" 
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mô tả / Ghi chú</label>
              <input 
                type="text" 
                placeholder="Thông tin thêm..."
                value={form.description} 
                onChange={e => setForm({...form, description: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none transition-all" 
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button 
              onClick={handleSubmit} 
              disabled={saving || !form.amount || !form.expense_date} 
              className="px-6 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-bold hover:bg-rose-500 disabled:opacity-50 transition-all shadow-lg shadow-rose-900/40 active:scale-95"
            >
              {saving ? 'Đang lưu...' : 'Lưu chi phí'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-rose-500" /></div>
      ) : expenses.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/50 rounded-3xl border border-dashed border-slate-800 text-slate-500">
          <div className="text-3xl mb-3">📦</div>
          Chưa có chi phí khác trong khoảng thời gian này
        </div>
      ) : (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-5 py-4 font-bold">Loại</th>
                  <th className="text-left px-5 py-4 font-bold">Mô tả / NCC</th>
                  <th className="text-left px-5 py-4 font-bold">Ngày</th>
                  <th className="text-right px-5 py-4 font-bold">Số tiền</th>
                  <th className="px-5 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {expenses.map(e => (
                  <tr key={e.id} className="hover:bg-slate-800/30 transition-colors group">
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-2 text-white font-medium">
                        <span className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-lg">{catIcons[e.category] || '📎'}</span>
                        <span className="capitalize">{e.category}</span>
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-slate-200">{e.description || '—'}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{e.supplier || 'Không có NCC'}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-400 font-mono">{e.expense_date}</td>
                    <td className="px-5 py-4 text-right font-bold text-rose-500 font-mono text-base">{formatNZD(e.amount)}</td>
                    <td className="px-5 py-4 text-right">
                      <button 
                        onClick={() => onDelete(e.id)} 
                        className="p-2 text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        title="Xóa"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
