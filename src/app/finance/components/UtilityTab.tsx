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
    setForm({ category: 'electricity', supplier: '', bill_number: '', period_start: fmtDate(new Date()), period_end: '', total_amount: '', notes: '' });
    setFormOpen(false);
    setSaving(false);
  };

  const total = bills.reduce((s, b) => s + b.total_amount, 0);
  const catIcons: Record<string, string> = { electricity: '⚡', water: '💧', gas: '🔥', internet: '🌐', phone: '📱', other: '📦' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{bills.length} bills · Total: <span className="font-semibold text-amber-600">{formatNZD(total)}</span></div>
        <button onClick={() => setFormOpen(!formOpen)} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors">
          {formOpen ? 'Cancel' : '+ Thêm Hóa Đơn'}
        </button>
      </div>

      {formOpen && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Loại *</label>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                {UTILITY_CATEGORIES.map(c => <option key={c} value={c}>{catIcons[c] || ''} {c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Nhà cung cấp</label>
              <input type="text" value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} placeholder="e.g. Mercury" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Tổng tiền (NZD) *</label>
              <input type="number" step="0.01" value={form.total_amount} onChange={e => setForm({...form, total_amount: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Số hóa đơn</label>
              <input type="text" value={form.bill_number} onChange={e => setForm({...form, bill_number: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
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
              <label className="text-xs font-medium text-gray-600">Ghi chú</label>
              <input type="text" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          </div>
          <button onClick={handleSubmit} disabled={saving || !form.total_amount} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving...' : 'Lưu'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" /></div>
      ) : bills.length === 0 ? (
        <div className="text-center py-10 text-gray-400">Chưa có hóa đơn vận hành</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Loại</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">NCC</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Kỳ</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Tổng</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ghi chú</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bills.map(b => (
                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3"><span className="flex items-center gap-1.5">{catIcons[b.category] || '📦'} <span className="capitalize">{b.category}</span></span></td>
                  <td className="px-4 py-3">{b.supplier || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{b.period_start || '?'} → {b.period_end || '?'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-amber-600">{formatNZD(b.total_amount)}</td>
                  <td className="px-4 py-3 text-gray-500 truncate max-w-[120px]">{b.notes || '—'}</td>
                  <td className="px-4 py-3"><button onClick={() => onDelete(b.id)} className="text-red-400 hover:text-red-600 text-xs">Xóa</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
