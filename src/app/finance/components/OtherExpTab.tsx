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
        <div className="text-sm text-gray-500">{expenses.length} entries · Total: <span className="font-semibold text-rose-600">{formatNZD(total)}</span></div>
        <button onClick={() => setFormOpen(!formOpen)} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700 transition-colors">
          {formOpen ? 'Cancel' : '+ Thêm Chi Phí'}
        </button>
      </div>

      {formOpen && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Loại *</label>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                {OTHER_CATEGORIES.map(c => <option key={c} value={c}>{catIcons[c] || ''} {c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Số tiền (NZD) *</label>
              <input type="number" step="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Ngày *</label>
              <input type="date" value={form.expense_date} onChange={e => setForm({...form, expense_date: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Nhà cung cấp</label>
              <input type="text" value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Mô tả</label>
              <input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Ghi chú</label>
              <input type="text" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          </div>
          <button onClick={handleSubmit} disabled={saving || !form.amount || !form.expense_date} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving...' : 'Lưu'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500" /></div>
      ) : expenses.length === 0 ? (
        <div className="text-center py-10 text-gray-400">Chưa có chi phí khác</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Loại</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Mô tả</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">NCC</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ngày</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Số tiền</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expenses.map(e => (
                <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3"><span className="flex items-center gap-1.5">{catIcons[e.category] || '📎'} <span className="capitalize">{e.category}</span></span></td>
                  <td className="px-4 py-3">{e.description || '—'}</td>
                  <td className="px-4 py-3">{e.supplier || '—'}</td>
                  <td className="px-4 py-3">{e.expense_date}</td>
                  <td className="px-4 py-3 text-right font-semibold text-rose-600">{formatNZD(e.amount)}</td>
                  <td className="px-4 py-3"><button onClick={() => onDelete(e.id)} className="text-red-400 hover:text-red-600 text-xs">Xóa</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
