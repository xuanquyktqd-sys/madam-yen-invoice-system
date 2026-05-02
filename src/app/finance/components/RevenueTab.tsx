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
    setForm({ sale_date: fmtDate(new Date()), total_revenue: '', order_count: '', notes: '' });
    setFormOpen(false);
    setSaving(false);
  };

  const total = sales.reduce((s, r) => s + r.total_revenue, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {sales.length} entries · Total: <span className="font-semibold text-emerald-600">{formatNZD(total)}</span>
        </div>
        <button onClick={() => setFormOpen(!formOpen)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
          {formOpen ? 'Cancel' : '+ Thêm Doanh Thu'}
        </button>
      </div>

      {formOpen && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Ngày *</label>
              <input type="date" value={form.sale_date} onChange={e => setForm({...form, sale_date: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Doanh thu (NZD) *</label>
              <input type="number" step="0.01" value={form.total_revenue} onChange={e => setForm({...form, total_revenue: e.target.value})} placeholder="0.00" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Số đơn</label>
              <input type="number" value={form.order_count} onChange={e => setForm({...form, order_count: e.target.value})} placeholder="0" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Ghi chú</label>
              <input type="text" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          </div>
          <button onClick={handleSubmit} disabled={saving || !form.sale_date || !form.total_revenue} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving...' : 'Lưu'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" /></div>
      ) : sales.length === 0 ? (
        <div className="text-center py-10 text-gray-400">Chưa có dữ liệu doanh thu</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ngày</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Doanh thu</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Đơn hàng</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nguồn</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ghi chú</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sales.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium">{s.sale_date}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-600">{formatNZD(s.total_revenue)}</td>
                  <td className="px-4 py-3 text-right">{s.order_count}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${s.source === 'api' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{s.source}</span></td>
                  <td className="px-4 py-3 text-gray-500 truncate max-w-[150px]">{s.notes || '—'}</td>
                  <td className="px-4 py-3"><button onClick={() => onDelete(s.id)} className="text-red-400 hover:text-red-600 text-xs">Xóa</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
