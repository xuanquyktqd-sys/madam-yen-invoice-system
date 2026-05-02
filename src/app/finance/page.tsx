'use client';
import { useState, useEffect, useCallback } from 'react';
import { fmtDate, type FinanceTab, type DatePreset, type DailySale, type UtilityBill, type LabourCost, type OtherExpense, type FinanceSummary } from './components/types';
import OverviewTab from './components/OverviewTab';
import RevenueTab from './components/RevenueTab';
import UtilityTab from './components/UtilityTab';
import LabourTab from './components/LabourTab';
import OtherExpTab from './components/OtherExpTab';

const TABS: { key: FinanceTab; label: string; icon: string; color: string }[] = [
  { key: 'overview', label: 'Tổng Quan', icon: '📊', color: 'indigo' },
  { key: 'revenue', label: 'Doanh Thu', icon: '📈', color: 'emerald' },
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

  const showToast = (text: string, type: 'success' | 'error') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
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
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/finance/summary?${buildParams()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSummary(json);
    } catch { setSummary(null); }
    finally { setSummaryLoading(false); }
  }, [buildParams]);

  const fetchSales = useCallback(async () => {
    setSalesLoading(true);
    try {
      const res = await fetch(`/api/finance/revenue?${buildParams()}`);
      const json = await res.json();
      setSales(Array.isArray(json.sales) ? json.sales : []);
    } catch { setSales([]); }
    finally { setSalesLoading(false); }
  }, [buildParams]);

  const fetchBills = useCallback(async () => {
    setBillsLoading(true);
    try {
      const res = await fetch(`/api/finance/utility-bills?${buildParams()}`);
      const json = await res.json();
      setBills(Array.isArray(json.bills) ? json.bills : []);
    } catch { setBills([]); }
    finally { setBillsLoading(false); }
  }, [buildParams]);

  const fetchLabour = useCallback(async () => {
    setLabourLoading(true);
    try {
      const res = await fetch(`/api/finance/labour?${buildParams()}`);
      const json = await res.json();
      setLabourCosts(Array.isArray(json.costs) ? json.costs : []);
    } catch { setLabourCosts([]); }
    finally { setLabourLoading(false); }
  }, [buildParams]);

  const fetchOther = useCallback(async () => {
    setOtherLoading(true);
    try {
      const res = await fetch(`/api/finance/other-expenses?${buildParams()}`);
      const json = await res.json();
      setOtherExp(Array.isArray(json.expenses) ? json.expenses : []);
    } catch { setOtherExp([]); }
    finally { setOtherLoading(false); }
  }, [buildParams]);

  // Fetch on tab/date change
  useEffect(() => {
    if (tab === 'overview') fetchSummary();
    if (tab === 'revenue') fetchSales();
    if (tab === 'utility') fetchBills();
    if (tab === 'labour') fetchLabour();
    if (tab === 'other') fetchOther();
  }, [tab, dateFrom, dateTo, fetchSummary, fetchSales, fetchBills, fetchLabour, fetchOther]);

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200/60 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                💰 Finance Dashboard
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">Madam Yen — Quản lý Tài chính</p>
            </div>
            <div className="flex items-center gap-3">
              <a href="/dashboard" className="px-3 py-1.5 text-sm text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                ← Invoices
              </a>
              <a href="/upload" className="px-3 py-1.5 text-sm text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                📸 Upload OCR
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Date filters */}
        <div className="flex flex-wrap items-center gap-2">
          {presets.map(p => (
            <button key={p.key} onClick={() => applyPreset(p.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${datePreset === p.key ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-indigo-300'}`}>
              {p.label}
            </button>
          ))}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" />
              <span className="text-gray-400">→</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" />
              <button onClick={() => { setDateFrom(customFrom); setDateTo(customTo); }} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
                Apply
              </button>
            </div>
          )}
          {dateFrom && dateTo && <span className="text-xs text-gray-400 ml-2">{dateFrom} → {dateTo}</span>}
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 shadow-sm overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${tab === t.key ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-h-[400px]">
          {tab === 'overview' && <OverviewTab summary={summary} loading={summaryLoading} />}
          {tab === 'revenue' && <RevenueTab sales={sales} loading={salesLoading} onAdd={addRevenue} onDelete={deleteRevenue} />}
          {tab === 'utility' && <UtilityTab bills={bills} loading={billsLoading} onAdd={addBill} onDelete={deleteBill} />}
          {tab === 'labour' && <LabourTab costs={labourCosts} loading={labourLoading} onAdd={addLabour} onDelete={deleteLabour} />}
          {tab === 'other' && <OtherExpTab expenses={otherExp} loading={otherLoading} onAdd={addOther} onDelete={deleteOther} />}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white animate-[slideUp_0.3s_ease-out] ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
