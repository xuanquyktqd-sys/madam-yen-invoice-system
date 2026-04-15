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

// ─── Helpers ────────────────────────────────────────────────────────────────
const formatNZD = (n: number) =>
  new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(n);

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
  pending_review: { label: 'Chờ duyệt', bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-400' },
  approved: { label: 'Đã duyệt', bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  rejected: { label: 'Từ chối', bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-400' },
};

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
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [unitOptions, setUnitOptions] = useState<string[]>([]);
  const [standardOptions, setStandardOptions] = useState<string[]>([]);
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
    standard: string;
    unit: string;
    price: string;
    amount_excl_gst: string;
  }>>([{ product_code: '', description: '', quantity: '', standard: '', unit: '', price: '', amount_excl_gst: '0.00' }]);

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

  // ── Fetch invoices ────────────────────────────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (search) params.set('search', search);
      const res = await fetch(`/api/invoices?${params.toString()}`);
      const json = await res.json();
      setInvoices(json.invoices ?? []);
      setTotalCount(json.total ?? 0);
    } catch {
      showToast('Không tải được danh sách hóa đơn', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, search]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);
  useEffect(() => {
    // Optional catalog endpoints (safe to fail before DB migration is applied)
    void Promise.all([
      fetch('/api/catalog/vendors').then((r) => r.json()).catch(() => ({})),
      fetch('/api/catalog/units').then((r) => r.json()).catch(() => ({})),
      fetch('/api/catalog/standards').then((r) => r.json()).catch(() => ({})),
    ]).then(([v, u, s]) => {
      setVendorOptions(Array.isArray(v?.vendors) ? v.vendors : []);
      setUnitOptions(Array.isArray(u?.units) ? u.units : []);
      setStandardOptions(Array.isArray(s?.standards) ? s.standards : []);
    });
  }, []);

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
    setProcessingMsg('Đang gửi ảnh lên Gemini...');

    try {
      const fd = new FormData();
      fd.append('image', previewFile);

      setProcessingMsg('Đang chạy OCR (Gemini 1.5 Pro)...');
      const res = await fetch('/api/process', { method: 'POST', body: fd });
      const json = await res.json();

      if (res.status === 409) {
        showToast(`⚠️ Hóa đơn trùng lặp! ${json.warning}`, 'warn');
        resetUpload();
        return;
      }

      if (!res.ok) {
        throw new Error(json.error ?? 'Lỗi không xác định');
      }

      setProcessingMsg('Lưu vào database...');
      showToast(`✅ Xử lý thành công: ${json.data?.invoice_metadata?.vendor_name}`, 'success');
      setUploadStep('done');
      await fetchInvoices();
      setTimeout(() => resetUpload(), 2000);
    } catch (err) {
      setUploadError((err as Error).message);
      setUploadStep('error');
    }
  };

  const resetUpload = () => {
    setUploadStep('idle');
    setPreviewUrl(null);
    setPreviewFile(null);
    setPreviewSizeKB(null);
    setUploadError(null);
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
      showToast(status === 'approved' ? '✅ Đã duyệt hóa đơn' : '❌ Đã từ chối hóa đơn', 'success');
      await fetchInvoices();
      if (selectedInvoice?.id === id) {
        setSelectedInvoice((prev) => prev ? { ...prev, status } : prev);
      }
    }
  };

  // ── Delete invoice ─────────────────────────────────────────────────────────
  const deleteInvoice = async (id: string) => {
    const ok = window.confirm('Xoá hóa đơn này? Hành động này không thể hoàn tác.');
    if (!ok) return;

    const res = await fetch('/api/invoices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (res.ok) {
      showToast('🗑️ Đã xoá hóa đơn', 'success');
      if (selectedInvoice?.id === id) setSelectedInvoice(null);
      await fetchInvoices();
      return;
    }

    const json = await res.json().catch(() => ({}));
    showToast(json.error ?? 'Không xoá được hóa đơn', 'error');
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
    setManualItems([{ product_code: '', description: '', quantity: '', standard: '', unit: '', price: '', amount_excl_gst: '0.00' }]);
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
      showToast('Vui lòng nhập Nhà cung cấp và Ngày', 'error');
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
          standard: it.standard.trim() || null,
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
        showToast('⚠️ Hóa đơn trùng lặp (duplicate)', 'warn');
        return;
      }
      if (!res.ok) {
        throw new Error(json.error ?? 'Tạo hóa đơn thất bại');
      }

      showToast('✅ Đã thêm hóa đơn thủ công', 'success');
      setManualOpen(false);
      await fetchInvoices();
      if (json.invoice) {
        setSelectedInvoice(json.invoice);
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setManualSaving(false);
    }
  };

  const startEdit = () => {
    if (!selectedInvoice) return;
    setEditForm({
      vendor_name: selectedInvoice.vendor_name ?? '',
      vendor_gst_number: selectedInvoice.vendor_gst_number ?? '',
      invoice_number: selectedInvoice.invoice_number ?? '',
      invoice_date: toDateInput(selectedInvoice.invoice_date ?? ''),
      category: selectedInvoice.category ?? '',
      sub_total: String(selectedInvoice.sub_total ?? ''),
      freight: String(selectedInvoice.freight ?? ''),
      gst_amount: String(selectedInvoice.gst_amount ?? ''),
      total_amount: String(selectedInvoice.total_amount ?? ''),
    });
    setEditItems(
      (selectedInvoice.invoice_items ?? []).map((it) => ({
        product_code: it.product_code ?? '',
        description: it.description ?? '',
        quantity: String(it.quantity ?? ''),
        standard: it.standard ?? '',
        unit: it.unit ?? '',
        price: String(it.price ?? ''),
        amount_excl_gst: String(it.amount_excl_gst ?? ''),
      }))
    );
    setEditMode(true);
  };

  useEffect(() => {
    if (!editMode) return;
    const totals = calcTotalsFromRows(editItems, editForm.freight);
    setEditForm((p) => {
      if (p.sub_total === totals.sub_total && p.gst_amount === totals.gst_amount && p.total_amount === totals.total_amount) return p;
      return { ...p, ...totals };
    });
  }, [editMode, editItems, editForm.freight]);

  const cancelEdit = () => {
    setEditMode(false);
    setEditItems([]);
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
      showToast('Chọn ít nhất 1 mặt hàng để tạo credit note', 'error');
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
      if (!res.ok) throw new Error(json.error ?? 'Tạo credit note thất bại');

      showToast('✅ Đã tạo Credit Note', 'success');
      setCreditOpen(false);
      await fetchInvoices();
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
      showToast('Vui lòng nhập Nhà cung cấp và Ngày', 'error');
      return;
    }

    const normalizedEditItems = editItems
      .map((it) => {
        const q = toNumberOrNullInput(it.quantity) ?? 0;
        const p = toNumberOrNullInput(it.price) ?? 0;
        return { ...it, amount_excl_gst: fmt2(q * p) };
      })
      .filter((it) => it.description.trim());

    const totals = calcTotalsFromRows(normalizedEditItems, editForm.freight);

    const payload = {
      id: selectedInvoice.id,
      vendor_name: editForm.vendor_name.trim(),
      vendor_gst_number: editForm.vendor_gst_number.trim() || null,
      invoice_number: editForm.invoice_number.trim() || null,
      invoice_date: editForm.invoice_date,
      category: editForm.category.trim() || null,
      sub_total: toNumberOrNullInput(totals.sub_total),
      freight: toNumberOrNullInput(editForm.freight),
      gst_amount: toNumberOrNullInput(totals.gst_amount),
      total_amount: toNumberOrNullInput(totals.total_amount),
      invoice_items: normalizedEditItems
        .map((it) => ({
          product_code: it.product_code.trim() || null,
          description: it.description.trim(),
          quantity: toNumberOrNullInput(it.quantity),
          standard: it.standard.trim() || null,
          unit: it.unit.trim() || null,
          price: toNumberOrNullInput(it.price),
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
        throw new Error(json.error ?? 'Lưu chỉnh sửa thất bại');
      }
      showToast('✅ Đã lưu chỉnh sửa', 'success');
      setEditMode(false);
      await fetchInvoices();
      if (json.invoice) setSelectedInvoice(json.invoice);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [
      ['Ngày', 'Nhà cung cấp', 'Mã hóa đơn', 'Tổng tiền', 'GST', 'Trạng thái'],
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
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium animate-fade-in
          ${toastMsg.type === 'success' ? 'bg-emerald-600' :
            toastMsg.type === 'error'   ? 'bg-red-600' : 'bg-amber-500'}`}>
          {toastMsg.text}
        </div>
      )}

      <datalist id="vendor-options">
        {vendorOptions.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="unit-options">
        {unitOptions.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <datalist id="standard-options">
        {standardOptions.map((s) => (
          <option key={s} value={s} />
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
              <span className="hidden sm:inline">Thêm hóa đơn</span>
              <span className="sm:hidden">Thêm</span>
            </label>
            <button
              onClick={openManualModal}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border border-slate-700">
              ✍️ Thêm thủ công
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
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border border-slate-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              CSV
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ── Credit Note Modal ───────────────────────────────────────────── */}
        {creditOpen && selectedInvoice && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl w-full max-w-4xl border border-slate-700 shadow-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-white text-lg">🧾 Tạo Credit Note</h2>
                  <p className="text-xs text-slate-400 mt-1">Từ hoá đơn: {selectedInvoice.vendor_name} · #{selectedInvoice.invoice_number ?? '—'}</p>
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
                    <div className="text-slate-400 mb-1">Credit Note Number (tuỳ chọn)</div>
                    <input
                      value={creditNumber}
                      onChange={(e) => setCreditNumber(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                      placeholder="CN-..."
                    />
                  </label>
                  <label className="text-sm">
                    <div className="text-slate-400 mb-1">Ngày</div>
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
                    <div className="text-sm font-semibold text-slate-200">Chọn mặt hàng cần credit</div>
                    <button
                      onClick={() => setCreditRows((p) => p.map((r) => ({ ...r, selected: true })))}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold">
                      Chọn tất cả
                    </button>
                  </div>
                  <div className="max-h-[45vh] overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-900">
                        <tr className="border-b border-slate-700">
                          {['', 'Sản phẩm', 'Qty', 'Price', 'Amount (ex GST)'].map((h) => (
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
                    Huỷ
                  </button>
                  <button
                    disabled={creditSaving}
                    onClick={submitCreditNote}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-60">
                    {creditSaving ? 'Đang tạo...' : 'Tạo Credit Note'}
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
                <h2 className="font-bold text-white text-lg">✍️ Thêm hóa đơn thủ công</h2>
                <button onClick={() => setManualOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="text-sm">
                    <div className="text-slate-400 mb-1">Nhà cung cấp *</div>
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
                    <div className="text-slate-400 mb-1">Số hóa đơn</div>
                    <input
                      value={manualForm.invoice_number}
                      onChange={(e) => setManualForm((p) => ({ ...p, invoice_number: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                      placeholder="IN000..."
                    />
                  </label>
                  <label className="text-sm">
                    <div className="text-slate-400 mb-1">Ngày *</div>
                    <input
                      type="date"
                      value={manualForm.invoice_date}
                      onChange={(e) => setManualForm((p) => ({ ...p, invoice_date: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                    />
                  </label>
                  <label className="text-sm sm:col-span-2">
                    <div className="text-slate-400 mb-1">Danh mục</div>
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
                    <div className="text-sm font-semibold text-slate-200">Mặt hàng (tuỳ chọn)</div>
                    <button
                      onClick={() => setManualItems((p) => [...p, { product_code: '', description: '', quantity: '', standard: '', unit: '', price: '', amount_excl_gst: '0.00' }])}
                      className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-semibold">
                      + Thêm dòng
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
                                  standard: x.standard || (match.standard ?? ''),
                                };
                              });
                            });
                          }}
                          className="sm:col-span-5 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100"
                          placeholder="Tên sản phẩm"
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
                          placeholder="Số lượng"
                        />
                        <input
                          list="unit-options"
                          value={it.unit}
                          onChange={(e) => setManualItems((p) => p.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))}
                          className="sm:col-span-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 font-mono"
                          placeholder="Đơn vị"
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
                          placeholder="Đơn giá"
                        />
                        <div className="flex gap-2 sm:col-span-3">
                          <input
                            value={it.amount_excl_gst}
                            readOnly
                            className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-200 font-mono"
                            placeholder="Thành tiền"
                          />
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
                    Huỷ
                  </button>
                  <button
                    disabled={manualSaving}
                    onClick={submitManualInvoice}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-60">
                    {manualSaving ? 'Đang lưu...' : 'Lưu'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Upload Modal ───────────────────────────────────────────────────── */}
        {uploadStep !== 'idle' && (
          <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-700 shadow-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
                <h2 className="font-bold text-white text-lg">
                  {uploadStep === 'preview' ? '📸 Kiểm tra ảnh hóa đơn' :
                   uploadStep === 'processing' ? '🔄 Đang xử lý...' :
                   uploadStep === 'done' ? '✅ Hoàn tất!' : '❌ Lỗi'}
                </h2>
                {(uploadStep === 'preview' || uploadStep === 'error') && (
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
                      <p className="font-medium text-white mb-1">🔍 Ảnh đã được tối ưu.</p>
                      <p>Bạn có nhìn rõ tên nhà cung cấp và các con số không?</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={resetUpload}
                        className="py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold text-sm transition-all">
                        📷 Mờ quá, chụp lại
                      </button>
                      <button
                        onClick={handleConfirmAndProcess}
                        className="py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all shadow-lg shadow-emerald-900/50 active:scale-95">
                        ✅ Rõ, tiến hành OCR
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
                      <p className="text-slate-400 text-sm mt-1">Đừng đóng trang này...</p>
                    </div>
                  </div>
                )}

                {uploadStep === 'done' && (
                  <div className="flex flex-col items-center py-8 gap-3">
                    <div className="w-16 h-16 rounded-full bg-emerald-600 flex items-center justify-center text-3xl">
                      ✅
                    </div>
                    <p className="text-white font-bold text-lg">Xử lý thành công!</p>
                    <p className="text-slate-400 text-sm">Hóa đơn đã được lưu vào database.</p>
                  </div>
                )}

                {uploadStep === 'error' && (
                  <div className="space-y-4">
                    <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-sm text-red-300">
                      <p className="font-semibold text-red-400 mb-1">❌ Lỗi xử lý</p>
                      <p>{uploadError}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={resetUpload} className="py-3 rounded-xl bg-slate-700 text-slate-200 font-semibold text-sm">
                        Huỷ
                      </button>
                      <button onClick={handleConfirmAndProcess} className="py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm">
                        Thử lại
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
                <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-white text-lg">{selectedInvoice.vendor_name}</h2>
                    <p className="text-slate-400 text-sm">#{selectedInvoice.invoice_number} · {selectedInvoice.invoice_date}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {!editMode && (
                      <button
                        onClick={openCreditNote}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-sm font-semibold transition-all">
                        🧾 Credit
                      </button>
                    )}
                    {!editMode ? (
                      <button
                        onClick={startEdit}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-sm font-semibold transition-all">
                        ✏️ Sửa
                      </button>
                    ) : (
                      <>
                        <button
                          disabled={editSaving}
                          onClick={cancelEdit}
                          className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-all disabled:opacity-60">
                          Huỷ
                        </button>
                        <button
                          disabled={editSaving}
                          onClick={saveEdit}
                          className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-all disabled:opacity-60">
                          {editSaving ? 'Đang lưu...' : 'Lưu'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => deleteInvoice(selectedInvoice.id)}
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-red-600 text-slate-200 hover:text-white text-sm font-semibold transition-all">
                      🗑️ Xoá
                    </button>
                    {selectedInvoice.status === 'pending_review' && (
                      <>
                        <button
                          onClick={() => updateStatus(selectedInvoice.id, 'rejected')}
                          disabled={editMode}
                          className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-all">
                          ❌ Từ chối
                        </button>
                        <button
                          onClick={() => updateStatus(selectedInvoice.id, 'approved')}
                          disabled={editMode}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all">
                          ✅ Duyệt
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => { setSelectedInvoice(null); setImageZoom(1); setImageRotation(0); setEditMode(false); }}
                      className="text-slate-400 hover:text-white transition-colors p-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Side-by-side */}
                <div className="grid grid-cols-1 lg:grid-cols-2">
                  {/* LEFT: Image viewer */}
                  <div className="border-r border-slate-800 bg-slate-950">
                    <div className="p-3 border-b border-slate-800 flex items-center gap-2 bg-slate-900">
                      <span className="text-xs text-slate-400 font-medium flex-1">Ảnh gốc hóa đơn</span>
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
                          <p className="text-sm">Không có ảnh</p>
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
                          Thông tin hóa đơn
                        </h3>
                        {!editMode ? (
                          <div className="space-y-2 text-sm">
                            {[
                              ['Nhà cung cấp', selectedInvoice.vendor_name],
                              ['GST Number', selectedInvoice.vendor_gst_number ?? '—'],
                              ['Số hóa đơn', selectedInvoice.invoice_number ?? '—'],
                              ['Ngày', selectedInvoice.invoice_date],
                              ['Loại', selectedInvoice.is_tax_invoice ? 'Tax Invoice ✅' : 'Quote / Order'],
                              ['Danh mục', selectedInvoice.category ?? '—'],
                            ].map(([label, value]) => (
                              <div key={label} className="flex justify-between border-b border-slate-800 pb-2">
                                <span className="text-slate-400">{label}</span>
                                <span className="text-white font-medium text-right max-w-[60%]">{value}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                            <label>
                              <div className="text-slate-400 mb-1">Nhà cung cấp *</div>
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
                              <div className="text-slate-400 mb-1">Số hóa đơn</div>
                              <input
                                value={editForm.invoice_number}
                                onChange={(e) => setEditForm((p) => ({ ...p, invoice_number: e.target.value }))}
                                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                              />
                            </label>
                            <label>
                              <div className="text-slate-400 mb-1">Ngày *</div>
                              <input
                                type="date"
                                value={editForm.invoice_date}
                                onChange={(e) => setEditForm((p) => ({ ...p, invoice_date: e.target.value }))}
                                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                              />
                            </label>
                            <label className="sm:col-span-2">
                              <div className="text-slate-400 mb-1">Danh mục</div>
                              <input
                                value={editForm.category}
                                onChange={(e) => setEditForm((p) => ({ ...p, category: e.target.value }))}
                                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                              />
                            </label>
                          </div>
                        )}
                      </section>

                      {/* Line items */}
                      <section>
                        <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                          Mặt hàng ({selectedInvoice.invoice_items?.length ?? 0})
                        </h3>
                        {!editMode ? (
                          <div className="space-y-2">
                            {selectedInvoice.invoice_items?.map((item, idx) => (
                              <div key={item.id ?? idx} className="bg-slate-800 rounded-xl p-3 text-sm">
                                <div className="flex justify-between gap-2 mb-1">
                                  <span className="text-white font-medium leading-tight flex-1">{item.description}</span>
                                  <span className="text-emerald-400 font-mono font-bold whitespace-nowrap">
                                    {formatNZD(item.amount_excl_gst)}
                                  </span>
                                </div>
                                <div className="flex gap-4 text-xs text-slate-400">
                                  {item.product_code && <span className="font-mono">{item.product_code}</span>}
                                  {item.standard && <span className="font-mono">{item.standard}</span>}
                                  <span>SL: <span className="text-slate-200">{item.quantity} {item.unit}</span></span>
                                  <span>Đơn giá: <span className="text-slate-200">{formatNZD(item.price)}</span></span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="bg-slate-800 rounded-xl p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-semibold text-slate-200">Chỉnh mặt hàng</div>
                              <button
                                onClick={() => setEditItems((p) => [...p, { product_code: '', description: '', quantity: '', standard: '', unit: '', price: '', amount_excl_gst: '' }])}
                                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-semibold">
                                + Thêm dòng
                              </button>
                            </div>
                            <div className="space-y-2">
                              {editItems.map((it, idx) => (
                                <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                                  <input
                                    value={it.product_code}
                                    onChange={(e) => setEditItems((p) => p.map((x, i) => i === idx ? { ...x, product_code: e.target.value } : x))}
                                    className="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 font-mono"
                                    placeholder="Code"
                                  />
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
                                    className="sm:col-span-4 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100"
                                    placeholder="Mô tả"
                                  />
                                  <input
                                    list="standard-options"
                                    value={it.standard}
                                    onChange={(e) => setEditItems((p) => p.map((x, i) => i === idx ? { ...x, standard: e.target.value } : x))}
                                    className="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 font-mono"
                                    placeholder="Standard"
                                  />
                                  <input
                                    value={it.quantity}
                                    onChange={(e) => {
                                      const quantity = e.target.value;
                                      setEditItems((p) => p.map((x, i) => {
                                        if (i !== idx) return x;
                                        const next: typeof x = { ...x, quantity };
                                        const q = toNumberOrNullInput(quantity) ?? 0;
                                        const pr = toNumberOrNullInput(next.price) ?? 0;
                                        next.amount_excl_gst = fmt2(q * pr);
                                        return next;
                                      }));
                                    }}
                                    className="sm:col-span-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 font-mono"
                                    placeholder="Qty"
                                  />
                                  <input
                                    list="unit-options"
                                    value={it.unit}
                                    onChange={(e) => setEditItems((p) => p.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))}
                                    className="sm:col-span-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 font-mono"
                                    placeholder="Unit"
                                  />
                                  <input
                                    value={it.price}
                                    onChange={(e) => {
                                      const price = e.target.value;
                                      setEditItems((p) => p.map((x, i) => {
                                        if (i !== idx) return x;
                                        const next: typeof x = { ...x, price };
                                        const q = toNumberOrNullInput(next.quantity) ?? 0;
                                        const pr = toNumberOrNullInput(price) ?? 0;
                                        next.amount_excl_gst = fmt2(q * pr);
                                        return next;
                                      }));
                                    }}
                                    className="sm:col-span-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 font-mono"
                                    placeholder="Price"
                                  />
                                  <div className="flex gap-2 sm:col-span-2">
                                    <input
                                      value={it.amount_excl_gst}
                                      readOnly
                                      className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-200 font-mono"
                                      placeholder="Thành tiền"
                                    />
                                    <button
                                      onClick={() => setEditItems((p) => p.filter((_, i) => i !== idx))}
                                      className="px-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:bg-red-600 hover:text-white">
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </section>

                      {/* Totals */}
                      <section className="bg-slate-800 rounded-xl p-4 space-y-2 text-sm">
                        <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                          Tổng kết
                        </h3>
                        {!editMode ? (
                          <>
                            {[
                              ['Subtotal', formatNZD(selectedInvoice.sub_total)],
                              ['Freight', formatNZD(selectedInvoice.freight ?? 0)],
                              ['GST (15%)', formatNZD(selectedInvoice.gst_amount)],
                            ].map(([label, value]) => (
                              <div key={label} className="flex justify-between text-slate-300">
                                <span>{label}</span>
                                <span className="font-mono">{value}</span>
                              </div>
                            ))}
                            <div className="flex justify-between text-white font-bold text-base border-t border-slate-700 pt-2 mt-2">
                              <span>TOTAL (NZD)</span>
                              <span className={`font-mono ${isSelectedCreditNote ? 'text-red-400' : 'text-emerald-400'}`}>
                                {formatNZD(selectedInvoice.total_amount)}
                              </span>
                            </div>
                          </>
                        ) : (
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
                        )}
                      </section>

                      {/* Status action (mobile) */}
                      {selectedInvoice.status === 'pending_review' && (
                        <div className="grid grid-cols-2 gap-3 lg:hidden">
                          <button
                            onClick={() => updateStatus(selectedInvoice.id, 'rejected')}
                            className="py-3 rounded-xl bg-red-600 text-white font-bold">❌ Từ chối</button>
                          <button
                            onClick={() => updateStatus(selectedInvoice.id, 'approved')}
                            className="py-3 rounded-xl bg-emerald-600 text-white font-bold">✅ Duyệt</button>
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
            { label: 'Tổng chi tiêu', value: formatNZD(totalSpend), icon: '💰', color: 'from-emerald-500 to-teal-600' },
            { label: 'Tổng GST', value: formatNZD(totalGST), icon: '🧾', color: 'from-blue-500 to-indigo-600' },
            { label: 'Số hóa đơn', value: totalCount.toString(), icon: '📋', color: 'from-violet-500 to-purple-600' },
            { label: 'Chờ duyệt', value: pendingCount.toString(), icon: '⏳', color: 'from-amber-500 to-orange-600' },
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

        {/* ── Filters ────────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Tìm kiếm Vendor, Mã hóa đơn..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'pending_review', 'approved', 'rejected'] as FilterStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border
                  ${filterStatus === s
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                {s === 'all' ? 'Tất cả' : statusConfig[s]?.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Invoice table / cards ──────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-500">
            <div className="w-5 h-5 border-2 border-slate-600 border-t-emerald-500 rounded-full animate-spin" />
            <span className="text-sm">Đang tải...</span>
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-600">
            <div className="w-20 h-20 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-4xl">
              📭
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-400">Chưa có hóa đơn nào</p>
              <p className="text-sm mt-1">Bấm &quot;Thêm hóa đơn&quot; để chụp và xử lý hóa đơn đầu tiên</p>
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
                      {['Ngày', 'Nhà cung cấp', 'Mã hóa đơn', 'Danh mục', 'GST', 'Tổng tiền', 'Trạng thái', ''].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice, idx) => {
                      const sc = statusConfig[invoice.status];
                      const isCredit =
                        (invoice.type ?? '').toLowerCase().includes('credit') ||
                        (invoice.total_amount ?? 0) < 0 ||
                        !!invoice.parent_invoice_id;
                      return (
                        <tr
                          key={invoice.id}
                          className={`border-b border-slate-800/50 hover:bg-slate-800/50 cursor-pointer transition-colors group
                            ${idx % 2 === 0 ? '' : 'bg-slate-900/50'}`}
                          onClick={() => setSelectedInvoice(invoice)}>
                          <td className="px-4 py-4 text-slate-300 font-mono text-xs">{invoice.invoice_date}</td>
                          <td className="px-4 py-4">
                            <div className="font-semibold text-white">{invoice.vendor_name}</div>
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
                            <span className="text-slate-600 group-hover:text-slate-300 transition-colors text-xs">Xem →</span>
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
                const isCredit =
                  (invoice.type ?? '').toLowerCase().includes('credit') ||
                  (invoice.total_amount ?? 0) < 0 ||
                  !!invoice.parent_invoice_id;
                return (
                  <button
                    key={invoice.id}
                    onClick={() => setSelectedInvoice(invoice)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-left hover:border-slate-700 transition-all active:scale-99">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-bold text-white">{invoice.vendor_name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{invoice.invoice_date} · #{invoice.invoice_number ?? '—'}</p>
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
        )}
      </main>
    </div>
  );
}
