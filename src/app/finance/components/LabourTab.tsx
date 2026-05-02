'use client';
import { useState } from 'react';
import { formatNZD, fmtDate, LABOUR_TYPES, type LabourCost } from './types';

type Props = {
  costs: LabourCost[];
  loading: boolean;
  onAdd: (data: Record<string, string>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export default function LabourTab({ costs, loading, onAdd, onDelete }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ cost_type: 'wage', description: '', amount: '', pay_date: fmtDate(new Date()), period_start: '', period_end: '', employee_name: '', notes: '' });

  const handleSubmit = async () => {
    if (!form.cost_type || !form.amount || !form.pay_date) return;
    setSaving(true);
    await onAdd(form);
    window.dispatchEvent(new CustomEvent('finance-data-changed'));
    setForm({ cost_type: 'wage', description: '', amount: '', pay_date: fmtDate(new Date()), period_start: '', period_end: '', employee_name: '', notes: '' });
    setFormOpen(false);
    setSaving(false);
  };

  const total = costs.reduce((s, c) => s + c.amount, 0);
  const typeLabels: Record<string, string> = { cash: '💵 Cash', wage: '⏰ Wage', salary: '💼 Salary' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">
          {costs.length} entries · Tổng cộng: <span className="font-bold text-emerald-500 text-base">{formatNZD(total)}</span>
        </div>
        <button 
          onClick={() => setFormOpen(!formOpen)} 
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg ${
            formOpen 
              ? 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700' 
              : 'bg-teal-600 text-white hover:bg-teal-500 shadow-teal-900/40'
          }`}
        >
          {formOpen ? 'Hủy' : '+ Ghi nhận nhân công'}
        </button>
      </div>

      {formOpen && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl animate-in slide-in-from-top-4 duration-300">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Hình thức *</label>
              <select 
                value={form.cost_type} 
                onChange={e => setForm({...form, cost_type: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all"
              >
                {LABOUR_TYPES.map(t => <option key={t} value={t}>{typeLabels[t]}</option>)}
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
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all" 
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày trả *</label>
              <input 
                type="date" 
                value={form.pay_date} 
                onChange={e => setForm({...form, pay_date: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all [color-scheme:dark]" 
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tên nhân viên</label>
              <input 
                type="text" 
                placeholder="Họ tên..."
                value={form.employee_name} 
                onChange={e => setForm({...form, employee_name: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all" 
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Kỳ lương từ</label>
              <input 
                type="date" 
                value={form.period_start} 
                onChange={e => setForm({...form, period_start: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all [color-scheme:dark]" 
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Kỳ lương đến</label>
              <input 
                type="date" 
                value={form.period_end} 
                onChange={e => setForm({...form, period_end: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all [color-scheme:dark]" 
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mô tả / Ghi chú</label>
              <input 
                type="text" 
                placeholder="Ghi chú chi phí..."
                value={form.notes} 
                onChange={e => setForm({...form, notes: e.target.value})} 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm mt-1.5 text-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all" 
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button 
              onClick={handleSubmit} 
              disabled={saving || !form.amount || !form.pay_date} 
              className="px-6 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-bold hover:bg-teal-500 disabled:opacity-50 transition-all shadow-lg shadow-teal-900/40 active:scale-95"
            >
              {saving ? 'Đang lưu...' : 'Ghi nhận chi phí'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-500" /></div>
      ) : costs.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/50 rounded-3xl border border-dashed border-slate-800 text-slate-500">
          <div className="text-3xl mb-3">👷</div>
          Chưa có chi phí nhân công trong khoảng thời gian này
        </div>
      ) : (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-5 py-4 font-bold">Loại</th>
                  <th className="text-left px-5 py-4 font-bold">Nhân viên</th>
                  <th className="text-left px-5 py-4 font-bold">Ngày trả</th>
                  <th className="text-left px-5 py-4 font-bold">Kỳ lương</th>
                  <th className="text-right px-5 py-4 font-bold">Số tiền</th>
                  <th className="px-5 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {costs.map(c => (
                  <tr key={c.id} className="hover:bg-slate-800/30 transition-colors group">
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-tight ${
                        c.cost_type === 'cash' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 
                        c.cost_type === 'salary' ? 'bg-purple-500/10 text-purple-500 border border-purple-500/20' : 
                        'bg-teal-500/10 text-teal-500 border border-teal-500/20'
                      }`}>
                        {c.cost_type}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-slate-200 font-medium">{c.employee_name || '—'}</div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate max-w-[200px]">{c.notes || ''}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-400 font-mono">{c.pay_date}</td>
                    <td className="px-5 py-4">
                      {c.period_start && c.period_end ? (
                        <div className="text-xs text-slate-500 bg-slate-800/50 px-2 py-1 rounded-md inline-block font-mono">
                          {c.period_start} → {c.period_end}
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-teal-500 font-mono text-base">{formatNZD(c.amount)}</td>
                    <td className="px-5 py-4 text-right">
                      <button 
                        onClick={() => onDelete(c.id)} 
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
