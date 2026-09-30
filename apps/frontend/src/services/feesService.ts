import { axiosClient } from '../utils/axiosClient';

/**
 * SMS fees: structures, invoices, payments, statements and clearance.
 *
 * Amounts arrive as strings, because they come from NUMERIC columns and
 * turning them into JavaScript numbers on the way in is how a ledger loses a
 * cent. They stay strings until something formats them for display.
 *
 * The tenant is never sent. It is resolved server-side from the authenticated
 * identity, so nothing here takes a tenant id and nothing here could send one.
 */

export type InvoiceStatus = 'draft' | 'issued' | 'void';
export type Settlement = 'draft' | 'void' | 'unpaid' | 'part_paid' | 'paid' | 'overpaid';
export type PaymentMethod =
  | 'cash' | 'bank_transfer' | 'cheque' | 'card' | 'mobile_money' | 'scholarship' | 'other';

export const FEE_CATEGORIES = [
  'tuition', 'accommodation', 'examination', 'library', 'technology',
  'laboratory', 'registration', 'transport', 'insurance', 'other',
] as const;

export const PAYMENT_METHODS: PaymentMethod[] = [
  'cash', 'bank_transfer', 'cheque', 'card', 'mobile_money', 'scholarship', 'other',
];

export interface FeeStructure {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  academic_year_id?: string | null;
  academic_year_name?: string | null;
  programme_id?: string | null;
  programme_name?: string | null;
  study_year?: number | null;
  currency: string;
  is_active: boolean;
  item_count?: number;
  mandatory_total?: string;
}

export interface FeeItem {
  id: string;
  structure_id: string;
  code: string;
  name: string;
  category: string;
  amount: string;
  is_mandatory: boolean;
  sequence: number;
}

export interface Invoice {
  id: string;
  number: string;
  student_id: string;
  student_number?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  structure_id?: string | null;
  academic_year_id?: string | null;
  academic_year_name?: string | null;
  semester_id?: string | null;
  term_name?: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: string;
  discount_total: string;
  total: string;
  due_date?: string | null;
  note?: string | null;
  issued_at?: string | null;
  issued_by_name?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  created_at: string;
  // From invoice_balances — computed on read, never stored.
  amount_paid: string;
  balance: string;
  settlement: Settlement;
  is_overdue: boolean;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  fee_item_id?: string | null;
  line_type: 'charge' | 'discount';
  code: string;
  description: string;
  category: string;
  quantity: string;
  unit_amount: string;
  amount: string;
  sequence: number;
}

export interface Payment {
  id: string;
  invoice_id: string;
  invoice_number?: string;
  student_id: string;
  student_number?: string;
  first_name?: string;
  last_name?: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  reference?: string | null;
  paid_at: string;
  recorded_by_name?: string | null;
  note?: string | null;
  reversed_at?: string | null;
  reversed_by_name?: string | null;
  reversal_reason?: string | null;
}

export interface InvoiceDetail {
  invoice: Invoice;
  lines: InvoiceLine[];
  payments: Payment[];
}

export interface Clearance {
  studentId: string;
  cleared: boolean;
  currency: string | null;
  billed: string;
  paid: string;
  balance: string;
  overdueCount: number;
}

export interface Statement {
  student: { id: string; studentNumber: string; name: string };
  summary: Clearance;
  invoices: Invoice[];
  payments: Payment[];
}

export interface FeesOverview {
  totals: Array<{
    currency: string;
    invoice_count: number;
    billed: string;
    collected: string;
    outstanding: string;
    overdue_count: number;
    overdue_amount: string;
  }>;
  bySettlement: Record<string, number>;
  recentPayments: Payment[];
}

export interface Debtor {
  student_id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  email: string;
  currency: string;
  billed: string;
  paid: string;
  balance: string;
  overdue_count: number;
  is_cleared: boolean;
}

export interface LineInput {
  code: string;
  description: string;
  unitAmount: string | number;
  category?: string;
  quantity?: number;
  lineType?: 'charge' | 'discount';
}

