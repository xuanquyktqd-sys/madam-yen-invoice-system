'use client';
import InvoiceManager from './InvoiceManager';

export default function PurchasesTab() {
  return (
    <div className="bg-slate-950/50 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl animate-in zoom-in-95 duration-500">
      <InvoiceManager />
    </div>
  );
}
