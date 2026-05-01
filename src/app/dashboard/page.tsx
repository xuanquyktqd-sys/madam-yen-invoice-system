'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────
type InvoiceItem = {
  id?: string;
  product_code: string | null;
  description: string;
  standard?: string | null;
  quantity: number;
  unit: string | null;
  price: number;
  amount_excl_gst: number;
};

type Invoice = {
  id: string;
  type: string;
  vendor_name: string;
  vendor_gst_number: string | null;
  vendor_id?: string | null;
  invoice_number: string | null;
  invoice_date: string;
  currency: string;
  is_tax_invoice: boolean;
  sub_total: number;
  freight: number;
  gst_amount: number;
  total_amount: number;
  image_url: string | null;
  status: 'pending_review' | 'approved' | 'rejected';
  category: string | null;
  parent_invoice_id?: string | null;
  invoice_items: InvoiceItem[];
};

type UploadStep = 'idle' | 'preview' | 'confirming' | 'processing' | 'done' | 'error';
type FilterStatus = 'all' | 'pending_review' | 'approved' | 'rejected';
type DatePreset = 'all' | 'day' | 'month' | 'custom';
type DashboardView = 'list' | 'report';

type ReportVendorSummary = {
  vendor_name: string;
  invoice_count: number;
  total_ex_gst: number;
  total_inc_gst: number;
  gst_total: number;
};

type ReportProductSummary = {
  product_key: string;
  product_name: string;
  vendor_name: string;
  unit: string | null;
  total_qty: number;
  total_ex_gst: number;
  total_inc_gst: number;
  last_price_ex_gst: number | null;
};

type ReportPriceInsight = {
  product_key: string;
  product_name: string;
  vendor_name: string;
  previous_price_ex_gst: number;
  latest_price_ex_gst: number;
  delta: number;
  pct_change: number;
  previous_invoice_date: string;
  latest_invoice_date: string;
};

type CostReport = {
  vendor_summary: ReportVendorSummary[];
  product_summary: ReportProductSummary[];
  price_insights: {
    increased: ReportPriceInsight[];
    decreased: ReportPriceInsight[];
  };
};

type OcrJob = {
  id: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  invoice_id: string | null;
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  ocr_provider: string | null;
  ocr_model: string | null;
  next_run_at: string | null;
};

type ActiveOcrJob = OcrJob & {
  public_url?: string | null;
  created_at?: string;
  updated_at?: string;
};

type OcrNotification = {
  id: string;
  status: 'succeeded' | 'failed';
  invoice_id: string | null;
  public_url: string | null;
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  ocr_provider: string | null;
  ocr_model: string | null;
  created_at: string;
  finished_at: string | null;
  invoice: null | {
    id: string;
    vendor_name: string;
    invoice_number: string | null;
    invoice_date: string | null;
    total_amount: string | number | null;
  };
};

type VendorSetting = {
  id: string;
  name: string;
  gst_number: string | null;
  prices_include_gst: boolean;
};

type CacheEntry<T> = {
  data: T;
  savedAt: number;
};

type InvoiceListCache = {
  invoices: Invoice[];
  total: number;
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const formatNZD = (n: number) =>
  new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(n);
const formatPct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const formatRelativeWait = (value: string | null) => {
  if (!value) return null;
  const diffMs = new Date(value).getTime() - Date.now();
  if (diffMs <= 0) return 'retrying';
  const seconds = Math.max(1, Math.round(diffMs / 1000));
  return `retry in ${seconds}s`;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatYmdLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const toNumberOrNullInput = (value: string) => {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt2 = (n: number) => round2(n).toFixed(2);

const calcTotalsFromRows = (
  rows: Array<{ amount_excl_gst: string; quantity: string; price: string }>,
  freightStr: string
) => {
  const freight = toNumberOrNullInput(freightStr) ?? 0;
  const subAbs = rows.reduce((sum, r) => {
    const q = toNumberOrNullInput(r.quantity) ?? 0;
    const p = toNumberOrNullInput(r.price) ?? 0;
    // amount_excl_gst is always derived for manual/credit/edit inputs
    return sum + round2(q * p);
  }, 0);
  const subTotal = round2(subAbs);
  const gst = round2(subTotal * 0.15);
  const total = round2(subTotal + freight + gst);
  return { sub_total: fmt2(subTotal), gst_amount: fmt2(gst), total_amount: fmt2(total) };
};

const statusConfig = {
  pending_review: { label: 'Pending', bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-400' },
  approved: { label: 'Approved', bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  rejected: { label: 'Rejected', bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-400' },
};

const safeReadJson = async (res: Response): Promise<{ json: unknown; text: string }> => {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
};

const CACHE_PREFIX = 'madam-yen:v1:';
const INVOICE_CACHE_PREFIX = `${CACHE_PREFIX}invoices:`;
const REPORT_CACHE_PREFIX = `${CACHE_PREFIX}cost-report:`;
const VENDOR_SETTINGS_CACHE_KEY = `${CACHE_PREFIX}vendor-settings`;
const CATALOG_VENDORS_CACHE_KEY = `${CACHE_PREFIX}catalog:vendors`;
const CATALOG_UNITS_CACHE_KEY = `${CACHE_PREFIX}catalog:units`;

const readSessionCache = <T,>(key: string): T | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return entry?.data ?? null;
  } catch {
    return null;
  }
};

const writeSessionCache = <T,>(key: string, data: T) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() } satisfies CacheEntry<T>));
  } catch {
    // Cache is only an optimization; ignore quota/private-mode failures.
  }
};

const removeSessionCache = (key: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {}
};

const removeSessionCacheByPrefix = (prefix: string) => {
  if (typeof window === 'undefined') return;
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(prefix)) window.sessionStorage.removeItem(key);
    }
  } catch {}
};

const makeParamCacheKey = (prefix: string, params: URLSearchParams) =>
  `${prefix}${params.toString() || 'all'}`;

const normalizeVendorName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

