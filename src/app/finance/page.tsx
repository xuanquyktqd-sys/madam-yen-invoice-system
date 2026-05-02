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
  if (preset === 'week') {
    const day = now.getDay();
    const diff = (day + 6) % 7;
    const start = new Date(now); start.setDate(now.getDate() - diff);
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
      fetchSales();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const deleteRevenue = async (id: string) => {
    if (!confirm('Xóa entry này?')) return;
    try {
      const res = await fetch(`/api/finance/revenue?id=${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      showToast('Đã xóa', 'success');
      fetchSales();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const addBill = async (data: Record<string, string>) => {
    try {
      const res = await fetch('/api/finance/utility-bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      showToast('Đã thêm hóa đơn', 'success');
      fetchBills();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const deleteBill = async (id: string) => {
    if (!confirm('Xóa hóa đơn này?')) return;
    try {
      const res = await fetch(`/api/finance/utility-bills/${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      showToast('Đã xóa', 'success');
      fetchBills();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };
  const addLabour = async (data: Record<string, string>) => {
    try {
      const res = await fetch('/api/finance/labour', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      showToast('Đã thêm chi phí nhân công', 'success');
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
    { key: 'week', label: 'Tuần này' },
    { key: 'month', label: 'Tháng này' },
    { key: 'last_month', label: 'Tháng trước' },
    { key: 'all', label: 'Tất cả' },
    { key: 'custom', label: 'Tùy chọn' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black text-sm">
                FN
              </div>
              <div>
                <h1 className="text-base font-bold text-white leading-none">
                  Madam Yen Finance
                </h1>
                <p className="text-xs text-slate-400 mt-1">Hệ thống Quản lý Tài chính</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border border-slate-700 shadow-lg"
              >
                ⚙️ Cài đặt
              </button>
              <button
                onClick={async () => {
                  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
                  window.location.href = '/login';
                }}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-400 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border border-slate-700"
              >
                🚪 Thoát
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Date filters */}
        <div className="flex flex-wrap items-center gap-2">
          {presets.map(p => (
            <button key={p.key} onClick={() => applyPreset(p.key)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all border ${datePreset === p.key ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-900/40' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'}`}>
              {p.label}
            </button>
          ))}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2 ml-2 bg-slate-800 p-1.5 rounded-xl border border-slate-700">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="bg-transparent border-none focus:ring-0 text-sm text-white" />
              <span className="text-slate-500">→</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="bg-transparent border-none focus:ring-0 text-sm text-white" />
              <button onClick={() => { setDateFrom(customFrom); setDateTo(customTo); }} className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
                Lọc
              </button>
            </div>
          )}
          {dateFrom && dateTo && <span className="text-xs text-slate-500 ml-2">{dateFrom} → {dateTo}</span>}
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 bg-slate-900 rounded-2xl border border-slate-800 p-1.5 shadow-2xl overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${tab === t.key ? 'bg-slate-800 text-white border border-slate-700 shadow-inner' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}>
              <span className="text-base">{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-h-[500px] animate-in fade-in duration-500">
          {tab === 'overview' && <OverviewTab summary={summary} loading={summaryLoading} />}
          {tab === 'revenue' && <RevenueTab sales={sales} loading={salesLoading} onAdd={addRevenue} onDelete={deleteRevenue} />}
          {tab === 'purchases' && <PurchasesTab />}
          {tab === 'utility' && <UtilityTab bills={bills} loading={billsLoading} onAdd={addBill} onDelete={deleteBill} />}
          {tab === 'labour' && <LabourTab costs={labourCosts} loading={labourLoading} onAdd={addLabour} onDelete={deleteLabour} />}
          {tab === 'other' && <OtherExpTab expenses={otherExp} loading={otherLoading} onAdd={addOther} onDelete={deleteOther} />}
        </div>
      </main>

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
