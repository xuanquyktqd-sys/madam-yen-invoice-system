'use client';
import { useState, useEffect } from 'react';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type VendorSetting = {
  id: string;
  name: string;
  gst_number: string | null;
  address: string | null;
  default_category: string | null;
  is_active: boolean;
};

export default function GlobalSettingsModal({ isOpen, onClose }: Props) {
  const [tab, setTab] = useState<'vendors' | 'maintenance' | 'general'>('vendors');
  const [vendors, setVendors] = useState<VendorSetting[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Vendor Create Form
  const [vendorCreateOpen, setVendorCreateOpen] = useState(false);
  const [vendorForm, setVendorForm] = useState({ name: '', gst_number: '', address: '', default_category: '' });

  useEffect(() => {
    if (isOpen) fetchVendors();
  }, [isOpen]);

  const showToast = (text: string, type: 'success' | 'error') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/settings/vendors');
      const data = await res.json();
      setVendors(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateVendor = async () => {
    if (!vendorForm.name) return;
    try {
      const res = await fetch('/api/dashboard/settings/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vendorForm),
      });
      if (!res.ok) throw new Error('Failed to create');
      showToast('Đã thêm Vendor', 'success');
      setVendorCreateOpen(false);
      setVendorForm({ name: '', gst_number: '', address: '', default_category: '' });
      fetchVendors();
      // Notify other components
      window.dispatchEvent(new CustomEvent('vendor-settings-updated'));
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const toggleVendorStatus = async (id: string, current: boolean) => {
    try {
      await fetch('/api/dashboard/settings/vendors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !current }),
      });
      fetchVendors();
      window.dispatchEvent(new CustomEvent('vendor-settings-updated'));
    } catch (err) {
      showToast('Lỗi cập nhật', 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-8 py-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">HỆ THỐNG CÀI ĐẶT</h2>
            <p className="text-sm text-slate-500 mt-1">Quản lý cấu hình toàn diện Madam Yen Finance</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-all hover:rotate-90">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-64 border-r border-slate-800 bg-slate-900/30 p-4 space-y-2 hidden md:block">
            {[
              { id: 'vendors', label: 'Nhà cung cấp', icon: '🏢' },
              { id: 'maintenance', label: 'Bảo trì dữ liệu', icon: '🧹' },
              { id: 'general', label: 'Cài đặt chung', icon: '⚙️' },
            ].map(i => (
              <button
                key={i.id}
                onClick={() => setTab(i.id as any)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all ${
                  tab === i.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span>{i.icon}</span> {i.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-8 bg-slate-950/20">
            {tab === 'vendors' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-white">Quản lý Nhà cung cấp</h3>
                  <button onClick={() => setVendorCreateOpen(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-500 shadow-lg shadow-indigo-900/40 transition-all">
                    + Thêm NCC
                  </button>
                </div>

                {loading ? (
                  <div className="py-20 flex justify-center"><div className="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full" /></div>
                ) : (
                  <div className="grid gap-3">
                    {vendors.map(v => (
                      <div key={v.id} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between group hover:border-slate-700 transition-all">
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl ${v.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-800 text-slate-500'}`}>
                            {v.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-white">{v.name}</div>
                            <div className="text-xs text-slate-500 font-mono mt-1">{v.gst_number || 'No GST'} • {v.default_category || 'No Category'}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => toggleVendorStatus(v.id, v.is_active)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              v.is_active ? 'bg-emerald-500/10 text-emerald-500 hover:bg-red-500/10 hover:text-red-500' : 'bg-slate-800 text-slate-400 hover:bg-emerald-500/10 hover:text-emerald-500'
                            }`}
                          >
                            {v.is_active ? 'Active' : 'Disabled'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'maintenance' && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white">Bảo trì hệ thống</h3>
                <div className="bg-amber-900/10 border border-amber-900/30 p-6 rounded-3xl space-y-4">
                  <div className="flex items-start gap-4">
                    <span className="text-2xl">🧹</span>
                    <div>
                      <h4 className="font-bold text-amber-500">Dọn dẹp ảnh hóa đơn cũ</h4>
                      <p className="text-sm text-slate-400 mt-1">Xóa các ảnh hóa đơn và file PDF cũ để tiết kiệm dung lượng Supabase Storage.</p>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-amber-900/20 flex items-center justify-between">
                    <span className="text-sm text-slate-500">Lưu ý: Hành động này không thể hoàn tác.</span>
                    <button className="px-5 py-2.5 bg-slate-800 text-slate-300 rounded-xl text-sm font-bold hover:bg-red-900/30 hover:text-red-400 transition-all border border-slate-700">
                      Chạy dọn dẹp
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab === 'general' && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white">Cài đặt chung</h3>
                <div className="grid gap-6">
                   <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
                     <label className="block">
                       <span className="text-xs font-bold text-slate-500 uppercase">Đơn vị tiền tệ</span>
                       <select disabled className="w-full mt-2 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-slate-400">
                         <option>New Zealand Dollar (NZD)</option>
                       </select>
                     </label>
                   </div>
                   <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
                     <label className="block">
                       <span className="text-xs font-bold text-slate-500 uppercase">Tên nhà hàng</span>
                       <input type="text" value="Madam Yen" disabled className="w-full mt-2 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-slate-400" />
                     </label>
                   </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Create Vendor Overlay */}
        {vendorCreateOpen && (
          <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-slate-800 border border-slate-700 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95">
              <div className="px-6 py-4 border-b border-slate-700 font-bold text-white flex justify-between items-center">
                <span>Thêm nhà cung cấp mới</span>
                <button onClick={() => setVendorCreateOpen(false)} className="text-slate-500 hover:text-white">✕</button>
              </div>
              <div className="p-6 space-y-4">
                <input 
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" 
                  placeholder="Tên NCC (Ví dụ: Tokyo Food)" 
                  value={vendorForm.name}
                  onChange={e => setVendorForm({...vendorForm, name: e.target.value})}
                />
                <input 
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" 
                  placeholder="GST Number (Tùy chọn)" 
                  value={vendorForm.gst_number}
                  onChange={e => setVendorForm({...vendorForm, gst_number: e.target.value})}
                />
                <button onClick={handleCreateVendor} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 transition-all">
                  Lưu NCC
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-[110] px-6 py-3 rounded-2xl shadow-2xl text-sm font-bold text-white border animate-in slide-in-from-bottom-4 ${
            toast.type === 'success' ? 'bg-emerald-600 border-emerald-500' : 'bg-rose-600 border-rose-500'
          }`}>
            {toast.text}
          </div>
        )}
      </div>
    </div>
  );
}
