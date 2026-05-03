'use client';
import { useState, useEffect, useCallback } from 'react';
import { fmtDate, type FinanceTab, type DatePreset, type DailySale, type UtilityBill, type LabourCost, type OtherExpense, type FinanceSummary } from './components/types';
import OverviewTab from './components/OverviewTab';
import RevenueTab from './components/RevenueTab';
import PurchasesTab from './components/PurchasesTab';
import UtilityTab from './components/UtilityTab';
import LabourTab from './components/LabourTab';
import OtherExpTab from './components/OtherExpTab';
import GlobalSettingsModal from './components/GlobalSettingsModal';

const TABS: { key: FinanceTab; label: string; icon: string; color: string }[] = [
  { key: 'overview', label: 'Tổng Quan', icon: '📊', color: 'indigo' },
  { key: 'revenue', label: 'Doanh Thu', icon: '📈', color: 'emerald' },
  { key: 'purchases', label: 'Nguyên Vật Liệu', icon: '🥩', color: 'blue' },
  { key: 'utility', label: 'Vận Hành', icon: '⚡', color: 'amber' },
  { key: 'labour', label: 'Nhân Công', icon: '👷', color: 'teal' },
  { key: 'other', label: 'Chi Phí Khác', icon: '📦', color: 'rose' },
];

function getDateRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  if (preset === 'all') return { from: '', to: '' };
  if (preset === 'day') return { from: fmtDate(now), to: fmtDate(now) };
  if (preset === 'week') {
    const day = now.getDay();
    const diff = (day + 6) % 7;
    const start = new Date(now); start.setDate(now.getDate() - diff);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { from: fmtDate(start), to: fmtDate(end) };
  }
  if (preset === 'last_week') {
    const day = now.getDay();
    const diff = (day + 6) % 7;
    const thisWeekStart = new Date(now); thisWeekStart.setDate(now.getDate() - diff);
    const start = new Date(thisWeekStart); start.setDate(thisWeekStart.getDate() - 7);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { from: fmtDate(start), to: fmtDate(end) };
  }
  if (preset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: fmtDate(start), to: fmtDate(end) };
  }
  if (preset === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: fmtDate(start), to: fmtDate(end) };
  }
  return { from: '', to: '' };
}