/** Formats a NUMERIC string for display without going through a float. */
export function formatMoney(amount: string | number | null | undefined, currency?: string): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const text = String(amount);
  const negative = text.startsWith('-');
  const [whole, fraction = '00'] = text.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `${negative ? '-' : ''}${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
  return currency ? `${currency} ${body}` : body;
}

export const feesService = {
  async overview(): Promise<FeesOverview> {
    const { data } = await axiosClient.get('/fees/overview');
    return data;
  },

  async listStructures(): Promise<FeeStructure[]> {
    const { data } = await axiosClient.get('/fees/structures');
    return data.structures;
  },

  async getStructure(id: string): Promise<{ structure: FeeStructure; items: FeeItem[] }> {
    const { data } = await axiosClient.get(`/fees/structures/${id}`);
    return data;
  },

  async createStructure(input: {
    code: string;
    name: string;
    description?: string;
    academicYearId?: string;
    programmeId?: string;
    studyYear?: number;
    currency?: string;
  }): Promise<FeeStructure> {
    const { data } = await axiosClient.post('/fees/structures', input);
    return data.structure;
  },

  async updateStructure(id: string, input: Record<string, unknown>): Promise<FeeStructure> {
    const { data } = await axiosClient.patch(`/fees/structures/${id}`, input);
    return data.structure;
  },

  async deleteStructure(id: string): Promise<void> {
    await axiosClient.delete(`/fees/structures/${id}`);
  },

  async addItem(structureId: string, input: {
    code: string;
    name: string;
    amount: string | number;
    category?: string;
    isMandatory?: boolean;
    sequence?: number;
  }): Promise<FeeItem> {
    const { data } = await axiosClient.post(`/fees/structures/${structureId}/items`, input);
    return data.item;
  },

  async updateItem(structureId: string, itemId: string, input: Record<string, unknown>): Promise<FeeItem> {
    const { data } = await axiosClient.patch(`/fees/structures/${structureId}/items/${itemId}`, input);
    return data.item;
  },

  async removeItem(structureId: string, itemId: string): Promise<void> {
    await axiosClient.delete(`/fees/structures/${structureId}/items/${itemId}`);
  },

  async listInvoices(filters?: {
    studentId?: string;
    status?: InvoiceStatus;
    settlement?: Settlement;
    overdue?: boolean;
  }): Promise<Invoice[]> {
    const { data } = await axiosClient.get('/fees/invoices', {
      params: {
        ...filters,
        overdue: filters?.overdue ? 'true' : undefined,
      },
    });
    return data.invoices;
  },

  async getInvoice(id: string): Promise<InvoiceDetail> {
    const { data } = await axiosClient.get(`/fees/invoices/${id}`);
    return data;
  },

  async raiseInvoice(input: {
    studentId: string;
    structureId?: string;
    optionalItemIds?: string[];
    lines?: LineInput[];
    academicYearId?: string;
    semesterId?: string;
    currency?: string;
    dueDate?: string;
    note?: string;
    issue?: boolean;
  }): Promise<{ invoice: Invoice; lines: InvoiceLine[] }> {
    const { data } = await axiosClient.post('/fees/invoices', input);
    return data;
  },

  async issueInvoice(id: string): Promise<Invoice> {
    const { data } = await axiosClient.post(`/fees/invoices/${id}/issue`, {});
    return data.invoice;
  },

  async voidInvoice(id: string, reason: string): Promise<Invoice> {
    const { data } = await axiosClient.post(`/fees/invoices/${id}/void`, { reason });
    return data.invoice;
  },

  async updateInvoice(id: string, input: { dueDate?: string; note?: string }): Promise<Invoice> {
    const { data } = await axiosClient.patch(`/fees/invoices/${id}`, input);
    return data.invoice;
  },

  async recordPayment(invoiceId: string, input: {
    amount: string | number;
    method?: PaymentMethod;
    reference?: string;
    paidAt?: string;
    note?: string;
    /** Take money beyond the outstanding balance, creating a credit. */
    allowOverpayment?: boolean;
  }): Promise<{ payment: Payment; balance: string; settlement: Settlement }> {
    const { data } = await axiosClient.post(`/fees/invoices/${invoiceId}/payments`, input);
    return data;
  },

  async reversePayment(paymentId: string, reason: string): Promise<Payment> {
    const { data } = await axiosClient.post(`/fees/payments/${paymentId}/reverse`, { reason });
    return data.payment;
  },

  async listPayments(filters?: { studentId?: string; from?: string; to?: string }): Promise<Payment[]> {
    const { data } = await axiosClient.get('/fees/payments', { params: filters });
    return data.payments;
  },

  async statement(studentId?: string): Promise<Statement> {
    const { data } = await axiosClient.get('/fees/statement', {
      params: studentId ? { studentId } : undefined,
    });
    return data;
  },

  async clearance(studentId?: string): Promise<Clearance> {
    const { data } = await axiosClient.get('/fees/clearance', {
      params: studentId ? { studentId } : undefined,
    });
    return data.clearance;
  },

  async debtors(overdueOnly = false): Promise<Debtor[]> {
    const { data } = await axiosClient.get('/fees/debtors', {
      params: overdueOnly ? { overdue: 'true' } : undefined,
    });
    return data.debtors;
  },
};