// ─── Dashboard Page ──────────────────────────────────────────────────────────
export default function DashboardPage() {
  type MoneyFieldKey = 'sub_total' | 'freight' | 'gst_amount' | 'total_amount';
  type MoneyFormState = {
    vendor_name: string;
    vendor_gst_number: string;
    invoice_number: string;
    invoice_date: string;
    category: string;
    sub_total: string;
    freight: string;
    gst_amount: string;
    total_amount: string;
  };

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dashboardView, setDashboardView] = useState<DashboardView>('list');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [customFrom, setCustomFrom] = useState<string>(formatYmdLocal(new Date()));
  const [customTo, setCustomTo] = useState<string>(formatYmdLocal(new Date()));
  const [reportLoading, setReportLoading] = useState(false);
  const [costReport, setCostReport] = useState<CostReport | null>(null);
  const [reportVendorFilter, setReportVendorFilter] = useState('');
  const [reportProductSearch, setReportProductSearch] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageRotation, setImageRotation] = useState(0);
  const [uploadStep, setUploadStep] = useState<UploadStep>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewSizeKB, setPreviewSizeKB] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processingMsg, setProcessingMsg] = useState('');
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' | 'warn' } | null>(null);
  const [activeOcrJobId, setActiveOcrJobId] = useState<string | null>(null);
  const [uploadModalHidden, setUploadModalHidden] = useState(false);
  const [activeOcrJobs, setActiveOcrJobs] = useState<ActiveOcrJob[]>([]);
  const [activeJobRetryId, setActiveJobRetryId] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [ocrNotifications, setOcrNotifications] = useState<OcrNotification[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [jobPreview, setJobPreview] = useState<null | { jobId: string; imageUrl: string | null }>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollStartedAtRef = useRef<number>(0);
  const autoRetryTriggeredRef = useRef(false);
  const activeJobsPollRef = useRef<number | null>(null);
  const previousActiveJobIdsRef = useRef<string[]>([]);
  const lastHydratedInvoiceIdRef = useRef<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [reviewMenuOpen, setReviewMenuOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [unitOptions, setUnitOptions] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'vendors' | 'maintenance'>('vendors');
  const [vendorSettings, setVendorSettings] = useState<VendorSetting[]>([]);
  const [vendorSettingsLoading, setVendorSettingsLoading] = useState(false);
  const [vendorSettingsSavingId, setVendorSettingsSavingId] = useState<string | null>(null);
  const [vendorCreateOpen, setVendorCreateOpen] = useState(false);
  const [vendorCreateForm, setVendorCreateForm] = useState({ name: '', gst_number: '', address: '', prices_include_gst: false });
  const [vendorCreateSaving, setVendorCreateSaving] = useState(false);
  const [cleanupOldImagesMonths, setCleanupOldImagesMonths] = useState(3);
  const [cleanupOldImagesMonthsText, setCleanupOldImagesMonthsText] = useState('3');
  const [cleanupOldImagesIncludeJobs, setCleanupOldImagesIncludeJobs] = useState(false);
  const [cleanupOldImagesBusy, setCleanupOldImagesBusy] = useState(false);
  const [manualProductOptions, setManualProductOptions] = useState<Array<{
    name: string;
    vendor_product_code: string | null;
    unit: string | null;
    standard: string | null;
  }>>([]);
  const [editProductOptions, setEditProductOptions] = useState<Array<{
    name: string;
    vendor_product_code: string | null;
    unit: string | null;
    standard: string | null;
  }>>([]);
  const [manualForm, setManualForm] = useState<MoneyFormState>({
    vendor_name: '',
    vendor_gst_number: '',
    invoice_number: '',
    invoice_date: new Date().toISOString().slice(0, 10),
    category: '',
    sub_total: '',
    freight: '',
    gst_amount: '',
    total_amount: '',
  });
  const [manualItems, setManualItems] = useState<Array<{
    product_code: string;
    description: string;
    quantity: string;
    unit: string;
    price: string;
    amount_excl_gst: string;
  }>>([{ product_code: '', description: '', quantity: '', unit: '', price: '', amount_excl_gst: '0.00' }]);

  const [editMode, setEditMode] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState<MoneyFormState>({
    vendor_name: '',
    vendor_gst_number: '',
    invoice_number: '',
    invoice_date: '',
    category: '',
    sub_total: '',
    freight: '',
    gst_amount: '',
    total_amount: '',
  });
  const [editItems, setEditItems] = useState<Array<{
    product_code: string;
    description: string;
    quantity: string;
    standard: string;
    unit: string;
    price: string;
    amount_excl_gst: string;
  }>>([]);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditSaving, setCreditSaving] = useState(false);
  const [creditNumber, setCreditNumber] = useState('');
  const [creditDate, setCreditDate] = useState(new Date().toISOString().slice(0, 10));
  const [creditRows, setCreditRows] = useState<Array<{
    source_item_id: string;
    selected: boolean;
    description: string;
    product_code: string;
    standard: string;
    unit: string;
    quantity: string; // positive
    price: string; // positive
    amount_excl_gst: string; // positive
  }>>([]);

  const toDateInput = (value: string) => (value || '').slice(0, 10);
  const formatDisplayDate = (value: string) => toDateInput(value);

  const isCreditInvoice = (inv: Invoice | null): boolean =>
    !!inv && (
      (inv.type ?? '').toLowerCase().includes('credit') ||
      (inv.total_amount ?? 0) < 0 ||
      !!inv.parent_invoice_id
    );

  const applyDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);

    const today = new Date();

    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }

    if (preset === 'custom') {
      // Pause date filter until user clicks "Apply"
      setDateFrom('');
      setDateTo('');
      return;
    }

    if (preset === 'day') {
      const ymd = formatYmdLocal(today);
      setDateFrom(ymd);
      setDateTo(ymd);
      return;
    }

    // month
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    setDateFrom(formatYmdLocal(start));
    setDateTo(formatYmdLocal(end));
  };

  const applyCustomRange = () => {
    const f = customFrom.trim();
    const t = customTo.trim();
    if (!f || !t) {
      showToast('Select both From and To dates', 'error');
      return;
    }
    const from = f <= t ? f : t;
    const to = f <= t ? t : f;
    setDatePreset('custom');
    setDateFrom(from);
    setDateTo(to);
  };

  const buildInvoiceParams = useCallback(() => {
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (search) params.set('search', search);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    return params;
  }, [filterStatus, search, dateFrom, dateTo]);

  const buildReportParams = useCallback(() => {
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (reportVendorFilter.trim()) params.set('vendor', reportVendorFilter.trim());
    if (reportProductSearch.trim()) params.set('product_q', reportProductSearch.trim());
    return params;
  }, [filterStatus, dateFrom, dateTo, reportVendorFilter, reportProductSearch]);

  const invalidateInvoiceCaches = useCallback(() => {
    removeSessionCacheByPrefix(INVOICE_CACHE_PREFIX);
    removeSessionCacheByPrefix(REPORT_CACHE_PREFIX);
  }, []);

  // ── Fetch invoices ────────────────────────────────────────────────────────
  const fetchInvoices = useCallback(async (opts?: { force?: boolean }) => {
    const params = buildInvoiceParams();
    const cacheKey = makeParamCacheKey(INVOICE_CACHE_PREFIX, params);
    if (!opts?.force) {
      const cached = readSessionCache<InvoiceListCache>(cacheKey);
      if (cached) {
        setInvoices(cached.invoices);
        setTotalCount(cached.total);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/invoices?${params.toString()}`);
      const json = await res.json();
      const next = {
        invoices: Array.isArray(json.invoices) ? json.invoices : [],
        total: Number.isFinite(Number(json.total)) ? Number(json.total) : 0,
      };
      setInvoices(next.invoices);
      setTotalCount(next.total);
      writeSessionCache(cacheKey, next);
    } catch {
      showToast('Failed to load invoices', 'error');
    } finally {
      setLoading(false);
    }
  }, [buildInvoiceParams]);

  const fetchInvoiceById = useCallback(async (id: string): Promise<Invoice | null> => {
    const res = await fetch(`/api/invoices?id=${encodeURIComponent(id)}`);
    const { json, text } = await safeReadJson(res);
    const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
    if (!res.ok) {
      throw new Error(String(obj?.error ?? text ?? 'Failed to load invoice'));
    }
    return (obj?.invoice as Invoice | undefined) ?? null;
  }, []);

  const fetchActiveOcrJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/ocr-jobs?limit=8');
      const { json, text } = await safeReadJson(res);
      const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!res.ok) {
        throw new Error(String(obj?.error ?? text ?? 'Failed to load OCR jobs'));
      }
      setActiveOcrJobs(Array.isArray(obj?.jobs) ? (obj.jobs as ActiveOcrJob[]) : []);
    } catch {
      setActiveOcrJobs([]);
    }
  }, []);

  const fetchOcrNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const res = await fetch('/api/ocr-jobs/notifications?limit=20');
      const { json, text } = await safeReadJson(res);
      const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!res.ok) throw new Error(String(obj?.error ?? text ?? 'Failed to load notifications'));
      setOcrNotifications(Array.isArray(obj?.notifications) ? (obj.notifications as OcrNotification[]) : []);
    } catch {
      setOcrNotifications([]);
    } finally {
      setNotifLoading(false);
    }
  }, []);

  const retryActiveOcrJob = useCallback(async (jobId: string) => {
    setActiveJobRetryId(jobId);
    try {
      const res = await fetch(`/api/ocr-jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' });
      const { json, text } = await safeReadJson(res);
      const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!res.ok) throw new Error(String(obj?.error ?? text ?? 'Failed to retry OCR job'));

      showToast('OCR job triggered', 'success');
      await fetchActiveOcrJobs();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setActiveJobRetryId(null);
    }
  }, [fetchActiveOcrJobs]);

  const fetchCostReport = useCallback(async (opts?: { force?: boolean }) => {
    const params = buildReportParams();
    const cacheKey = makeParamCacheKey(REPORT_CACHE_PREFIX, params);
    if (!opts?.force) {
      const cached = readSessionCache<CostReport>(cacheKey);
      if (cached) {
        setCostReport(cached);
        setReportLoading(false);
        return;
      }
    }

    setReportLoading(true);
    try {
      const res = await fetch(`/api/reports/cost?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to load cost report');
      }
      const next = {
        vendor_summary: Array.isArray(json?.vendor_summary) ? json.vendor_summary : [],
        product_summary: Array.isArray(json?.product_summary) ? json.product_summary : [],
        price_insights: {
          increased: Array.isArray(json?.price_insights?.increased) ? json.price_insights.increased : [],
          decreased: Array.isArray(json?.price_insights?.decreased) ? json.price_insights.decreased : [],
        },
      };
      setCostReport(next);
      writeSessionCache(cacheKey, next);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load cost report';
      showToast(message, 'error');
      setCostReport({
        vendor_summary: [],
        product_summary: [],
        price_insights: { increased: [], decreased: [] },
      });
    } finally {
      setReportLoading(false);
    }
  }, [buildReportParams]);

  const refreshAfterInvoiceMutation = useCallback(async () => {
    invalidateInvoiceCaches();
    await fetchInvoices({ force: true });
    if (dashboardView === 'report') {
      await fetchCostReport({ force: true });
    }
  }, [dashboardView, fetchCostReport, fetchInvoices, invalidateInvoiceCaches]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);
  useEffect(() => {
    if (dashboardView !== 'report') return;
    void fetchCostReport();
  }, [dashboardView, fetchCostReport]);
  useEffect(() => { fetchActiveOcrJobs(); }, [fetchActiveOcrJobs]);
  useEffect(() => {
    if (!notifOpen) return;
    void fetchOcrNotifications();
  }, [notifOpen, fetchOcrNotifications]);
  useEffect(() => () => {
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    if (activeJobsPollRef.current) window.clearTimeout(activeJobsPollRef.current);
  }, []);
  useEffect(() => {
    if (activeJobsPollRef.current) window.clearTimeout(activeJobsPollRef.current);
    const hasRunningJobs = activeOcrJobs.length > 0 || uploadStep === 'processing';
    if (!hasRunningJobs) return;

    const tick = () => {
      void fetchActiveOcrJobs();
      activeJobsPollRef.current = window.setTimeout(tick, 5000);
    };

    activeJobsPollRef.current = window.setTimeout(tick, 5000);
    return () => {
      if (activeJobsPollRef.current) window.clearTimeout(activeJobsPollRef.current);
    };
  }, [activeOcrJobs.length, uploadStep, fetchActiveOcrJobs]);

  useEffect(() => {
    const previousIds = previousActiveJobIdsRef.current;
    const currentIds = activeOcrJobs.map((job) => job.id);
    const completedOrFailed = previousIds.some((id) => !currentIds.includes(id));
    previousActiveJobIdsRef.current = currentIds;
    if (!completedOrFailed) return;
    void refreshAfterInvoiceMutation();
    void fetchOcrNotifications();
  }, [activeOcrJobs, fetchOcrNotifications, refreshAfterInvoiceMutation]);
  useEffect(() => {
    // Optional catalog endpoints (safe to fail before DB migration is applied)
    const cachedVendors = readSessionCache<string[]>(CATALOG_VENDORS_CACHE_KEY);
    const cachedUnits = readSessionCache<string[]>(CATALOG_UNITS_CACHE_KEY);
    if (cachedVendors) setVendorOptions(cachedVendors);
    if (cachedUnits) setUnitOptions(cachedUnits);
    if (cachedVendors && cachedUnits) return;

    void Promise.all([
      cachedVendors
        ? Promise.resolve({ vendors: cachedVendors })
        : fetch('/api/catalog/vendors').then((r) => r.json()).catch(() => ({})),
      cachedUnits
        ? Promise.resolve({ units: cachedUnits })
        : fetch('/api/catalog/units').then((r) => r.json()).catch(() => ({})),
    ]).then(([v, u]) => {
      const vendors = Array.isArray(v?.vendors) ? v.vendors : [];
      const units = Array.isArray(u?.units) ? u.units : [];
      setVendorOptions(vendors);
      setUnitOptions(units);
      if (!cachedVendors) writeSessionCache(CATALOG_VENDORS_CACHE_KEY, vendors);
      if (!cachedUnits) writeSessionCache(CATALOG_UNITS_CACHE_KEY, units);
    });
  }, []);

  const setCachedVendorSettings = useCallback((updater: VendorSetting[] | ((prev: VendorSetting[]) => VendorSetting[])) => {
    setVendorSettings((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeSessionCache(VENDOR_SETTINGS_CACHE_KEY, next);
      return next;
    });
  }, []);

  const fetchVendorSettings = useCallback(async (opts?: { force?: boolean }) => {
    const cached = opts?.force ? null : readSessionCache<VendorSetting[]>(VENDOR_SETTINGS_CACHE_KEY);
    if (cached) {
      setVendorSettings(cached);
      setVendorSettingsLoading(false);
      return;
    }

    setVendorSettingsLoading(true);
    try {
      const res = await fetch('/api/vendor-settings');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Failed to load vendor settings');
      const vendors = Array.isArray(json?.vendors) ? json.vendors : [];
      setCachedVendorSettings(vendors);
    } catch (err) {
      showToast((err as Error).message, 'error');
      setVendorSettings([]);
    } finally {
      setVendorSettingsLoading(false);
    }
  }, [setCachedVendorSettings]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (settingsTab !== 'vendors') return;
    void fetchVendorSettings();
  }, [settingsOpen, settingsTab, fetchVendorSettings]);

  // Keep vendor suggestions loaded for mapping in invoice modal (cached by sessionStorage).
  useEffect(() => {
    void fetchVendorSettings();
  }, [fetchVendorSettings]);

  useEffect(() => {
    if (!manualOpen) return;
    const vendor = manualForm.vendor_name.trim();
    void fetch(`/api/catalog/products?vendor=${encodeURIComponent(vendor)}&limit=200`)
      .then((r) => r.json())
      .then((json) => setManualProductOptions(Array.isArray(json?.products) ? json.products : []))
      .catch(() => setManualProductOptions([]));
  }, [manualOpen, manualForm.vendor_name]);

  useEffect(() => {
    if (!editMode) return;
    const vendor = editForm.vendor_name.trim();
    void fetch(`/api/catalog/products?vendor=${encodeURIComponent(vendor)}&limit=200`)
      .then((r) => r.json())
      .then((json) => setEditProductOptions(Array.isArray(json?.products) ? json.products : []))
      .catch(() => setEditProductOptions([]));
  }, [editMode, editForm.vendor_name]);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const showToast = (text: string, type: 'success' | 'error' | 'warn') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 4000);
  };

  // ── File selection → preview (Step 2 of input-validation-specialist) ───────
  const handleFileSelect = async (file: File) => {
    setUploadError(null);
    setUploadStep('preview');
    setUploadModalHidden(false);

    // Show raw preview first (before optimize)
    const rawUrl = URL.createObjectURL(file);
    setPreviewUrl(rawUrl);
    setPreviewFile(file);

    // Fetch optimized preview from server (?preview=1)
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/process?preview=1', { method: 'POST', body: fd });

      if (res.ok) {
        const blob = await res.blob();
        const sizeKB = Number(res.headers.get('X-Image-Size-KB') ?? 0);
        setPreviewSizeKB(sizeKB);
        URL.revokeObjectURL(rawUrl);
        setPreviewUrl(URL.createObjectURL(blob));
      }
    } catch {
      // Preview optimization failed — use raw file (still works)
    }
  };

  // ── Confirm and run OCR ───────────────────────────────────────────────────
  const handleConfirmAndProcess = async () => {
    if (!previewFile) return;
    setUploadStep('processing');
    setUploadError(null);
    setUploadModalHidden(false);

    const retryExistingJob = async (jobId: string) => {
      setProcessingMsg('Requesting OCR retry...');
      const res = await fetch(`/api/ocr-jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' });
      const { json, text } = await safeReadJson(res);
      const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!res.ok) {
        throw new Error(String(obj?.error ?? text ?? 'Failed to retry OCR job'));
      }
    };

    const pollJob = async (jobId: string) => {
      const delays = [2000, 3000, 5000, 8000];
      let attempt = 0;

      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
      pollStartedAtRef.current = Date.now();
      autoRetryTriggeredRef.current = false;

      return await new Promise<void>((resolve, reject) => {
        const tick = async () => {
          try {
            const res = await fetch(`/api/ocr-jobs/${encodeURIComponent(jobId)}`);
            const { json, text } = await safeReadJson(res);
            const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
            if (!res.ok) {
              throw new Error(String(obj?.error ?? text ?? 'Failed to check OCR status'));
            }

            const job = (obj?.job as OcrJob | undefined) ?? null;
            if (!job) {
              throw new Error('Invalid OCR job response');
            }

            if (job.status === 'queued') {
              const err = (job.error_message || '').toLowerCase();
              const nextRunAtMs = job.next_run_at ? new Date(job.next_run_at).getTime() : null;
              const waitMs = nextRunAtMs !== null ? nextRunAtMs - Date.now() : null;
              const isHighDemand = err.includes('high demand') || err.includes('"code": 503') || err.includes(' 503 ');

              if (isHighDemand) {
                const seconds = waitMs !== null ? Math.max(1, Math.round(waitMs / 1000)) : 60;
                setProcessingMsg(`OCR is overloaded. Retrying in about ${seconds}s...`);
              } else {
                setProcessingMsg('Image queued for OCR. Calling Gemini...');
              }

              const elapsedMs = Date.now() - pollStartedAtRef.current;
              const canTriggerNow = nextRunAtMs === null || nextRunAtMs <= Date.now();
              if (elapsedMs > 15000 && canTriggerNow && !isHighDemand && !autoRetryTriggeredRef.current) {
                autoRetryTriggeredRef.current = true;
                await retryExistingJob(jobId);
                setProcessingMsg('OCR worker triggered again. Waiting for results...');
              }
            } else if (job.status === 'processing') {
              setProcessingMsg('Gemini is reading the invoice...');
            } else if (job.status === 'failed') {
              throw new Error(job.error_message || 'OCR failed. You can click Retry.');
            } else if (job.status === 'succeeded') {
              const invoiceId = job.invoice_id;
              if (!invoiceId) {
                throw new Error('OCR job succeeded but invoice_id is missing');
              }
              const invoice = await fetchInvoiceById(invoiceId);
              setProcessingMsg(
                `Scanned with ${job.ocr_provider || 'gemini'}/${job.ocr_model || 'model'} — loading invoice...`
              );
              await refreshAfterInvoiceMutation();
              if (invoice) setSelectedInvoice(invoice);
              showToast(
                `Success${job.ocr_model ? ` (${job.ocr_provider || 'gemini'}/${job.ocr_model})` : ''}`,
                'success'
              );
              setUploadStep('done');
              resolve();
              return;
            }

            let delay = delays[Math.min(attempt, delays.length - 1)];
            if (job.status === 'queued' && job.next_run_at) {
              const nextRunAtMs = new Date(job.next_run_at).getTime();
              const waitMs = nextRunAtMs - Date.now();
              if (waitMs > 0) {
                delay = Math.min(delay, Math.max(2000, Math.min(8000, waitMs)));
              }
            }
            attempt += 1;
            pollTimerRef.current = window.setTimeout(() => { void tick(); }, delay);
          } catch (err) {
            reject(err);
          }
        };

        void tick();
      });
    };

    try {
      if (activeOcrJobId && uploadStep === 'error') {
        await retryExistingJob(activeOcrJobId);
        setProcessingMsg('Retry request sent...');
        await pollJob(activeOcrJobId);
      } else {
        const fd = new FormData();
        fd.append('image', previewFile);

        setProcessingMsg('Uploading image...');
        const res = await fetch('/api/process', { method: 'POST', body: fd });
        const { json, text } = await safeReadJson(res);
        const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;

        if (!res.ok) {
          throw new Error(String(obj?.error ?? text ?? 'Unknown error'));
        }

        const jobId = typeof obj?.jobId === 'string' ? obj.jobId : '';
        if (!jobId) {
          throw new Error('No jobId returned from server');
        }

        setActiveOcrJobId(jobId);
        setProcessingMsg('Image uploaded. Queuing OCR job...');
        await pollJob(jobId);
      }
      setTimeout(() => resetUpload(), 2000);
    } catch (err) {
      setUploadError((err as Error).message);
      setUploadStep('error');
      setUploadModalHidden(false);
    }
  };

  const resetUpload = () => {
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    setUploadStep('idle');
    setPreviewUrl(null);
    setPreviewFile(null);
    setPreviewSizeKB(null);
    setUploadError(null);
    setActiveOcrJobId(null);
    setUploadModalHidden(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Update invoice status ──────────────────────────────────────────────────
  const updateStatus = async (id: string, status: 'approved' | 'rejected') => {
    const res = await fetch('/api/invoices', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) {
      showToast(status === 'approved' ? 'Invoice approved' : 'Invoice rejected', 'success');
      await refreshAfterInvoiceMutation();
      if (selectedInvoice?.id === id) {
        setSelectedInvoice((prev) => prev ? { ...prev, status } : prev);
      }
      return;
    }

    const json = await res.json().catch(() => ({}));
    showToast(json.error ?? 'Failed to update status', 'error');
  };

  // ── Delete invoice ─────────────────────────────────────────────────────────
  const deleteInvoice = async (id: string) => {
    const ok = window.confirm('Delete this invoice? This action cannot be undone.');
    if (!ok) return;

    const res = await fetch('/api/invoices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (res.ok) {
      showToast('Invoice deleted', 'success');
      if (selectedInvoice?.id === id) setSelectedInvoice(null);
      await refreshAfterInvoiceMutation();
      return;
    }

    const json = await res.json().catch(() => ({}));
    showToast(json.error ?? 'Failed to delete invoice', 'error');
  };

  const openManualModal = () => {
    setManualForm({
      vendor_name: '',
      vendor_gst_number: '',
      invoice_number: '',
      invoice_date: new Date().toISOString().slice(0, 10),
      category: '',
      sub_total: '',
      freight: '',
      gst_amount: '',
      total_amount: '',
    });
    setManualItems([{ product_code: '', description: '', quantity: '', unit: '', price: '', amount_excl_gst: '0.00' }]);
    setManualOpen(true);
  };

  useEffect(() => {
    if (!manualOpen) return;
    const totals = calcTotalsFromRows(manualItems, manualForm.freight);
    setManualForm((p) => {
      if (p.sub_total === totals.sub_total && p.gst_amount === totals.gst_amount && p.total_amount === totals.total_amount) return p;
      return { ...p, ...totals };
    });
  }, [manualOpen, manualItems, manualForm.freight]);

  const submitManualInvoice = async () => {
    if (!manualForm.vendor_name.trim() || !manualForm.invoice_date.trim()) {
      showToast('Please enter Vendor and Date', 'error');
      return;
    }

    // Ensure amounts are always derived from quantity * price
    const normalizedItems = manualItems
      .map((it) => {
        const q = toNumberOrNullInput(it.quantity) ?? 0;
        const p = toNumberOrNullInput(it.price) ?? 0;
        const amt = fmt2(q * p);
        return { ...it, amount_excl_gst: amt };
      })
      .filter((it) => it.description.trim());

    const totals = calcTotalsFromRows(normalizedItems, manualForm.freight);

    const payload = {
      vendor_name: manualForm.vendor_name.trim(),
      vendor_gst_number: manualForm.vendor_gst_number.trim() || null,
      invoice_number: manualForm.invoice_number.trim() || null,
      invoice_date: manualForm.invoice_date,
      category: manualForm.category.trim() || null,
      sub_total: toNumberOrNullInput(totals.sub_total),
      freight: toNumberOrNullInput(manualForm.freight) ?? 0,
      gst_amount: toNumberOrNullInput(totals.gst_amount),
      total_amount: toNumberOrNullInput(totals.total_amount),
      invoice_items: normalizedItems
        .map((it) => ({
          product_code: it.product_code.trim() || null,
          description: it.description.trim(),
          quantity: toNumberOrNullInput(it.quantity),
          unit: it.unit.trim() || null,
          price: toNumberOrNullInput(it.price),
          amount_excl_gst: toNumberOrNullInput(it.amount_excl_gst),
        }))
        .filter((it) => it.description),
    };

    setManualSaving(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 409) {
        showToast('⚠️ Duplicate invoice', 'warn');
        return;
      }
      if (!res.ok) {
        throw new Error(json.error ?? 'Failed to create invoice');
      }

      showToast('Manual invoice created', 'success');
      setManualOpen(false);
      await refreshAfterInvoiceMutation();
      if (json.invoice) {
        setSelectedInvoice(json.invoice);
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setManualSaving(false);
    }
  };

  const hydrateEditStateFromInvoice = useCallback((invoice: Invoice) => {
    const isCredit = isCreditInvoice(invoice);
    setEditForm({
      vendor_name: invoice.vendor_name ?? '',
      vendor_gst_number: invoice.vendor_gst_number ?? '',
      invoice_number: invoice.invoice_number ?? '',
      invoice_date: toDateInput(invoice.invoice_date ?? ''),
      category: invoice.category ?? '',
      sub_total: String(isCredit ? -Math.abs(invoice.sub_total ?? 0) : (invoice.sub_total ?? '')),
      freight: String(isCredit ? -Math.abs(invoice.freight ?? 0) : (invoice.freight ?? '')),
      gst_amount: String(isCredit ? -Math.abs(invoice.gst_amount ?? 0) : (invoice.gst_amount ?? '')),
      total_amount: String(isCredit ? -Math.abs(invoice.total_amount ?? 0) : (invoice.total_amount ?? '')),
    });
    setEditItems(
      (invoice.invoice_items ?? []).map((it) => ({
        product_code: it.product_code ?? '',
        description: it.description ?? '',
        quantity: String(isCredit ? Math.abs(it.quantity ?? 0) : (it.quantity ?? '')),
        standard: it.standard ?? '',
        unit: it.unit ?? '',
        price: String(isCredit ? Math.abs(it.price ?? 0) : (it.price ?? '')),
        amount_excl_gst: String(isCredit ? -Math.abs(it.amount_excl_gst ?? 0) : (it.amount_excl_gst ?? '')),
      }))
    );
    setEditMode(true);
  }, []);

  useEffect(() => {
    if (!selectedInvoice) {
      lastHydratedInvoiceIdRef.current = null;
      return;
    }
    if (lastHydratedInvoiceIdRef.current === selectedInvoice.id) return;
    lastHydratedInvoiceIdRef.current = selectedInvoice.id;
    hydrateEditStateFromInvoice(selectedInvoice);
  }, [selectedInvoice, hydrateEditStateFromInvoice]);

  useEffect(() => {
    if (!editMode) return;
    const isCredit = isCreditInvoice(selectedInvoice);
    const freightRaw = toNumberOrNullInput(editForm.freight) ?? 0;
    const freight = isCredit ? -Math.abs(freightRaw) : freightRaw;
    const subAbs = editItems.reduce((sum, r) => {
      const q = Math.abs(toNumberOrNullInput(r.quantity) ?? 0);
      const p = Math.abs(toNumberOrNullInput(r.price) ?? 0);
      return sum + round2(q * p);
    }, 0);
    const sub = isCredit ? -round2(subAbs) : round2(subAbs);
    const gst = round2(sub * 0.15);
    const total = round2(sub + freight + gst);
    const totals = { sub_total: fmt2(sub), gst_amount: fmt2(gst), total_amount: fmt2(total) };
    setEditForm((p) => {
      if (p.sub_total === totals.sub_total && p.gst_amount === totals.gst_amount && p.total_amount === totals.total_amount) return p;
      return { ...p, ...totals, freight: String(freight) };
    });
  }, [editMode, editItems, editForm.freight, selectedInvoice]);

  const cancelEdit = () => {
    setEditMode(false);
    setEditItems([]);
    lastHydratedInvoiceIdRef.current = null;
  };

  const openCreditNote = () => {
    if (!selectedInvoice) return;
    setCreditNumber('');
    setCreditDate(new Date().toISOString().slice(0, 10));
    const rows = (selectedInvoice.invoice_items ?? [])
      .filter((it) => !!it.id)
      .map((it) => ({
        source_item_id: String(it.id),
        selected: false,
        description: it.description ?? '',
        product_code: it.product_code ?? '',
        standard: it.standard ?? '',
        unit: it.unit ?? '',
        quantity: String(Math.abs(it.quantity ?? 0)),
        price: String(Math.abs(it.price ?? 0)),
        amount_excl_gst: String(Math.abs(it.amount_excl_gst ?? 0)),
      }));
    setCreditRows(rows);
    setCreditOpen(true);
  };

  const submitCreditNote = async () => {
    if (!selectedInvoice) return;
    const items = creditRows
      .filter((r) => r.selected)
      .map((r) => ({
        source_item_id: r.source_item_id,
        quantity: r.quantity,
        price: r.price,
        amount_excl_gst: r.amount_excl_gst,
      }));

    if (!items.length) {
      showToast('Select at least 1 item to create a credit note', 'error');
      return;
    }

    setCreditSaving(true);
    try {
      const res = await fetch('/api/credit-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_invoice_id: selectedInvoice.id,
          credit_note_number: creditNumber.trim() || null,
          credit_note_date: creditDate,
          items,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Failed to create credit note');

      showToast('Credit note created', 'success');
      setCreditOpen(false);
      await refreshAfterInvoiceMutation();
      if (json.invoice) setSelectedInvoice(json.invoice);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setCreditSaving(false);
    }
  };

  const creditSelectedRows = creditRows.filter((r) => r.selected);
  const creditTotals = (() => {
    const t = calcTotalsFromRows(creditSelectedRows, '0');
    // Credit notes are stored as negative totals on the server; show negative totals in UI too.
    const sub = -Math.abs(Number(t.sub_total));
    const gst = -Math.abs(Number(t.gst_amount));
    const total = -Math.abs(Number(t.total_amount));
    return { sub_total: fmt2(sub), gst_amount: fmt2(gst), total_amount: fmt2(total) };
  })();

  const isSelectedCreditNote =
    (selectedInvoice?.type ?? '').toLowerCase().includes('credit') ||
    (selectedInvoice?.total_amount ?? 0) < 0 ||
    !!selectedInvoice?.parent_invoice_id;

  const saveEdit = async () => {
    if (!selectedInvoice) return;
    if (!editForm.vendor_name.trim() || !editForm.invoice_date.trim()) {
      showToast('Please enter Vendor and Date', 'error');
      return;
    }

    const normalizedVendor = normalizeVendorName(editForm.vendor_name);
    const matchedVendor = vendorSettings.find((v) => normalizeVendorName(v.name) === normalizedVendor);
    if (!matchedVendor) {
      showToast('Vendor is not mapped. Please select an existing vendor from the dropdown.', 'warn');
      return;
    }

    const isCredit = isCreditInvoice(selectedInvoice);

    const normalizedEditItems = editItems
      .map((it) => {
        const q = Math.abs(toNumberOrNullInput(it.quantity) ?? 0);
        const p = Math.abs(toNumberOrNullInput(it.price) ?? 0);
        const amt = isCredit ? -Math.abs(q * p) : q * p;
        return { ...it, amount_excl_gst: fmt2(amt) };
      })
      .filter((it) => it.description.trim());

    const freightRaw = toNumberOrNullInput(editForm.freight) ?? 0;
    const freight = isCredit ? -Math.abs(freightRaw) : freightRaw;
    const subAbs = normalizedEditItems.reduce((sum, r) => {
      const q = Math.abs(toNumberOrNullInput(r.quantity) ?? 0);
      const p = Math.abs(toNumberOrNullInput(r.price) ?? 0);
      return sum + round2(q * p);
    }, 0);
    const sub = isCredit ? -round2(subAbs) : round2(subAbs);
    const gst = round2(sub * 0.15);
    const total = round2(sub + freight + gst);
    const totals = { sub_total: fmt2(sub), gst_amount: fmt2(gst), total_amount: fmt2(total) };

    const payload = {
      id: selectedInvoice.id,
      vendor_name: editForm.vendor_name.trim(),
      vendor_gst_number: editForm.vendor_gst_number.trim() || null,
      invoice_number: editForm.invoice_number.trim() || null,
      invoice_date: editForm.invoice_date,
      category: editForm.category.trim() || null,
      sub_total: toNumberOrNullInput(totals.sub_total),
      freight,
      gst_amount: toNumberOrNullInput(totals.gst_amount),
      total_amount: toNumberOrNullInput(totals.total_amount),
      invoice_items: normalizedEditItems
        .map((it) => ({
          product_code: it.product_code.trim() || null,
          description: it.description.trim(),
          quantity: (() => {
            const q = toNumberOrNullInput(it.quantity);
            if (q === null) return null;
            return isCredit ? -Math.abs(q) : q;
          })(),
          standard: it.standard.trim() || null,
          unit: it.unit.trim() || null,
          price: (() => {
            const p = toNumberOrNullInput(it.price);
            if (p === null) return null;
            return Math.abs(p);
          })(),
          amount_excl_gst: toNumberOrNullInput(it.amount_excl_gst),
        }))
        .filter((it) => it.description),
    };

    setEditSaving(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? 'Failed to save changes');
      }
      showToast('Changes saved', 'success');
      await refreshAfterInvoiceMutation();
      if (json.invoice) {
        setSelectedInvoice(json.invoice);
        hydrateEditStateFromInvoice(json.invoice);
        lastHydratedInvoiceIdRef.current = json.invoice.id;
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [
      ['Date', 'Vendor', 'Invoice #', 'Total', 'GST', 'Status'],
      ...invoices.map((i) => [
        i.invoice_date,
        i.vendor_name,
        i.invoice_number ?? '',
        i.total_amount,
        i.gst_amount,
        i.status,
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `madam-yen-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Derived stats ──────────────────────────────────────────────────────────
  const totalSpend = invoices.reduce((s, i) => s + (i.total_amount ?? 0), 0);
  const totalGST   = invoices.reduce((s, i) => s + (i.gst_amount   ?? 0), 0);
  const pendingCount = invoices.filter((i) => i.status === 'pending_review').length;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toastMsg && (
        <div className={`fixed top-4 right-4 z-[100] px-5 py-3 rounded-xl shadow-2xl text-sm font-medium animate-fade-in
          ${toastMsg.type === 'success' ? 'bg-emerald-600' :
            toastMsg.type === 'error'   ? 'bg-red-600' : 'bg-amber-500'}`}>
          {toastMsg.text}
        </div>
      )}

      <datalist id="vendor-options">
        {vendorSettings.map((v) => (
          <option key={v.id} value={v.name} />
        ))}
      </datalist>
      <datalist id="unit-options">
        {unitOptions.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <datalist id="manual-product-options">
        {manualProductOptions.map((p) => (
          <option
            key={`${p.name}-${p.vendor_product_code ?? ''}`}
            value={p.name}
            label={`${p.vendor_product_code ?? ''}${p.unit ? ` · ${p.unit}` : ''}${p.standard ? ` · ${p.standard}` : ''}`}
          />
        ))}
      </datalist>
      <datalist id="edit-product-options">
        {editProductOptions.map((p) => (
          <option
            key={`${p.name}-${p.vendor_product_code ?? ''}`}
            value={p.name}
            label={`${p.vendor_product_code ?? ''}${p.unit ? ` · ${p.unit}` : ''}${p.standard ? ` · ${p.standard}` : ''}`}
          />
        ))}
      </datalist>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-black text-sm">
              MY
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-none">Madam Yen IMS</h1>
              <p className="text-xs text-slate-400 leading-none mt-0.5">Invoice Management System</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Upload button */}
            <label htmlFor="invoice-upload"
              className="cursor-pointer flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 shadow-lg shadow-emerald-900/50">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Add invoice</span>
              <span className="sm:hidden">Add</span>
            </label>
            <button
              onClick={openManualModal}
              className="hidden sm:flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border border-slate-700">
              ✍️ Manual entry
            </button>
            <input
              id="invoice-upload"
              type="file"
              accept="image/*"
              capture="environment"
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />

            <button
              onClick={exportCSV}
              className="hidden sm:flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border border-slate-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              CSV
            </button>
            <button
              type="button"
              onClick={() => { setSettingsTab('vendors'); setSettingsOpen(true); }}
              className="hidden sm:flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border border-slate-700"
              title="Settings"
            >
              ⚙️ Settings
            </button>

            {/* Mobile hamburger */}
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileMenuOpen(true)}
              className="sm:hidden w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center justify-center"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 sm:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute top-16 right-4 left-4 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-800">
              <div className="text-sm font-semibold text-slate-100">Menu</div>
              <button
                aria-label="Close menu"
                onClick={() => setMobileMenuOpen(false)}
                className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 flex items-center justify-center"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-3 space-y-2">
              <button
                onClick={() => { setMobileMenuOpen(false); openManualModal(); }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
              >
                <span className="font-semibold">✍️ Manual entry</span>
                <span className="text-slate-400">→</span>
              </button>
              <button
                onClick={() => { setMobileMenuOpen(false); exportCSV(); }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
              >
                <span className="font-semibold">⬇️ Export CSV</span>
                <span className="text-slate-400">→</span>
              </button>
              <button
                onClick={() => { setMobileMenuOpen(false); setSettingsTab('vendors'); setSettingsOpen(true); }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
              >
                <span className="font-semibold">⚙️ Settings</span>
                <span className="text-slate-400">→</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ── Settings Modal ─────────────────────────────────────────────── */}
        {settingsOpen && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl w-full max-w-3xl border border-slate-700 shadow-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-white text-lg">Settings</h2>
                  <p className="text-xs text-slate-400 mt-1">Vendors, maintenance, and other configurations.</p>
                </div>
                <button onClick={() => setSettingsOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6">
                <div className="flex items-center gap-2 mb-5">
                  <button
                    type="button"
                    onClick={() => setSettingsTab('vendors')}
                    className={`px-3 py-2 rounded-xl text-sm font-semibold border ${
                      settingsTab === 'vendors'
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    Vendors
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsTab('maintenance')}
                    className={`px-3 py-2 rounded-xl text-sm font-semibold border ${
                      settingsTab === 'maintenance'
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    Maintenance
                  </button>
                </div>

                {settingsTab === 'vendors' && (
                  <>
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <button
                        type="button"
                        onClick={() => setVendorCreateOpen(true)}
                        className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm border border-emerald-500"
                      >
                        + Create vendor
                      </button>
                      <div className="text-xs text-slate-500">Tip: If a vendor shows prices incl GST, enable it here.</div>
                    </div>

                    <div className="overflow-auto max-h-[60vh] border border-slate-800 rounded-xl">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-900 border-b border-slate-800">
                          <tr className="text-slate-400">
                            <th className="px-4 py-3 text-left font-semibold">Vendor</th>
                            <th className="px-4 py-3 text-left font-semibold">GST #</th>
                            <th className="px-4 py-3 text-right font-semibold">Prices include GST</th>
                            <th className="px-4 py-3 text-right font-semibold">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vendorSettingsLoading ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-6 text-slate-400">Loading…</td>
                            </tr>
                          ) : vendorSettings.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-6 text-slate-400">No vendors found.</td>
                            </tr>
                          ) : (
                            vendorSettings.map((v) => (
                              <tr key={v.id} className="border-t border-slate-800">
                                <td className="px-4 py-3 text-slate-100 font-medium">{v.name}</td>
                                <td className="px-4 py-3 text-slate-300 font-mono text-xs">{v.gst_number ?? '—'}</td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    type="button"
                                    disabled={vendorSettingsSavingId === v.id}
                                    onClick={async () => {
                                      setVendorSettingsSavingId(v.id);
                                      try {
                                        const res = await fetch('/api/vendor-settings', {
                                          method: 'PATCH',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ vendor_id: v.id, prices_include_gst: !v.prices_include_gst }),
                                        });
                                        const json = await res.json().catch(() => ({}));
                                        if (!res.ok) throw new Error(json.error ?? 'Failed to update vendor');
                                        setCachedVendorSettings((prev) => prev.map((x) => x.id === v.id ? { ...x, prices_include_gst: !x.prices_include_gst } : x));
                                      } catch (err) {
                                        showToast((err as Error).message, 'error');
                                      } finally {
                                        setVendorSettingsSavingId(null);
                                      }
                                    }}
                                    className={`inline-flex items-center justify-center px-3 py-1.5 rounded-lg border text-xs font-bold ${
                                      v.prices_include_gst
                                        ? 'bg-emerald-700/30 border-emerald-700 text-emerald-200'
                                        : 'bg-slate-800 border-slate-700 text-slate-200'
                                    } ${vendorSettingsSavingId === v.id ? 'opacity-60' : ''}`}
                                    title="Toggle GST mode"
                                  >
                                    {v.prices_include_gst ? 'ON' : 'OFF'}
                                  </button>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const ok = window.confirm(`Delete vendor "${v.name}"? This cannot be undone.`);
                                      if (!ok) return;
                                      try {
                                        const res = await fetch('/api/vendor-settings', {
                                          method: 'DELETE',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ vendor_id: v.id }),
                                        });
                                        const json = await res.json().catch(() => ({}));
                                        if (!res.ok) throw new Error(json.error ?? 'Failed to delete vendor');
                                        setCachedVendorSettings((prev) => prev.filter((x) => x.id !== v.id));
                                        setVendorOptions((prev) => {
                                          const next = prev.filter((name) => name !== v.name);
                                          writeSessionCache(CATALOG_VENDORS_CACHE_KEY, next);
                                          return next;
                                        });
                                        showToast('Vendor deleted', 'success');
                                      } catch (err) {
                                        showToast((err as Error).message, 'error');
                                      }
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold hover:bg-red-600 hover:border-red-600"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {settingsTab === 'maintenance' && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                      <div className="text-white font-semibold mb-1">Cleanup orphan catalog</div>
                      <div className="text-xs text-slate-400 mb-3">Deletes vendors/products/units/standards not referenced by any invoice.</div>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = window.confirm(
                            'Cleanup orphaned vendors, units, standards, and products?\n\nThis will permanently delete catalog rows that are not referenced by any invoice.'
                          );
                          if (!ok) return;
                          try {
                            const res = await fetch('/api/maintenance/cleanup-orphans', { method: 'POST' });
                            const json = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(json.error ?? 'Cleanup failed');
                            const r = json?.result ?? {};
                            showToast(
                              `Cleanup done: vendors ${r.deleted_vendors ?? 0}, products ${r.deleted_restaurant_products ?? 0}, units ${r.deleted_units ?? 0}, standards ${r.deleted_standards ?? 0}`,
                              'success'
                            );
                            removeSessionCache(VENDOR_SETTINGS_CACHE_KEY);
                            removeSessionCache(CATALOG_VENDORS_CACHE_KEY);
                            removeSessionCache(CATALOG_UNITS_CACHE_KEY);
                            setVendorOptions([]);
                            setUnitOptions([]);
                            await fetchVendorSettings({ force: true });
                          } catch (err) {
                            showToast((err as Error).message, 'error');
                          }
                        }}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm border border-slate-700"
                      >
                        🧹 Cleanup orphans
                      </button>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                      <div className="text-white font-semibold mb-1">Delete old images</div>
                      <div className="text-xs text-slate-400 mb-3">Deletes Storage files under `YYYY/MM/` older than N months. Uses Storage API (service role).</div>

                      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                        <label className="text-sm">
                          <div className="text-slate-400 mb-1">Older than (months)</div>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            step={1}
                            inputMode="numeric"
                            value={cleanupOldImagesMonthsText}
                            onChange={(e) => setCleanupOldImagesMonthsText(e.target.value)}
                            onBlur={() => {
                              const raw = cleanupOldImagesMonthsText.trim();
                              const parsed = raw ? Number(raw) : cleanupOldImagesMonths;
                              const next = Math.max(1, Math.min(60, Number.isFinite(parsed) ? Math.floor(parsed) : cleanupOldImagesMonths));
                              setCleanupOldImagesMonths(next);
                              setCleanupOldImagesMonthsText(String(next));
                            }}
                            className="w-32 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                          />
                        </label>
                        <label className="text-sm flex items-center gap-2 select-none pb-1">
                          <input
                            type="checkbox"
                            checked={cleanupOldImagesIncludeJobs}
                            onChange={(e) => setCleanupOldImagesIncludeJobs(e.target.checked)}
                          />
                          <span className="text-slate-200">Include OCR job previews</span>
                        </label>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={cleanupOldImagesBusy}
                            onClick={async () => {
                              setCleanupOldImagesBusy(true);
                              try {
                                const res = await fetch('/api/maintenance/cleanup-old-images', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                            olderThanMonths: (() => {
                              const raw = cleanupOldImagesMonthsText.trim();
                              const parsed = raw ? Number(raw) : cleanupOldImagesMonths;
                              return Math.max(1, Math.min(60, Number.isFinite(parsed) ? Math.floor(parsed) : cleanupOldImagesMonths));
                            })(),
                                    dryRun: true,
                                    includeOcrJobImages: cleanupOldImagesIncludeJobs,
                                  }),
                                });
                                const json = await res.json().catch(() => ({}));
                                if (!res.ok) throw new Error(json.error ?? 'Dry-run failed');
                                showToast(`Dry-run: ${json.totalPlanned ?? 0} files planned`, 'success');
                              } catch (err) {
                                showToast((err as Error).message, 'error');
                              } finally {
                                setCleanupOldImagesBusy(false);
                              }
                            }}
                            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm border border-slate-700 disabled:opacity-60"
                          >
                            Dry run
                          </button>
                          <button
                            type="button"
                            disabled={cleanupOldImagesBusy}
                            onClick={async () => {
                              const months = (() => {
                                const raw = cleanupOldImagesMonthsText.trim();
                                const parsed = raw ? Number(raw) : cleanupOldImagesMonths;
                                return Math.max(1, Math.min(60, Number.isFinite(parsed) ? Math.floor(parsed) : cleanupOldImagesMonths));
                              })();
                              const ok = window.confirm(`Delete images older than ${months} months? This cannot be undone.`);
                              if (!ok) return;
                              setCleanupOldImagesBusy(true);
                              try {
                                const res = await fetch('/api/maintenance/cleanup-old-images', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    olderThanMonths: months,
                                    dryRun: false,
                                    includeOcrJobImages: cleanupOldImagesIncludeJobs,
                                  }),
                                });
                                const json = await res.json().catch(() => ({}));
                                if (!res.ok) throw new Error(json.error ?? 'Cleanup failed');
                                showToast(`Deleted: ${json.totalDeleted ?? 0} files`, 'success');
                              } catch (err) {
                                showToast((err as Error).message, 'error');
                              } finally {
                                setCleanupOldImagesBusy(false);
                              }
                            }}
                            className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm border border-red-500 disabled:opacity-60"
                          >
                            Delete now
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {settingsOpen && vendorCreateOpen && (
          <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-700 shadow-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
                <h3 className="font-bold text-white text-lg">Create vendor</h3>
                <button onClick={() => setVendorCreateOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-6 space-y-4">
                <label className="text-sm block">
                  <div className="text-slate-400 mb-1">Vendor name *</div>
                  <input
                    value={vendorCreateForm.name}
                    onChange={(e) => setVendorCreateForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                    placeholder="Tokyo Food"
                  />
                </label>
                <label className="text-sm block">
                  <div className="text-slate-400 mb-1">GST number</div>
                  <input
                    value={vendorCreateForm.gst_number}
                    onChange={(e) => setVendorCreateForm((p) => ({ ...p, gst_number: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                    placeholder="66-442-659"
                  />
                </label>
                <label className="text-sm block">
                  <div className="text-slate-400 mb-1">Address</div>
                  <input
                    value={vendorCreateForm.address}
                    onChange={(e) => setVendorCreateForm((p) => ({ ...p, address: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                    placeholder="Optional"
                  />
                </label>
                <label className="text-sm flex items-center gap-2 select-none">
                  <input
                    type="checkbox"
                    checked={vendorCreateForm.prices_include_gst}
                    onChange={(e) => setVendorCreateForm((p) => ({ ...p, prices_include_gst: e.target.checked }))}
                  />
                  <span className="text-slate-200 font-semibold">Prices include GST</span>
                  <span className="text-slate-500 text-xs">(default: OFF / ex-GST)</span>
                </label>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={() => setVendorCreateOpen(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={vendorCreateSaving}
                    onClick={async () => {
                      const name = vendorCreateForm.name.trim();
                      if (!name) {
                        showToast('Vendor name is required', 'error');
                        return;
                      }
                      setVendorCreateSaving(true);
                      try {
                        const res = await fetch('/api/vendor-settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name,
                            gst_number: vendorCreateForm.gst_number.trim() || null,
                            address: vendorCreateForm.address.trim() || null,
                            prices_include_gst: vendorCreateForm.prices_include_gst,
                          }),
                        });
                        const json = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(json.error ?? 'Failed to create vendor');
                        if (json.vendor) {
                          setCachedVendorSettings((prev) => {
                            const next = [json.vendor, ...prev];
                            next.sort((a, b) => String(a.name).localeCompare(String(b.name)));
                            return next;
                          });
                          setVendorOptions((prev) => {
                            const name = String(json.vendor.name ?? '');
                            if (!name || prev.includes(name)) return prev;
                            const next = [name, ...prev].sort((a, b) => a.localeCompare(b));
                            writeSessionCache(CATALOG_VENDORS_CACHE_KEY, next);
                            return next;
                          });
                        } else {
                          removeSessionCache(VENDOR_SETTINGS_CACHE_KEY);
                          removeSessionCache(CATALOG_VENDORS_CACHE_KEY);
                          await fetchVendorSettings({ force: true });
                        }
                        showToast('Vendor created', 'success');
                        setVendorCreateOpen(false);
                        setVendorCreateForm({ name: '', gst_number: '', address: '', prices_include_gst: false });
                      } catch (err) {
                        showToast((err as Error).message, 'error');
                      } finally {
                        setVendorCreateSaving(false);
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-60"
                  >
                    {vendorCreateSaving ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Credit Note Modal ───────────────────────────────────────────── */}
        {creditOpen && selectedInvoice && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl w-full max-w-4xl border border-slate-700 shadow-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-white text-lg">🧾 Create credit note</h2>
                  <p className="text-xs text-slate-400 mt-1">From invoice: {selectedInvoice.vendor_name} · #{selectedInvoice.invoice_number ?? '—'}</p>
                </div>
                <button onClick={() => setCreditOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <label className="text-sm sm:col-span-2">
                    <div className="text-slate-400 mb-1">Credit note number (optional)</div>
                    <input
                      value={creditNumber}
                      onChange={(e) => setCreditNumber(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                      placeholder="CN-..."
                    />
                  </label>
                  <label className="text-sm">
                    <div className="text-slate-400 mb-1">Date</div>
                    <input
                      type="date"
                      value={creditDate}
                      onChange={(e) => setCreditDate(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                    />
                  </label>
                </div>

                <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
                  <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-200">Select items to credit</div>
                    <button
                      onClick={() => setCreditRows((p) => p.map((r) => ({ ...r, selected: true })))}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold">
                      Select all
                    </button>
                  </div>
                  <div className="max-h-[45vh] overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-900">
                        <tr className="border-b border-slate-700">
                          {['', 'Product', 'Qty', 'Price', 'Amount (ex GST)'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-semibold text-slate-400">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {creditRows.map((r, idx) => (
                          <tr key={r.source_item_id} className="border-b border-slate-800/60">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={r.selected}
                                onChange={(e) => setCreditRows((p) => p.map((x, i) => i === idx ? { ...x, selected: e.target.checked } : x))}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="text-slate-100 font-medium">{r.description}</div>
                              <div className="text-slate-500 font-mono">{r.product_code}{r.standard ? ` · ${r.standard}` : ''}{r.unit ? ` · ${r.unit}` : ''}</div>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                inputMode="decimal"
                                value={r.quantity}
                                onChange={(e) => {
                                  const quantity = e.target.value;
                                  setCreditRows((p) => p.map((x, i) => {
                                    if (i !== idx) return x;
                                    const next = { ...x, quantity };
                                    const q = toNumberOrNullInput(quantity) ?? 0;
                                    const pr = toNumberOrNullInput(next.price) ?? 0;
                                    next.amount_excl_gst = fmt2(q * pr);
                                    return next;
                                  }));
                                }}
                                className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 font-mono"
                                placeholder="0"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                inputMode="decimal"
                                value={r.price}
                                onChange={(e) => {
                                  const price = e.target.value;
                                  setCreditRows((p) => p.map((x, i) => {
                                    if (i !== idx) return x;
                                    const next = { ...x, price };
                                    const q = toNumberOrNullInput(next.quantity) ?? 0;
                                    const pr = toNumberOrNullInput(price) ?? 0;
                                    next.amount_excl_gst = fmt2(q * pr);
                                    return next;
                                  }));
                                }}
                                className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 font-mono"
                                placeholder="0.00"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                inputMode="decimal"
                                value={r.amount_excl_gst}
                                readOnly
                                className="w-36 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 font-mono"
                                placeholder="0.00"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-xl p-4 text-sm">
                  <div className="flex justify-between text-slate-300">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatNZD(Number(creditTotals.sub_total))}</span>
                  </div>
                  <div className="flex justify-between text-slate-300 mt-1">
                    <span>GST (15%)</span>
                    <span className="font-mono">{formatNZD(Number(creditTotals.gst_amount))}</span>
                  </div>
                  <div className="flex justify-between text-white font-bold text-base border-t border-slate-700 pt-2 mt-2">
                    <span>TOTAL (NZD)</span>
                    <span className="font-mono text-red-400">{formatNZD(Number(creditTotals.total_amount))}</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => setCreditOpen(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold">
                    Cancel
                  </button>
                  <button
                    disabled={creditSaving}
                    onClick={submitCreditNote}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-60">
                    {creditSaving ? 'Creating...' : 'Create credit note'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Manual Create Modal ─────────────────────────────────────────── */}
        {manualOpen && (
          <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl w-full max-w-2xl border border-slate-700 shadow-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
                <h2 className="font-bold text-white text-lg">✍️ Manual invoice</h2>
                <button onClick={() => setManualOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="text-sm">
                    <div className="text-slate-400 mb-1">Vendor *</div>
                    <input
                      list="vendor-options"
                      value={manualForm.vendor_name}
                      onChange={(e) => setManualForm((p) => ({ ...p, vendor_name: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                      placeholder="Tokyo Food"
                    />
                  </label>
                  <label className="text-sm">
                    <div className="text-slate-400 mb-1">GST Number</div>
                    <input
                      value={manualForm.vendor_gst_number}
                      onChange={(e) => setManualForm((p) => ({ ...p, vendor_gst_number: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                      placeholder="66-442-659"
                    />
                  </label>
                  <label className="text-sm">
                    <div className="text-slate-400 mb-1">Invoice number</div>
                    <input
                      value={manualForm.invoice_number}
                      onChange={(e) => setManualForm((p) => ({ ...p, invoice_number: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                      placeholder="IN000..."
                    />
                  </label>
                  <label className="text-sm">
                    <div className="text-slate-400 mb-1">Date *</div>
                    <input
                      type="date"
                      value={manualForm.invoice_date}
                      onChange={(e) => setManualForm((p) => ({ ...p, invoice_date: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                    />
                  </label>
                  <label className="text-sm sm:col-span-2">
                    <div className="text-slate-400 mb-1">Category</div>
                    <input
                      value={manualForm.category}
                      onChange={(e) => setManualForm((p) => ({ ...p, category: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                      placeholder="Food / Cleaning / ..."
                    />
                  </label>
                </div>

                <div className="bg-slate-800 rounded-xl p-4 text-sm">
                  <div className="flex justify-between text-slate-300">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatNZD(Number(manualForm.sub_total || '0'))}</span>
                  </div>
                  <div className="flex justify-between text-slate-300 mt-1">
                    <span>GST (15%)</span>
                    <span className="font-mono">{formatNZD(Number(manualForm.gst_amount || '0'))}</span>
                  </div>
                  <div className="flex justify-between text-white font-bold text-base border-t border-slate-700 pt-2 mt-2">
                    <span>TOTAL (NZD)</span>
                    <span className="font-mono text-emerald-400">{formatNZD(Number(manualForm.total_amount || '0'))}</span>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-semibold text-slate-200">Line items (optional)</div>
                    <button
                      onClick={() => setManualItems((p) => [{ product_code: '', description: '', quantity: '', unit: '', price: '', amount_excl_gst: '0.00' }, ...p])}
                      className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-semibold">
                      + Add row
                    </button>
                  </div>

                  <div className="space-y-2">
                    {manualItems.map((it, idx) => (
                      <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <input
                          value={it.description}
                          list="manual-product-options"
                          onChange={(e) => {
                            const value = e.target.value;
                            setManualItems((prev) => {
                              const next = prev.map((x, i) => i === idx ? { ...x, description: value } : x);
                              const match = manualProductOptions.find((p) => p.name === value);
                              if (!match) return next;
                              return next.map((x, i) => {
                                if (i !== idx) return x;
                                return {
                                  ...x,
                                  product_code: x.product_code || (match.vendor_product_code ?? ''),
                                  unit: x.unit || (match.unit ?? ''),
                                };
                              });
                            });
                          }}
                          className="sm:col-span-6 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100"
                          placeholder="Product name"
                        />
                        <input
                          value={it.quantity}
                          onChange={(e) => {
                            const quantity = e.target.value;
                            setManualItems((p) => p.map((x, i) => {
                              if (i !== idx) return x;
                              const next = { ...x, quantity };
                              const q = toNumberOrNullInput(quantity) ?? 0;
                              const pr = toNumberOrNullInput(next.price) ?? 0;
                              next.amount_excl_gst = fmt2(q * pr);
                              return next;
                            }));
                          }}
                          className="sm:col-span-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 font-mono"
                          placeholder="Quantity"
                        />
                        <input
                          list="unit-options"
                          value={it.unit}
                          onChange={(e) => setManualItems((p) => p.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))}
                          className="sm:col-span-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 font-mono"
                          placeholder="Unit"
                        />
                        <input
                          value={it.price}
                          onChange={(e) => {
                            const price = e.target.value;
                            setManualItems((p) => p.map((x, i) => {
                              if (i !== idx) return x;
                              const next = { ...x, price };
                              const q = toNumberOrNullInput(next.quantity) ?? 0;
                              const pr = toNumberOrNullInput(price) ?? 0;
                              next.amount_excl_gst = fmt2(q * pr);
                              return next;
                            }));
                          }}
                          className="sm:col-span-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 font-mono"
                          placeholder="Unit price"
                        />
                        <div className="flex gap-2 sm:col-span-3">
                          <div
                            className="flex-1 bg-transparent border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-300 font-mono select-none"
                            title="Auto-calculated (not editable)"
                          >
                            {it.amount_excl_gst || '0.00'}
                          </div>
                          <button
                            onClick={() => setManualItems((p) => p.filter((_, i) => i !== idx))}
                            className="px-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:bg-red-600 hover:text-white">
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => setManualOpen(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold">
                    Cancel
                  </button>
                  <button
                    disabled={manualSaving}
                    onClick={submitManualInvoice}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-60">
                    {manualSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Upload Modal ───────────────────────────────────────────────────── */}
        {uploadStep !== 'idle' && !uploadModalHidden && (
          <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-700 shadow-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
                <h2 className="font-bold text-white text-lg">
                  {uploadStep === 'preview' ? '📸 Review invoice photo' :
                   uploadStep === 'processing' ? '🔄 Processing...' :
                   uploadStep === 'done' ? '✅ Done!' : '❌ Error'}
                </h2>
                {(uploadStep === 'preview' || uploadStep === 'error' || uploadStep === 'processing') && (
                  <button onClick={resetUpload} className="text-slate-400 hover:text-white transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              <div className="p-6 space-y-4">
                {(uploadStep === 'preview') && previewUrl && (
                  <>
                    <div className="relative rounded-xl overflow-hidden bg-slate-800 aspect-[4/3]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewUrl} alt="Invoice preview" className="w-full h-full object-contain" />
                      {previewSizeKB !== null && (
                        <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-lg">
                          {previewSizeKB.toFixed(0)}KB
                        </div>
                      )}
                    </div>

                    {/* Validation step per input-validation-specialist.md */}
                    <div className="bg-slate-800 rounded-xl p-4 text-sm text-slate-300">
                      <p className="font-medium text-white mb-1">🔍 Image optimized.</p>
                      <p>Can you clearly read the vendor name and the numbers?</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={resetUpload}
                        className="py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold text-sm transition-all">
                        📷 Too blurry — retake
                      </button>
                      <button
                        onClick={handleConfirmAndProcess}
                        className="py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all shadow-lg shadow-emerald-900/50 active:scale-95">
                        ✅ Looks good — run OCR
                      </button>
                    </div>
                  </>
                )}

                {uploadStep === 'processing' && (
                  <div className="flex flex-col items-center py-8 gap-6">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center">
                      <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                    </div>
                    <div className="text-center">
                      <p className="text-white font-semibold">{processingMsg}</p>
                      <p className="text-slate-400 text-sm mt-1">
                        You can close this popup — OCR will keep running in the background.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadModalHidden(true);
                        showToast('⏳ OCR is running in the background. You can keep using the app.', 'warn');
                      }}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm">
                      Close
                    </button>
                  </div>
                )}

                {uploadStep === 'done' && (
                  <div className="flex flex-col items-center py-8 gap-3">
                    <div className="w-16 h-16 rounded-full bg-emerald-600 flex items-center justify-center text-3xl">
                      ✅
                    </div>
                    <p className="text-white font-bold text-lg">Success!</p>
                    <p className="text-slate-400 text-sm">Invoice saved to the database.</p>
                  </div>
                )}

                {uploadStep === 'error' && (
                  <div className="space-y-4">
                    <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-sm text-red-300">
                      <p className="font-semibold text-red-400 mb-1">❌ Processing error</p>
                      <p>{uploadError}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={resetUpload} className="py-3 rounded-xl bg-slate-700 text-slate-200 font-semibold text-sm">
                        Cancel
                      </button>
                      <button onClick={handleConfirmAndProcess} className="py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm">
                        Retry
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Review Mode (Side-by-side) ─────────────────────────────────────── */}
        {selectedInvoice && (
          <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm overflow-y-auto">
            <div className="min-h-full flex items-start justify-center p-4 py-8">
              <div className="w-full max-w-6xl bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl overflow-hidden">
                {/* Review header */}
	                <div className="px-6 py-4 pr-28 border-b border-slate-800 flex items-center justify-between relative">
	                  <div>
	                    <h2 className="font-bold text-white text-lg">{selectedInvoice.vendor_name}</h2>
	                    <p className="text-slate-400 text-sm">#{selectedInvoice.invoice_number} · {formatDisplayDate(selectedInvoice.invoice_date)}</p>
	                  </div>
	                  <div className="flex items-center gap-2 sm:gap-3">
	                    {!selectedInvoice.vendor_id && (
	                      <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-950 border border-rose-800 text-rose-200 text-xs font-bold">
	                        <span className="w-2 h-2 rounded-full bg-rose-400" />
	                        Vendor not mapped
	                      </div>
	                    )}
	                  </div>
	                  <div className="absolute right-4 top-4 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Open actions menu"
                      onClick={() => setReviewMenuOpen(true)}
                      className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center justify-center"
                      title="Menu"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </button>
                    <button
                      aria-label="Close"
                      onClick={() => { setReviewMenuOpen(false); setSelectedInvoice(null); setImageZoom(1); setImageRotation(0); setEditMode(false); }}
                      className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center justify-center"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Review actions menu */}
                {reviewMenuOpen && (
                  <div className="fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setReviewMenuOpen(false)} />
                    <div className="absolute top-24 right-4 left-4 sm:left-auto sm:w-[360px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
                      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-800">
                        <div className="text-sm font-semibold text-slate-100">Actions</div>
                        <button
                          aria-label="Close menu"
                          onClick={() => setReviewMenuOpen(false)}
                          className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 flex items-center justify-center"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="p-3 space-y-2">
                        <button
                          disabled={editSaving}
                          onClick={() => { setReviewMenuOpen(false); saveEdit(); }}
                          className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500 disabled:opacity-60"
                        >
                          <span className="font-semibold">{editSaving ? 'Saving...' : 'Save'}</span>
                          <span className="text-emerald-100">→</span>
                        </button>

                        {!isSelectedCreditNote && (
                          <button
                            onClick={() => { setReviewMenuOpen(false); openCreditNote(); }}
                            className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
                          >
                            <span className="font-semibold">🧾 Create credit note</span>
                            <span className="text-slate-400">→</span>
                          </button>
                        )}

                        {selectedInvoice.status === 'pending_review' && (
                          <>
                            <button
                              onClick={() => { setReviewMenuOpen(false); updateStatus(selectedInvoice.id, 'approved'); }}
                              className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500"
                            >
                              <span className="font-semibold">✅ Approve</span>
                              <span className="text-emerald-100">→</span>
                            </button>
                            <button
                              onClick={() => { setReviewMenuOpen(false); updateStatus(selectedInvoice.id, 'rejected'); }}
                              className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white border border-red-500"
                            >
                              <span className="font-semibold">❌ Reject</span>
                              <span className="text-red-100">→</span>
                            </button>
                          </>
                        )}

	                        {(
	                          <button
	                            onClick={() => { setReviewMenuOpen(false); deleteInvoice(selectedInvoice.id); }}
	                            className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-800 hover:bg-red-600 text-slate-100 border border-slate-700"
	                          >
                            <span className="font-semibold">🗑️ Delete</span>
                            <span className="text-slate-400">→</span>
	                          </button>
	                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Side-by-side */}
                <div className="grid grid-cols-1 lg:grid-cols-2">
                  {/* LEFT: Image viewer */}
                  <div className="border-r border-slate-800 bg-slate-950">
                    <div className="p-3 border-b border-slate-800 flex items-center gap-2 bg-slate-900">
                      <span className="text-xs text-slate-400 font-medium flex-1">Original invoice image</span>
                      <button onClick={() => setImageZoom((z) => Math.min(z + 0.25, 3))}
                        className="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 transition-colors flex items-center justify-center font-mono">+</button>
                      <span className="text-xs text-slate-500 w-10 text-center">{Math.round(imageZoom * 100)}%</span>
                      <button onClick={() => setImageZoom((z) => Math.max(z - 0.25, 0.5))}
                        className="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 transition-colors flex items-center justify-center font-mono">-</button>
                      <button onClick={() => setImageRotation((r) => (r + 90) % 360)}
                        className="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors flex items-center justify-center">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </div>
                    <div className="relative overflow-auto" style={{ maxHeight: '70vh' }}>
                      {selectedInvoice.image_url ? (
                        <div className="flex items-center justify-center min-h-64 p-4">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={selectedInvoice.image_url}
                            alt="Invoice"
                            style={{
                              transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
                              transformOrigin: 'center center',
                              transition: 'transform 0.2s ease',
                            }}
                            className="max-w-full"
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-600 gap-2">
                          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="text-sm">No image</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* RIGHT: Data form */}
                  <div className="overflow-y-auto" style={{ maxHeight: '80vh' }}>
                    <div className="p-6 space-y-6">
                      {/* Invoice metadata */}
                      <section>
                        <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                          Invoice details
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                          <label>
                            <div className="text-slate-400 mb-1">Vendor *</div>
                            <input
                              list="vendor-options"
                              value={editForm.vendor_name}
                              onChange={(e) => setEditForm((p) => ({ ...p, vendor_name: e.target.value }))}
                              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                            />
                          </label>
                          <label>
                            <div className="text-slate-400 mb-1">GST Number</div>
                            <input
                              value={editForm.vendor_gst_number}
                              onChange={(e) => setEditForm((p) => ({ ...p, vendor_gst_number: e.target.value }))}
                              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                            />
                          </label>
                          <label>
                            <div className="text-slate-400 mb-1">Invoice number</div>
                            <input
                              value={editForm.invoice_number}
                              onChange={(e) => setEditForm((p) => ({ ...p, invoice_number: e.target.value }))}
                              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                            />
                          </label>
                          <label>
                            <div className="text-slate-400 mb-1">Date *</div>
                            <input
                              type="date"
                              value={editForm.invoice_date}
                              onChange={(e) => setEditForm((p) => ({ ...p, invoice_date: e.target.value }))}
                              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                            />
                          </label>
                          <label className="sm:col-span-2">
                            <div className="text-slate-400 mb-1">Category</div>
                            <input
                              value={editForm.category}
                              onChange={(e) => setEditForm((p) => ({ ...p, category: e.target.value }))}
                              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                            />
                          </label>
                        </div>
                      </section>

                      {/* Line items */}
                      <section>
                        <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                          Line items ({selectedInvoice.invoice_items?.length ?? 0})
                        </h3>
                        <div className="bg-slate-800 rounded-xl p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-semibold text-slate-200">
                                Edit items <span className="text-xs text-slate-500 font-normal">(tap text to edit)</span>
                              </div>
                              <button
                                onClick={() => setEditItems((p) => [{ product_code: '', description: '', quantity: '', standard: '', unit: '', price: '', amount_excl_gst: '' }, ...p])}
                                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-semibold">
                                + Add row
                              </button>
                            </div>
                            <div className="space-y-2">
                              {editItems.map((it, idx) => (
                                <div key={idx} className="bg-slate-800 rounded-xl p-3 text-sm">
                                  <div className="flex justify-between gap-2 mb-1">
                                  <span className="text-white font-medium leading-tight flex-1">
                                      <input
                                        value={it.description}
                                        list="edit-product-options"
                                        onChange={(e) => {
                                          const value = e.target.value;
                                          setEditItems((prev) => {
                                            const next = prev.map((x, i) => i === idx ? { ...x, description: value } : x);
                                            const match = editProductOptions.find((p) => p.name === value);
                                            if (!match) return next;
                                            return next.map((x, i) => {
                                              if (i !== idx) return x;
                                              return {
                                                ...x,
                                                product_code: x.product_code || (match.vendor_product_code ?? ''),
                                                unit: x.unit || (match.unit ?? ''),
                                                standard: x.standard || (match.standard ?? ''),
                                              };
                                            });
                                          });
                                        }}
                                        className="w-full bg-transparent border-0 p-0 m-0 text-white font-medium leading-tight focus:outline-none underline decoration-dotted decoration-slate-600 underline-offset-2 hover:decoration-slate-400 focus:decoration-emerald-400"
                                        placeholder="Product name"
                                      />
                                      {it.standard ? ` · ${it.standard}` : ''}
                                    </span>
                                    <span className={`${isSelectedCreditNote ? 'text-red-400' : 'text-emerald-400'} font-mono font-bold whitespace-nowrap`}>
                                      {formatNZD(isSelectedCreditNote ? -Math.abs(Number(it.amount_excl_gst || '0')) : Number(it.amount_excl_gst || '0'))}
                                    </span>
                                  </div>

                                  <div className="flex gap-4 text-xs text-slate-400 items-center">
                                    {it.product_code && (
                                      <span className="font-mono">
                                        <input
                                          value={it.product_code}
                                          onChange={(e) => setEditItems((p) => p.map((x, i) => i === idx ? { ...x, product_code: e.target.value } : x))}
                                          className="w-28 bg-transparent border-0 p-0 m-0 text-slate-400 font-mono focus:outline-none underline decoration-dotted decoration-slate-700 underline-offset-2 hover:decoration-slate-500 focus:decoration-emerald-400"
                                          placeholder="Code"
                                        />
                                      </span>
                                    )}
                                    <span>
                                      SL:{' '}
                                      <span className="text-slate-200">
                                        <input
                                          value={it.quantity}
                                          onChange={(e) => {
                                            const quantity = e.target.value;
                                          setEditItems((p) => p.map((x, i) => {
                                              if (i !== idx) return x;
                                              const next: typeof x = { ...x, quantity };
                                              const q = toNumberOrNullInput(quantity) ?? 0;
                                              const pr = toNumberOrNullInput(next.price) ?? 0;
                                              next.amount_excl_gst = isSelectedCreditNote ? fmt2(-Math.abs(q * pr)) : fmt2(q * pr);
                                              return next;
                                            }));
                                          }}
                                          className="w-16 bg-transparent border-0 p-0 m-0 text-slate-200 font-mono focus:outline-none underline decoration-dotted decoration-slate-700 underline-offset-2 hover:decoration-slate-500 focus:decoration-emerald-400"
                                          placeholder="0"
                                        />{' '}
                                        <input
                                          list="unit-options"
                                          value={it.unit}
                                          onChange={(e) => setEditItems((p) => p.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))}
                                          className="w-14 bg-transparent border-0 p-0 m-0 text-slate-200 font-mono focus:outline-none underline decoration-dotted decoration-slate-700 underline-offset-2 hover:decoration-slate-500 focus:decoration-emerald-400"
                                          placeholder="EA"
                                        />
                                      </span>
                                    </span>
                                    <span>
                                      Unit price:{' '}
                                      <span className="text-slate-200 font-mono">
                                        <input
                                          value={it.price}
                                          onChange={(e) => {
                                            const price = e.target.value;
                                            setEditItems((p) => p.map((x, i) => {
                                              if (i !== idx) return x;
                                              const next: typeof x = { ...x, price };
                                              const q = toNumberOrNullInput(next.quantity) ?? 0;
                                              const pr = toNumberOrNullInput(price) ?? 0;
                                              next.amount_excl_gst = isSelectedCreditNote ? fmt2(-Math.abs(q * pr)) : fmt2(q * pr);
                                              return next;
                                            }));
                                          }}
                                          className="w-20 bg-transparent border-0 p-0 m-0 text-slate-200 font-mono focus:outline-none underline decoration-dotted decoration-slate-700 underline-offset-2 hover:decoration-slate-500 focus:decoration-emerald-400"
                                          placeholder="0.00"
                                        />
                                      </span>
                                    </span>

                                    <button
                                      onClick={() => setEditItems((p) => p.filter((_, i) => i !== idx))}
                                      className="ml-auto px-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:bg-red-600 hover:text-white"
                                      title="Delete row"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                      </section>

                      {/* Totals */}
                      <section className="bg-slate-800 rounded-xl p-4 space-y-2 text-sm">
                        <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                          Summary
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {([
                            ['Subtotal', 'sub_total'],
                            ['Freight', 'freight'],
                            ['GST', 'gst_amount'],
                            ['Total', 'total_amount'],
                          ] as Array<[string, MoneyFieldKey]>).map(([label, key]) => (
                            <label key={key} className="text-sm">
                              <div className="text-slate-400 mb-1">{label}</div>
                              <input
                                inputMode="decimal"
                                value={editForm[key]}
                                onChange={(e) => setEditForm((p) => ({ ...p, [key]: e.target.value }))}
                                readOnly={key !== 'freight'}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 font-mono"
                                placeholder="0.00"
                              />
                            </label>
                          ))}
                        </div>
                      </section>

                      {/* Status action (mobile) */}
                      {selectedInvoice.status === 'pending_review' && (
                        <div className="grid grid-cols-2 gap-3 lg:hidden">
                          <button
                            onClick={() => updateStatus(selectedInvoice.id, 'rejected')}
                            className="py-3 rounded-xl bg-red-600 text-white font-bold">❌ Reject</button>
                          <button
                            onClick={() => updateStatus(selectedInvoice.id, 'approved')}
                            className="py-3 rounded-xl bg-emerald-600 text-white font-bold">✅ Approve</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Stats cards ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Spend', value: formatNZD(totalSpend), icon: '💰', color: 'from-emerald-500 to-teal-600' },
            { label: 'Total GST', value: formatNZD(totalGST), icon: '🧾', color: 'from-blue-500 to-indigo-600' },
            { label: 'Invoices', value: totalCount.toString(), icon: '📋', color: 'from-violet-500 to-purple-600' },
            { label: 'Pending', value: pendingCount.toString(), icon: '⏳', color: 'from-amber-500 to-orange-600' },
          ].map((stat) => (
            <div key={stat.label} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center text-lg mb-3`}>
                {stat.icon}
              </div>
              <p className="text-2xl font-black text-white">{stat.value}</p>
              <p className="text-xs text-slate-400 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setNotifOpen(true)}
            className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-sm font-semibold hover:border-slate-500"
          >
            Notifications
          </button>
        </div>

        {activeOcrJobs.length > 0 && (
          <section className="bg-slate-900 border border-emerald-900/40 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-white font-bold">Invoices processing</h2>
                <p className="text-sm text-slate-400 mt-1">You can keep using the app while OCR runs in the background.</p>
              </div>
              <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-300 text-xs font-semibold border border-emerald-500/20">
                {activeOcrJobs.length} job
              </span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {activeOcrJobs.map((job) => {
                const err = (job.error_message || '').toLowerCase();
                const isBackoff = job.status === 'queued' && (
                  err.includes('high demand') || err.includes('"code": 503') || err.includes(' 503 ')
                );
                const canRetryNow =
                  job.status === 'queued' &&
                  !!job.next_run_at &&
                  new Date(job.next_run_at).getTime() <= Date.now();
                const subtitle = job.status === 'processing'
                  ? 'Gemini is extracting invoice data'
                  : isBackoff
                    ? `OCR overloaded, ${formatRelativeWait(job.next_run_at) || 'waiting to retry'}`
                    : 'Waiting for a worker to pick up the job';

                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setJobPreview({ jobId: job.id, imageUrl: job.public_url ?? null })}
                    className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-left hover:border-slate-600 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-white font-semibold">OCR Job {job.id.slice(0, 8)}</div>
                        <div className="text-xs text-slate-400 mt-1">{subtitle}</div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                        job.status === 'processing'
                          ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                          : isBackoff
                            ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}>
                        {job.status === 'processing' ? 'Running OCR' : isBackoff ? 'Backoff' : 'Queued'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 mt-4 text-xs text-slate-500">
                      <span>Attempt {job.attempts}/{job.max_attempts}</span>
                      <div className="flex items-center gap-2">
                        <span>{job.next_run_at ? formatRelativeWait(job.next_run_at) ?? 'running' : 'running'}</span>
                        {canRetryNow && (
                          <button
                            type="button"
                            onClick={() => void retryActiveOcrJob(job.id)}
                            disabled={activeJobRetryId === job.id}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold disabled:opacity-60"
                          >
                            {activeJobRetryId === job.id ? 'Calling...' : 'Retry now'}
                          </button>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {jobPreview && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl w-full max-w-3xl border border-slate-700 shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                <div className="text-white font-bold">OCR Job {jobPreview.jobId.slice(0, 8)}</div>
                <button
                  onClick={() => setJobPreview(null)}
                  className="text-slate-400 hover:text-white transition-colors"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-6">
                {jobPreview.imageUrl ? (
                  <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={jobPreview.imageUrl} alt="OCR job preview" className="w-full h-[70vh] object-contain" />
                  </div>
                ) : (
                  <div className="text-slate-400 text-sm">This job has no image preview.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {notifOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl w-full max-w-2xl border border-slate-700 shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                <div className="text-white font-bold">Notifications</div>
                <button
                  onClick={() => setNotifOpen(false)}
                  className="text-slate-400 hover:text-white transition-colors"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
                {notifLoading ? (
                  <div className="text-slate-400 text-sm">Loading...</div>
                ) : ocrNotifications.length === 0 ? (
                  <div className="text-slate-400 text-sm">No notifications yet.</div>
                ) : (
                  ocrNotifications.map((n) => (
                    <div key={n.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-white font-semibold">
                            {n.invoice?.vendor_name ? n.invoice.vendor_name : `OCR Job ${n.id.slice(0, 8)}`}
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            {n.invoice?.invoice_number ? `#${n.invoice.invoice_number}` : ''}{' '}
                            {n.invoice?.invoice_date ? `· ${formatDisplayDate(n.invoice.invoice_date)}` : ''}
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          n.status === 'succeeded'
                            ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                        }`}>
                          {n.status === 'succeeded' ? 'Done' : 'Error'}
                        </span>
                      </div>
                      {n.status === 'failed' && (
                        <div className="text-xs text-rose-200 mt-3">{n.error_message || 'OCR failed'}</div>
                      )}
                      <div className="flex items-center justify-between gap-3 mt-4 text-xs text-slate-500">
                        <span>Job {n.id.slice(0, 8)}</span>
                        <span>{n.ocr_model ? `${n.ocr_provider || 'gemini'}/${n.ocr_model}` : ''}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          {([
            { key: 'list', label: 'List' },
            { key: 'report', label: 'Reports' },
          ] as Array<{ key: DashboardView; label: string }>).map((view) => (
            <button
              key={view.key}
              onClick={() => setDashboardView(view.key)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                dashboardView === view.key
                  ? 'bg-white text-slate-950 border-white'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>

        {/* ── Filters ────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {dashboardView === 'list' ? (
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search vendor, invoice number..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            ) : (
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  list="vendor-options"
                  placeholder="Filter by vendor..."
                  value={reportVendorFilter}
                  onChange={(e) => setReportVendorFilter(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <input
                  type="text"
                  placeholder="Search product or code..."
                  value={reportProductSearch}
                  onChange={(e) => setReportProductSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            )}
            <div className="flex gap-2">
              {(['all', 'pending_review', 'approved', 'rejected'] as FilterStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border
                    ${filterStatus === s
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                  {s === 'all' ? 'All' : statusConfig[s]?.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'all', label: 'All time' },
                { key: 'day', label: 'Today' },
                { key: 'month', label: 'This month' },
                { key: 'custom', label: 'Custom' },
              ] as Array<{ key: DatePreset; label: string }>).map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyDatePreset(p.key)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border
                    ${datePreset === p.key
                      ? 'bg-slate-800 border-slate-600 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                  {p.label}
                </button>
              ))}
            </div>

            {datePreset === 'custom' && (
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                />
                <span className="text-xs text-slate-500 hidden sm:inline">→</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                />
                <button
                  onClick={applyCustomRange}
                  className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors"
                >
                  Apply
                </button>
              </div>
            )}

            {(dateFrom || dateTo) && (
              <div className="text-xs text-slate-500 sm:ml-auto">
                Filtering: <span className="font-mono text-slate-300">{dateFrom || '…'}</span> →{' '}
                <span className="font-mono text-slate-300">{dateTo || '…'}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Invoice table / cards ──────────────────────────────────────────── */}
        {dashboardView === 'list' ? (
          loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-500">
            <div className="w-5 h-5 border-2 border-slate-600 border-t-emerald-500 rounded-full animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-600">
            <div className="w-20 h-20 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-4xl">
              📭
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-400">No invoices yet</p>
              <p className="text-sm mt-1">Click &quot;Add invoice&quot; to scan your first invoice</p>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800">
                      {['Date', 'Vendor', 'Invoice #', 'Category', 'GST', 'Total', 'Status', ''].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
	                    {invoices.map((invoice, idx) => {
	                      const sc = statusConfig[invoice.status];
	                      const vendorUnmapped = !invoice.vendor_id;
	                      const isCredit =
	                        (invoice.type ?? '').toLowerCase().includes('credit') ||
	                        (invoice.total_amount ?? 0) < 0 ||
	                        !!invoice.parent_invoice_id;
	                      return (
	                        <tr
	                          key={invoice.id}
	                          className={`border-b border-slate-800/50 hover:bg-slate-800/50 cursor-pointer transition-colors group
	                            ${idx % 2 === 0 ? '' : 'bg-slate-900/50'}
	                            ${vendorUnmapped ? 'bg-rose-950/20 hover:bg-rose-950/30' : ''}`}
	                          onClick={() => setSelectedInvoice(invoice)}>
	                          <td className="px-4 py-4 text-slate-300 font-mono text-xs">{formatDisplayDate(invoice.invoice_date)}</td>
	                          <td className="px-4 py-4">
	                            <div className="font-semibold text-white">{invoice.vendor_name}</div>
	                            {vendorUnmapped && (
	                              <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-rose-950 border border-rose-800 text-rose-200 text-[11px] font-semibold">
	                                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
	                                Vendor not mapped
	                              </div>
	                            )}
	                            {invoice.vendor_gst_number && <div className="text-xs text-slate-500">GST: {invoice.vendor_gst_number}</div>}
	                          </td>
                          <td className="px-4 py-4 text-slate-400 font-mono text-xs">{invoice.invoice_number ?? '—'}</td>
                          <td className="px-4 py-4">
                            <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 text-xs">{invoice.category ?? '—'}</span>
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-slate-300">{formatNZD(invoice.gst_amount)}</td>
                          <td className={`px-4 py-4 text-right font-mono font-bold ${isCredit ? 'text-red-400' : 'text-emerald-400'}`}>
                            {formatNZD(invoice.total_amount)}
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${sc.bg} ${sc.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                              {sc.label}
                            </span>
                          </td>
	                          <td className="px-4 py-4">
	                            <span className="text-slate-600 group-hover:text-slate-300 transition-colors text-xs">View →</span>
	                          </td>
	                        </tr>
	                      );
	                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden space-y-3">
	              {invoices.map((invoice) => {
	                const sc = statusConfig[invoice.status];
	                const vendorUnmapped = !invoice.vendor_id;
	                const isCredit =
	                  (invoice.type ?? '').toLowerCase().includes('credit') ||
	                  (invoice.total_amount ?? 0) < 0 ||
	                  !!invoice.parent_invoice_id;
	                return (
	                  <button
	                    key={invoice.id}
	                    onClick={() => setSelectedInvoice(invoice)}
	                    className={`w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-left hover:border-slate-700 transition-all active:scale-99
	                      ${vendorUnmapped ? 'border-rose-800 bg-rose-950/20' : ''}`}>
	                    <div className="flex justify-between items-start mb-3">
	                      <div>
	                        <p className="font-bold text-white">{invoice.vendor_name}</p>
	                        <p className="text-xs text-slate-400 mt-0.5">{formatDisplayDate(invoice.invoice_date)} · #{invoice.invoice_number ?? '—'}</p>
	                        {vendorUnmapped && (
	                          <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-rose-950 border border-rose-800 text-rose-200 text-[11px] font-semibold">
	                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
	                            Vendor not mapped
	                          </div>
	                        )}
	                      </div>
	                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${sc.bg} ${sc.text}`}>
	                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
	                        {sc.label}
	                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="text-xs text-slate-500">GST: <span className="text-slate-300">{formatNZD(invoice.gst_amount)}</span></div>
                      <div className={`text-xl font-black ${isCredit ? 'text-red-400' : 'text-emerald-400'}`}>{formatNZD(invoice.total_amount)}</div>
                    </div>
                  </button>
	                );
	              })}
            </div>
          </>
          )
        ) : reportLoading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-500">
            <div className="w-5 h-5 border-2 border-slate-600 border-t-emerald-500 rounded-full animate-spin" />
            <span className="text-sm">Loading report...</span>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-800">
                  <h2 className="text-white font-bold">By vendor</h2>
                  <p className="text-sm text-slate-400 mt-1">Totals based on invoices in the current filter range.</p>
                </div>
                {costReport && costReport.vendor_summary.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase">
                          <th className="px-4 py-3 text-left">Vendor</th>
                          <th className="px-4 py-3 text-right">Invoices</th>
                          <th className="px-4 py-3 text-right">Ex GST</th>
                          <th className="px-4 py-3 text-right">GST</th>
                          <th className="px-4 py-3 text-right">Incl GST</th>
                        </tr>
                      </thead>
                      <tbody>
                        {costReport.vendor_summary.map((row) => (
                          <tr key={row.vendor_name} className="border-b border-slate-800/60">
                            <td className="px-4 py-3 text-white font-semibold">{row.vendor_name}</td>
                            <td className="px-4 py-3 text-right text-slate-300 font-mono">{row.invoice_count}</td>
                            <td className="px-4 py-3 text-right text-slate-300 font-mono">{formatNZD(row.total_ex_gst)}</td>
                            <td className="px-4 py-3 text-right text-slate-300 font-mono">{formatNZD(row.gst_total)}</td>
                            <td className="px-4 py-3 text-right text-emerald-400 font-mono font-bold">{formatNZD(row.total_inc_gst)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-5 py-12 text-sm text-slate-500">No vendor data for this filter.</div>
                )}
              </section>

              <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-white font-bold">Price insights</h2>
                <p className="text-sm text-slate-400 mt-1">Compare the latest purchase to the previous one, per vendor + product.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-rose-300">Price up</div>
                    {costReport && costReport.price_insights.increased.length > 0 ? costReport.price_insights.increased.map((row) => (
                      <div key={`up-${row.product_key}`} className="rounded-2xl border border-rose-900/50 bg-rose-950/20 p-4">
                        <div className="text-white font-semibold">{row.product_name}</div>
                        <div className="text-xs text-slate-400 mt-1">{row.vendor_name}</div>
                        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                          <span className="text-slate-300">{formatNZD(row.previous_price_ex_gst)} {'->'} {formatNZD(row.latest_price_ex_gst)}</span>
                          <span className="text-rose-300 font-bold">{formatPct(row.pct_change)}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-2">{formatDisplayDate(row.previous_invoice_date)} {'->'} {formatDisplayDate(row.latest_invoice_date)}</div>
                      </div>
                    )) : <div className="text-sm text-slate-500">No products with price increases.</div>}
                  </div>

                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-emerald-300">Price down</div>
                    {costReport && costReport.price_insights.decreased.length > 0 ? costReport.price_insights.decreased.map((row) => (
                      <div key={`down-${row.product_key}`} className="rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-4">
                        <div className="text-white font-semibold">{row.product_name}</div>
                        <div className="text-xs text-slate-400 mt-1">{row.vendor_name}</div>
                        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                          <span className="text-slate-300">{formatNZD(row.previous_price_ex_gst)} {'->'} {formatNZD(row.latest_price_ex_gst)}</span>
                          <span className="text-emerald-300 font-bold">{formatPct(row.pct_change)}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-2">{formatDisplayDate(row.previous_invoice_date)} {'->'} {formatDisplayDate(row.latest_invoice_date)}</div>
                      </div>
                    )) : <div className="text-sm text-slate-500">No products with price decreases.</div>}
                  </div>
                </div>
              </section>
            </div>

            <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h2 className="text-white font-bold">By product</h2>
                <p className="text-sm text-slate-400 mt-1">Product cost uses `exclude GST` and converts `incl GST = ex * 1.15`.</p>
              </div>
              {costReport && costReport.product_summary.length > 0 ? (
                <>
                  <div className="hidden xl:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase">
                          <th className="px-4 py-3 text-left">Product</th>
                          <th className="px-4 py-3 text-left">Vendor</th>
                          <th className="px-4 py-3 text-left">Unit</th>
                          <th className="px-4 py-3 text-right">Qty</th>
                          <th className="px-4 py-3 text-right">Ex GST</th>
                          <th className="px-4 py-3 text-right">Incl GST</th>
                          <th className="px-4 py-3 text-right">Latest price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {costReport.product_summary.map((row) => (
                          <tr key={`${row.product_key}-${row.vendor_name}`} className="border-b border-slate-800/60">
                            <td className="px-4 py-3 text-white font-semibold">{row.product_name}</td>
                            <td className="px-4 py-3 text-slate-300">{row.vendor_name}</td>
                            <td className="px-4 py-3 text-slate-400 font-mono text-xs">{row.unit ?? '—'}</td>
                            <td className="px-4 py-3 text-right text-slate-300 font-mono">{row.total_qty}</td>
                            <td className="px-4 py-3 text-right text-slate-300 font-mono">{formatNZD(row.total_ex_gst)}</td>
                            <td className="px-4 py-3 text-right text-emerald-400 font-mono font-bold">{formatNZD(row.total_inc_gst)}</td>
                            <td className="px-4 py-3 text-right text-slate-300 font-mono">{row.last_price_ex_gst === null ? '—' : formatNZD(row.last_price_ex_gst)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="xl:hidden p-4 space-y-3">
                    {costReport.product_summary.map((row) => (
                      <div key={`${row.product_key}-${row.vendor_name}`} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                        <div className="text-white font-semibold">{row.product_name}</div>
                        <div className="text-xs text-slate-400 mt-1">{row.vendor_name} · {row.unit ?? '—'}</div>
                        <div className="grid grid-cols-2 gap-3 text-sm mt-3">
                          <div className="text-slate-400">Qty <span className="text-slate-200 font-mono ml-2">{row.total_qty}</span></div>
                          <div className="text-slate-400">Latest price <span className="text-slate-200 font-mono ml-2">{row.last_price_ex_gst === null ? '—' : formatNZD(row.last_price_ex_gst)}</span></div>
                          <div className="text-slate-400">Ex GST <span className="text-slate-200 font-mono ml-2">{formatNZD(row.total_ex_gst)}</span></div>
                          <div className="text-slate-400">Incl GST <span className="text-emerald-300 font-mono ml-2">{formatNZD(row.total_inc_gst)}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="px-5 py-12 text-sm text-slate-500">No product data for this filter.</div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
