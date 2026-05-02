export type FinanceTab = 'overview' | 'revenue' | 'utility' | 'labour' | 'other';
export type DatePreset = 'week' | 'month' | 'last_month' | 'custom' | 'all';

export type DailySale = {
  id: string; sale_date: string; total_revenue: number; order_count: number;
  source: string; notes: string | null;
};
export type UtilityBill = {
  id: string; category: string; supplier: string | null; bill_number: string | null;
  period_start: string | null; period_end: string | null; total_amount: number;
  amount_excl_gst: number | null; gst_amount: number | null; notes: string | null;
};
export type LabourCost = {
  id: string; cost_type: string; description: string | null; amount: number;
  pay_date: string; period_start: string | null; period_end: string | null;
  employee_name: string | null; notes: string | null;
};
export type OtherExpense = {
  id: string; category: string; description: string | null; amount: number;
  expense_date: string; supplier: string | null; notes: string | null;
  period_start: string | null; period_end: string | null;
};
export type FinanceSummary = {
  total_revenue: number; total_expenses: number; net_profit: number; profit_margin: number;
  expense_breakdown: { purchase: number; utility: number; labour: number; other: number };
  daily_revenue: Array<{ date: string; revenue: number }>;
  daily_expenses: Array<{ date: string; amount: number }>;
};

export const formatNZD = (n: number) =>
  new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(n);

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const fmtDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

export const UTILITY_CATEGORIES = ['electricity','water','gas','internet','phone','other'] as const;
export const LABOUR_TYPES = ['cash','wage','salary'] as const;
export const OTHER_CATEGORIES = ['rent','marketing','insurance','equipment','misc'] as const;