export default function FinancePage() {
  const [tab, setTab] = useState<FinanceTab>('overview');
  const [datePreset, setDatePreset] = useState<DatePreset>('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customFrom, setCustomFrom] = useState(fmtDate(new Date()));
  const [customTo, setCustomTo] = useState(fmtDate(new Date()));
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Data states
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [sales, setSales] = useState<DailySale[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [bills, setBills] = useState<UtilityBill[]>([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const [labourCosts, setLabourCosts] = useState<LabourCost[]>([]);
  const [labourLoading, setLabourLoading] = useState(false);
  const [otherExp, setOtherExp] = useState<OtherExpense[]>([]);
  const [otherLoading, setOtherLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const showToast = (text: string, type: 'success' | 'error') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Cache Logic ──────────────────────────────────────────────────────
  const CACHE_PREFIX = 'madam-yen:finance:';
  const writeCache = (key: string, data: any) => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }));
  };
  const readCache = (key: string) => {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    try {
      const { data, savedAt } = JSON.parse(raw);
      // Cache hết hạn sau 30 phút
      if (Date.now() - savedAt > 30 * 60 * 1000) return null;
      return data;
    } catch { return null; }
  };
  const clearFinanceCache = () => {
    if (typeof window === 'undefined') return;
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) window.sessionStorage.removeItem(key);
    }
  };

  const applyPreset = useCallback((preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') return;
    const { from, to } = getDateRange(preset);
    setDateFrom(from);
    setDateTo(to);
  }, []);

  useEffect(() => { applyPreset('month'); }, [applyPreset]);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set('from', dateFrom);
    if (dateTo) p.set('to', dateTo);
    return p.toString();
  }, [dateFrom, dateTo]);

  // Fetchers
  const fetchSummary = useCallback(async () => {
    const cacheKey = `summary:${buildParams()}`;
    const cached = readCache(cacheKey);
    if (cached) { setSummary(cached); return; }

    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/finance/summary?${buildParams()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSummary(json);
      writeCache(cacheKey, json);
    } catch { setSummary(null); }
    finally { setSummaryLoading(false); }
  }, [buildParams]);

  const fetchSales = useCallback(async () => {
    const cacheKey = `sales:${buildParams()}`;
    const cached = readCache(cacheKey);
    if (cached) { setSales(cached); return; }

    setSalesLoading(true);
    try {
      const res = await fetch(`/api/finance/revenue?${buildParams()}`);
      const json = await res.json();
      const data = Array.isArray(json.sales) ? json.sales : [];
      setSales(data);
      writeCache(cacheKey, data);
    } catch { setSales([]); }
    finally { setSalesLoading(false); }
  }, [buildParams]);

  const fetchBills = useCallback(async () => {
    const cacheKey = `bills:${buildParams()}`;
    const cached = readCache(cacheKey);
    if (cached) { setBills(cached); return; }

    setBillsLoading(true);
    try {
      const res = await fetch(`/api/finance/utility-bills?${buildParams()}`);
      const json = await res.json();
      const data = Array.isArray(json.bills) ? json.bills : [];
      setBills(data);
      writeCache(cacheKey, data);
    } catch { setBills([]); }
    finally { setBillsLoading(false); }
  }, [buildParams]);

  const fetchLabour = useCallback(async () => {
    const cacheKey = `labour:${buildParams()}`;
    const cached = readCache(cacheKey);
    if (cached) { setLabourCosts(cached); return; }

    setLabourLoading(true);
    try {
      const res = await fetch(`/api/finance/labour?${buildParams()}`);
      const json = await res.json();
      const data = Array.isArray(json.costs) ? json.costs : [];
      setLabourCosts(data);
      writeCache(cacheKey, data);
    } catch { setLabourCosts([]); }
    finally { setLabourLoading(false); }
  }, [buildParams]);

  const fetchOther = useCallback(async () => {
    const cacheKey = `other:${buildParams()}`;
    const cached = readCache(cacheKey);
    if (cached) { setOtherExp(cached); return; }

    setOtherLoading(true);
    try {
      const res = await fetch(`/api/finance/other-expenses?${buildParams()}`);
      const json = await res.json();
      const data = Array.isArray(json.expenses) ? json.expenses : [];
      setOtherExp(data);
      writeCache(cacheKey, data);
    } catch { setOtherExp([]); }
    finally { setOtherLoading(false); }
  }, [buildParams]);

  const refreshAll = useCallback(async () => {
    void fetchSummary();
    if (tab === 'revenue') void fetchSales();
    if (tab === 'utility') void fetchBills();
    if (tab === 'labour') void fetchLabour();
    if (tab === 'other') void fetchOther();
  }, [tab, fetchSummary, fetchSales, fetchBills, fetchLabour, fetchOther]);

  useEffect(() => {
    refreshAll();
  }, [dateFrom, dateTo, tab, refreshAll]);

  useEffect(() => {
    const handleDataChange = () => {
      console.log('External data change detected, clearing finance cache and refreshing...');
      clearFinanceCache();
      refreshAll();
    };
    window.addEventListener('finance-data-changed', handleDataChange);
    return () => window.removeEventListener('finance-data-changed', handleDataChange);
  }, [refreshAll]);

  // CRUD handlers
  const addRevenue = async (data: Record<string, string>) => {
    try {
      const res = await fetch('/api/finance/revenue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      showToast('Đã thêm doanh thu', 'success');
      clearFinanceCache();
      fetchSales();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const deleteRevenue = async (id: string) => {
    if (!confirm('Xóa entry này?')) return;
    try {
      const res = await fetch(`/api/finance/revenue?id=${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      showToast('Đã xóa', 'success');
      clearFinanceCache();
      fetchSales();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const addBill = async (data: Record<string, string>) => {
    try {
      const res = await fetch('/api/finance/utility-bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      showToast('Đã thêm hóa đơn', 'success');
      clearFinanceCache();
      fetchBills();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const deleteBill = async (id: string) => {
    if (!confirm('Xóa hóa đơn này?')) return;
    try {
      const res = await fetch(`/api/finance/utility-bills/${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      showToast('Đã xóa', 'success');
      clearFinanceCache();
      fetchBills();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const addLabour = async (data: Record<string, string>) => {
    try {
      const res = await fetch('/api/finance/labour', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      showToast('Đã thêm chi phí nhân công', 'success');
      clearFinanceCache();
      fetchLabour();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const deleteLabour = async (id: string) => {
    if (!confirm('Xóa entry này?')) return;
    try {
      const res = await fetch(`/api/finance/labour/${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      showToast('Đã xóa', 'success');
      fetchLabour();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const addOther = async (data: Record<string, string>) => {
    try {
      const res = await fetch('/api/finance/other-expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      showToast('Đã thêm chi phí', 'success');
      fetchOther();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const deleteOther = async (id: string) => {
    if (!confirm('Xóa entry này?')) return;
    try {
      const res = await fetch(`/api/finance/other-expenses/${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      showToast('Đã xóa', 'success');
      fetchOther();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  const presets: { key: DatePreset; label: string }[] = [
    { key: 'day', label: 'Hôm nay' },
    { key: 'week', label: 'Tuần này' },
    { key: 'last_week', label: 'Tuần trước' },
    { key: 'month', label: 'Tháng này' },
    { key: 'last_month', label: 'Tháng trước' },
    { key: 'custom', label: 'Tùy chọn 📅' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex overflow-hidden">
      {/* ── SIDEBAR (Left) ────────────────────────────────────────────────── */}
      <aside className="w-72 bg-slate-900/50 border-r border-slate-800/60 backdrop-blur-xl flex flex-col h-screen sticky top-0 z-40 shrink-0">
        <div className="p-6 flex flex-col h-full">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/40">
              <span className="text-xl font-black">FN</span>
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white leading-none uppercase">Finance</h1>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Madam Yen System</span>
            </div>
          </div>

          {/* Date Presets Group */}
          <div className="space-y-4 mb-8">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-2">Thời gian lọc</div>
            <div className="grid grid-cols-2 gap-2">
              {presets.map(p => (
                <button 
                  key={p.key} 
                  onClick={() => applyPreset(p.key)}
                  className={`px-3 py-2.5 rounded-xl text-[11px] font-bold transition-all duration-300 border ${
                    datePreset === p.key 
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-900/30' 
                      : 'bg-slate-800/40 text-slate-400 border-slate-700/50 hover:border-slate-600 hover:text-slate-200'
                  }`}
                >
                  {p.label.replace(' 📅', '')}
                </button>
              ))}
            </div>

            {datePreset === 'custom' && (
              <div className="space-y-2 p-3 bg-slate-950/50 rounded-2xl border border-slate-800/60 animate-in slide-in-from-top-2 duration-300">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 font-bold ml-1">TỪ</label>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-full bg-slate-900 border-none rounded-lg text-xs text-indigo-300 font-mono focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 font-bold ml-1">ĐẾN</label>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-full bg-slate-900 border-none rounded-lg text-xs text-indigo-300 font-mono focus:ring-1 focus:ring-indigo-500" />
                </div>
                <button onClick={() => { setDateFrom(customFrom); setDateTo(customTo); }} className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all mt-1">
                  Áp dụng
                </button>
              </div>
            )}
          </div>

          {/* Navigation Menu */}
          <div className="space-y-1 flex-1 overflow-y-auto custom-scrollbar pr-1">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-2 mb-3">Phân mục chính</div>
            {TABS.map(t => (
              <button 
                key={t.key} 
                onClick={() => setTab(t.key)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all duration-300 mb-1 border ${
                  tab === t.key 
                    ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/20 shadow-inner' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border-transparent'
                }`}
              >
                <span className={`text-xl ${tab === t.key ? 'scale-110 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'opacity-60'}`}>{t.icon}</span>
                {t.label}
                {tab === t.key && <div className="ml-auto w-1.5 h-1.5 bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.8)]" />}
              </button>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-slate-800/60 space-y-2">
            <button 
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800/40 transition-all border border-transparent hover:border-slate-700/50"
            >
              <span className="text-xl">⚙️</span>
              Cài đặt hệ thống
            </button>
            <button 
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
                window.location.href = '/login';
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all border border-transparent hover:border-rose-500/20"
            >
              <span className="text-xl">🚪</span>
              Đăng xuất
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT (Right) ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-950">
        <header className="h-20 border-b border-slate-800/60 bg-slate-900/20 backdrop-blur-md flex items-center justify-between px-10 shrink-0">
          <div className="flex flex-col">
             <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-white">{TABS.find(x => x.key === tab)?.label}</h2>
                <div className="px-2 py-0.5 bg-indigo-500/10 rounded-md border border-indigo-500/20 text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                  Active
                </div>
             </div>
             <p className="text-xs text-slate-500 font-bold mt-0.5">
               Dữ liệu từ <span className="text-indigo-400 font-mono">{dateFrom || '...'}</span> đến <span className="text-indigo-400 font-mono">{dateTo || '...'}</span>
             </p>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => refreshAll(true)}
              className={`p-3 rounded-2xl bg-slate-800/50 text-slate-400 hover:text-white hover:bg-slate-700 transition-all border border-slate-700/50 shadow-xl ${summaryLoading ? 'animate-spin' : ''}`}
              title="Làm mới dữ liệu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <div className="h-10 w-[1px] bg-slate-800/60" />
            <div className="flex items-center gap-3 pl-2">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-black text-white leading-none">ADMIN</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Manager</div>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-xs font-black text-white shadow-lg border border-white/10">
                AD
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-10 custom-scrollbar">
          <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
            {tab === 'overview' && <OverviewTab summary={summary} loading={summaryLoading} />}
            {tab === 'revenue' && <RevenueTab sales={sales} loading={salesLoading} onAdd={addRevenue} onDelete={deleteRevenue} />}
            {tab === 'purchases' && <PurchasesTab dateFrom={dateFrom} dateTo={dateTo} />}
            {tab === 'utility' && <UtilityTab bills={bills} loading={billsLoading} onAdd={addBill} onDelete={deleteBill} />}
            {tab === 'labour' && <LabourTab costs={labourCosts} loading={labourLoading} onAdd={addLabour} onDelete={deleteLabour} />}
            {tab === 'other' && <OtherExpTab expenses={otherExp} loading={otherLoading} onAdd={addOther} onDelete={deleteOther} />}
          </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-8 right-8 z-50 px-6 py-3 rounded-2xl shadow-2xl text-sm font-bold text-white border animate-in slide-in-from-bottom-4 duration-300 ${toast.type === 'success' ? 'bg-emerald-600 border-emerald-500' : 'bg-rose-600 border-rose-500'}`}>
          {toast.text}
        </div>
      )}
      
      {/* Global Settings Modal */}
      <GlobalSettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
