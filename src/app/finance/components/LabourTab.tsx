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
    setForm({ cost_type: 'wage', description: '', amount: '', pay_date: fmtDate(new Date()), period_start: '', period_end: '', employee_name: '', notes: '' });
    setFormOpen(false);
    setSaving(false);
  };

  const total = costs.reduce((s, c) => s + c.amount, 0);
  const typeLabels: Record<string, string> = { cash: '💵 Cash', wage: '⏰ Wage', salary: '💼 Salary' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{costs.length} entries · Total: <span className="font-semibold text-emerald-600">{formatNZD(total)}</span></div>
        <button onClick={() => setFormOpen(!formOpen)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
          {formOpen ? 'Cancel' : '+ Thêm Chi Phí'}
        </button>
      </div>

      {formOpen && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Loại *</label>
              <select value={form.cost_type} onChange={e => setForm({...form, cost_type: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                {LABOUR_TYPES.map(t => <option key={t} value={t}>{typeLabels[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Số tiền (NZD) *</label>
              <input type="number" step="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Ngày trả *</label>
              <input type="date" value={form.pay_date} onChange={e => setForm({...form, pay_date: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Nhân viên</label>
              <input type="text" value={form.employee_name} onChange={e => setForm({...form, employee_name: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Kỳ từ</label>
              <input type="date" value={form.period_start} onChange={e => setForm({...form, period_start: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Kỳ đến</label>
              <input type="date" value={form.period_end} onChange={e => setForm({...form, period_end: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600">Mô tả / Ghi chú</label>
              <input type="text" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          </div>
          <button onClick={handleSubmit} disabled={saving || !form.amount || !form.pay_date} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving...' : 'Lưu'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" /></div>
      ) : costs.length === 0 ? (
        <div className="text-center py-10 text-gray-400">Chưa có chi phí nhân công</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Loại</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nhân viên</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ngày trả</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Kỳ</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Số tiền</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {costs.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${c.cost_type === 'cash' ? 'bg-yellow-100 text-yellow-700' : c.cost_type === 'salary' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{c.cost_type}</span></td>
                  <td className="px-4 py-3">{c.employee_name || '—'}</td>
                  <td className="px-4 py-3">{c.pay_date}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{c.period_start && c.period_end ? `${c.period_start} → ${c.period_end}` : '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-600">{formatNZD(c.amount)}</td>
                  <td className="px-4 py-3"><button onClick={() => onDelete(c.id)} className="text-red-400 hover:text-red-600 text-xs">Xóa</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
