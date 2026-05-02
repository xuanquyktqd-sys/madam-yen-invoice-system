'use client';
import { useState, useEffect, useCallback } from 'react';
import { formatNZD } from './types';

export default function PurchasesTab() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  
  // Fetch invoices with filters
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: '100',
        search: search,
        status: statusFilter !== 'all' ? statusFilter : '',
        category: categoryFilter !== 'all' ? categoryFilter : ''
      });
      const res = await fetch(`/api/invoices?${params.toString()}`);
      const data = await res.json();
      setInvoices(data.invoices || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, categoryFilter]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/invoices?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) fetchInvoices();
    } catch (err) {
      alert('Lỗi cập nhật trạng thái');
    }
  };

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-lg">
        <div className="flex items-center gap-3 flex-1 min-w-[300px]">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">🔍</span>
            <input 
              type="text" 
              placeholder="Tìm nhà cung cấp, nội dung..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-800 border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-800 border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-300"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        
        <div className="flex items-center gap-2">
          <button onClick={() => window.location.href='/upload'} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-emerald-900/40">
            📸 Scan OCR
          </button>
          <button className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-sm font-medium border border-slate-700">
            ✍️ Nhập tay
          </button>
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500" /></div>
      ) : (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50 border-b border-slate-800 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                <tr>
                  <th className="text-left px-6 py-4">Ngày</th>
                  <th className="text-left px-6 py-4">Nhà cung cấp</th>
                  <th className="text-left px-6 py-4">Hạng mục</th>
                  <th className="text-right px-6 py-4">Số tiền (NZD)</th>
                  <th className="text-center px-6 py-4">Trạng thái</th>
                  <th className="px-6 py-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-800/50 transition-colors group">
                    <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                      {inv.invoice_date || inv.created_at.split('T')[0]}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-200">
                      {inv.vendor_name || <span className="text-rose-400 italic">Chưa nhận diện</span>}
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      <span className="bg-slate-800 px-2 py-1 rounded text-[10px] border border-slate-700">{inv.category || 'N/A'}</span>
                    </td>
                    <td className="px-6 py-4 text-right font-black text-white">
                      {formatNZD(inv.total_amount)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <select 
                        value={inv.status} 
                        onChange={(e) => updateStatus(inv.id, e.target.value)}
                        className={`text-[10px] font-bold uppercase rounded-lg px-2 py-1 bg-transparent border border-slate-700 focus:ring-0 ${
                          inv.status === 'paid' ? 'text-emerald-400' :
                          inv.status === 'approved' ? 'text-blue-400' :
                          inv.status === 'rejected' ? 'text-rose-400' : 'text-slate-400'
                        }`}
                      >
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="paid">Paid</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button className="p-2 text-slate-500 hover:text-indigo-400 transition-colors">
                          👁️
                        </button>
                        <button className="p-2 text-slate-500 hover:text-rose-500 transition-colors">
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invoices.length === 0 && (
            <div className="text-center py-20 text-slate-500 italic text-sm">Không tìm thấy hóa đơn nào</div>
          )}
        </div>
      )}
    </div>
  );
}
