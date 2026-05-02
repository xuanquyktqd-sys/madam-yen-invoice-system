'use client';
import { useState, useEffect } from 'react';
import { formatNZD } from './types';

export default function PurchasesTab() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/invoices?limit=50')
      .then(res => res.json())
      .then(data => setInvoices(data.invoices || []))
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">
          Hiển thị 50 hóa đơn nguyên vật liệu gần nhất (từ OCR)
        </div>
        <a href="/upload" className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-500 shadow-lg shadow-emerald-900/40 transition-all">
          + Scan Hóa Đơn Mới
        </a>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500" /></div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/50 rounded-2xl border border-dashed border-slate-800 text-slate-500 text-sm italic">Chưa có dữ liệu hóa đơn nhập hàng</div>
      ) : (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-slate-800">
              <tr>
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Ngày</th>
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Nhà cung cấp</th>
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Loại</th>
                <th className="text-right px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Số tiền</th>
                <th className="text-center px-6 py-4 text-[10px] uppercase tracking-wider font-bold text-slate-400">Trạng thái</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-slate-800/50 transition-colors group">
                  <td className="px-6 py-4 text-slate-300 font-medium">{inv.invoice_date || inv.created_at.split('T')[0]}</td>
                  <td className="px-6 py-4 text-slate-200 font-bold">{inv.vendor_name || 'Chưa xác định'}</td>
                  <td className="px-6 py-4 text-slate-400">{inv.category || '—'}</td>
                  <td className="px-6 py-4 text-right font-black text-white">{formatNZD(inv.total_amount)}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${
                      inv.status === 'paid' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                      inv.status === 'approved' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                      'bg-slate-700 text-slate-400'
                    }`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <a href={`/dashboard?id=${inv.id}`} className="text-indigo-400 hover:text-indigo-300 text-xs font-bold transition-colors">
                      Chi tiết →
                    </a>
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
