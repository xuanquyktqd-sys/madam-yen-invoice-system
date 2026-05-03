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
  const [tab, setTab] = useState<'vendors' | 'maintenance' | 'general' | 'gmail'>('vendors');
  const [vendors, setVendors] = useState<VendorSetting[]>([]);
  const [utilityEmails, setUtilityEmails] = useState<{id: number, email: string, provider_name: string}[]>([]);
  const [newEmail, setNewEmail] = useState({ email: '', provider_name: '' });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Maintenance states
  const [cleanupMonths, setCleanupMonths] = useState(6);
  const [cleanupIncludeJobs, setCleanupIncludeJobs] = useState(true);

  // Vendor Create Form
  const [vendorCreateOpen, setVendorCreateOpen] = useState(false);
  const [vendorForm, setVendorForm] = useState({ name: '', gst_number: '', address: '', default_category: '' });

  const fetchUtilityEmails = async () => {
    try {
      const res = await fetch('/api/finance/utility-emails');
      const json = await res.json();
      setUtilityEmails(json.emails || []);
    } catch (err) { console.error(err); }
  };

  const handleAddEmail = async () => {
    if (!newEmail.email) return;
    try {
      const res = await fetch('/api/finance/utility-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEmail),
      });
      if (!res.ok) throw new Error('Thêm thất bại');
      showToast('Đã thêm email nhà cung cấp', 'success');
      setNewEmail({ email: '', provider_name: '' });
      fetchUtilityEmails();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  const handleDeleteEmail = async (id: number) => {
    if (!confirm('Xóa email này?')) return;
    try {
      await fetch('/api/finance/utility-emails', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      fetchUtilityEmails();
      showToast('Đã xóa', 'success');
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  useEffect(() => {
    if (isOpen) {
      if (tab === 'vendors') fetchVendors();
      if (tab === 'gmail') fetchUtilityEmails();
    }
  }, [isOpen, tab]);

  const showToast = (text: string, type: 'success' | 'error') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vendor-settings');
      const json = await res.json();
      // API này trả về { vendors: [...] }
      setVendors(Array.isArray(json.vendors) ? json.vendors : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateVendor = async () => {
    if (!vendorForm.name) return;
    try {
      const res = await fetch('/api/vendor-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vendorForm),
      });
      if (!res.ok) throw new Error('Failed to create');
      showToast('Đã thêm Vendor', 'success');
      setVendorCreateOpen(false);
      setVendorForm({ name: '', gst_number: '', address: '', default_category: '' });
      fetchVendors();
      window.dispatchEvent(new CustomEvent('vendor-settings-updated'));
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const toggleGstMode = async (id: string, currentMode: boolean) => {
    try {
      const res = await fetch('/api/vendor-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor_id: id, prices_include_gst: !currentMode }),
      });
      if (!res.ok) throw new Error('Update failed');
      fetchVendors();
      window.dispatchEvent(new CustomEvent('vendor-settings-updated'));
    } catch (err) {
      showToast('Lỗi cập nhật GST', 'error');
    }
  };

  const handleDeleteVendor = async (id: string, name: string) => {
    if (!window.confirm(`Xóa nhà cung cấp "${name}"?`)) return;
    try {
      const res = await fetch('/api/vendor-settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor_id: id }),
      });
      if (!res.ok) throw new Error('Delete failed');
      showToast('Đã xóa Vendor', 'success');
      fetchVendors();
      window.dispatchEvent(new CustomEvent('vendor-settings-updated'));
    } catch (err) {
      showToast('Lỗi khi xóa', 'error');
    }
  };

  const handleCleanupImages = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm(`Xóa tất cả ảnh cũ hơn ${cleanupMonths} tháng? Thao tác này không thể hoàn tác!`)) return;
    setLoading(true);
    try {
      const res = await fetch('/api/maintenance/cleanup-old-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          olderThanMonths: cleanupMonths,
          dryRun: dryRun,
          includeOcrJobImages: cleanupIncludeJobs
        }),
      });
      const json = await res.json();
      if (dryRun) {
        showToast(`Chạy thử: Tìm thấy ${json.totalPlanned || 0} file có thể xóa`, 'success');
      } else {
        showToast(`Đã xóa thành công ${json.totalDeleted || 0} file`, 'success');
      }
    } catch (err) {
      showToast('Lỗi khi dọn dẹp ảnh', 'error');
    } finally {
      setLoading(false);
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
              { id: 'gmail', label: 'Đồng bộ Gmail', icon: '📥' },
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
                ) : vendors.length === 0 ? (
                  <div className="text-center py-20 text-slate-500 bg-slate-900/50 rounded-3xl border border-dashed border-slate-800">Không tìm thấy NCC nào</div>
                ) : (
                  <div className="grid gap-3">
                    {vendors.map((v: any) => (
                      <div key={v.id} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between group hover:border-slate-700 transition-all">
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl bg-indigo-500/10 text-indigo-400 font-bold`}>
                            {v.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-white">{v.name}</div>
                            <div className="text-xs text-slate-500 font-mono mt-1">{v.gst_number || 'No GST'} • {v.default_category || 'No Category'}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Giá bao gồm GST?</div>
                            <button 
                              onClick={() => toggleGstMode(v.id, v.prices_include_gst)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                v.prices_include_gst 
                                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' 
                                  : 'bg-slate-800 border-slate-700 text-slate-400'
                              }`}
                            >
                              {v.prices_include_gst ? 'ĐANG BẬT' : 'ĐANG TẮT'}
                            </button>
                          </div>
                          <button 
                            onClick={() => handleDeleteVendor(v.id, v.name)}
                            className="p-2 text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'gmail' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800 space-y-4">
                <h3 className="text-sm font-black text-indigo-400 uppercase tracking-widest">Thêm Email Nhà Cung Cấp</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Tên nhà cung cấp (VD: Mercury)"
                    value={newEmail.provider_name}
                    onChange={(e) => setNewEmail({ ...newEmail, provider_name: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                  <input
                    type="email"
                    placeholder="Email (VD: noreply@mercury.co.nz)"
                    value={newEmail.email}
                    onChange={(e) => setNewEmail({ ...newEmail, email: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  onClick={handleAddEmail}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-900/20"
                >
                  Thêm vào danh sách quét
                </button>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest px-2">Danh sách email đang quét</h3>
                {utilityEmails.length === 0 ? (
                  <div className="text-center py-10 bg-slate-900/20 rounded-2xl border border-dashed border-slate-800 text-slate-500 text-sm">
                    Chưa có email nào. Hãy thêm email để hệ thống có thể tự động quét hóa đơn.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {utilityEmails.map((item) => (
                      <div key={item.id} className="flex items-center justify-between p-4 bg-slate-900/40 rounded-2xl border border-slate-800/50 hover:bg-slate-800/40 transition-all">
                        <div>
                          <div className="text-sm font-bold text-white">{item.provider_name || 'Không tên'}</div>
                          <div className="text-xs text-slate-500 font-mono mt-1">{item.email}</div>
                        </div>
                        <button
                          onClick={() => handleDeleteEmail(item.id)}
                          className="p-2 text-slate-500 hover:text-rose-500 transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white">Bảo trì hệ thống</h3>
                
                {/* ── Cleanup Catalog ── */}
                <div className="bg-indigo-900/10 border border-indigo-900/30 p-6 rounded-3xl space-y-4">
                  <div className="flex items-start gap-4">
                    <span className="text-2xl text-indigo-400">🧹</span>
                    <div>
                      <h4 className="font-bold text-white text-lg">Dọn dẹp Catalog rác (Orphans)</h4>
                      <p className="text-sm text-slate-400 mt-1">Xóa các NCC, Sản phẩm không còn được tham chiếu bởi bất kỳ hóa đơn nào.</p>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-indigo-900/20 flex items-center justify-end">
                    <button 
                      onClick={async () => {
                        if (!window.confirm('Dọn dẹp các mục không sử dụng?')) return;
                        setLoading(true);
                        try {
                          const res = await fetch('/api/maintenance/cleanup-orphans', { method: 'POST' });
                          const json = await res.json();
                          const r = json.result || {};
                          showToast(`Đã xóa: ${r.deleted_vendors || 0} NCC, ${r.deleted_restaurant_products || 0} SP`, 'success');
                          fetchVendors();
                        } catch (err) {
                          showToast('Lỗi khi dọn dẹp', 'error');
                        } finally {
                          setLoading(false);
                        }
                      }}
                      className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-900/40"
                    >
                      Chạy dọn dẹp Catalog
                    </button>
                  </div>
                </div>

                {/* ── Cleanup Images ── */}
                <div className="bg-rose-900/10 border border-rose-900/30 p-6 rounded-3xl space-y-5">
                  <div className="flex items-start gap-4">
                    <span className="text-2xl text-rose-400">🖼️</span>
                    <div>
                      <h4 className="font-bold text-white text-lg">Dọn dẹp kho ảnh hóa đơn</h4>
                      <p className="text-sm text-slate-400 mt-1">Xóa các file ảnh/PDF trong Storage để giải phóng dung lượng (5GB giới hạn).</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                      <label className="block">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Xóa ảnh cũ hơn (Tháng)</span>
                        <input 
                          type="number" 
                          min={1} 
                          value={cleanupMonths} 
                          onChange={e => setCleanupMonths(parseInt(e.target.value) || 6)}
                          className="w-full mt-2 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-white outline-none focus:border-rose-500"
                        />
                      </label>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800 flex items-center gap-3">
                      <input 
                        type="checkbox" 
                        id="include-jobs"
                        checked={cleanupIncludeJobs} 
                        onChange={e => setCleanupIncludeJobs(e.target.checked)}
                        className="w-5 h-5 rounded bg-slate-800 border-slate-700 text-rose-600"
                      />
                      <label htmlFor="include-jobs" className="text-sm text-slate-300 cursor-pointer select-none">
                        Bao gồm cả ảnh tạm của OCR Jobs
                      </label>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-rose-900/20 flex flex-wrap items-center justify-between gap-4">
                    <span className="text-xs text-slate-500 font-medium italic">⚠️ Lưu ý: File đã xóa sẽ không thể phục hồi.</span>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleCleanupImages(true)}
                        className="px-4 py-2 bg-slate-800 text-slate-200 rounded-xl text-sm font-bold hover:bg-slate-700 transition-all border border-slate-700"
                      >
                        Chạy thử (Dry Run)
                      </button>
                      <button 
                        onClick={() => handleCleanupImages(false)}
                        className="px-5 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-bold hover:bg-rose-500 transition-all shadow-lg shadow-rose-900/40"
                      >
                        Xóa vĩnh viễn
                      </button>
                    </div>
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
