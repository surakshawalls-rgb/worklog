import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export type PartnerFinanceTransactionType =
  | 'loan_received'
  | 'expense_paid_by_partner'
  | 'repayment'
  | 'adjustment';

export interface PartnerFinanceTransaction {
  id: string;
  partner_id: string;
  transaction_date: string;
  transaction_month?: string | null;
  transaction_type: PartnerFinanceTransactionType;
  amount: number;
  description?: string | null;
  reference_id?: string | null;
  payment_mode?: string | null;
  created_at: string;
  created_by?: string | null;
}

export interface PartnerFinanceMonthlyLedger {
  partner_id: string;
  partner_name: string;
  share_percentage: number;
  role: string;
  transaction_month: string | null;
  loan_received: number;
  partner_expense: number;
  repayment: number;
  adjustment: number;
  net_change: number;
  opening_balance: number;
  closing_balance: number;
}

@Injectable({
  providedIn: 'root'
})
export class PartnerFinanceService {

  private readonly supabase = inject(SupabaseService);

  async getPartnerMonthlyLedger(
    month?: string
  ): Promise<PartnerFinanceMonthlyLedger[]> {

    let query = this.supabase.client
      .from('partner_finance_monthly_ledger')
      .select('*')
      .order('partner_name', {
        ascending: true
      });

    if (month) {
      query = query.eq(
        'transaction_month',
        month
      );
    }

    const { data, error } =
      await query;

    if (error) {
      throw error;
    }

    return (data ?? []).map(row => ({
      partner_id: String(row.partner_id),
      partner_name: row.partner_name ?? '',
      share_percentage:
        Number(row.share_percentage ?? 0),
      role: row.role ?? '',
      transaction_month:
        row.transaction_month,

      loan_received:
        Number(row.loan_received ?? 0),

      partner_expense:
        Number(row.partner_expense ?? 0),

      repayment:
        Number(row.repayment ?? 0),

      adjustment:
        Number(row.adjustment ?? 0),

      net_change:
        Number(row.net_change ?? 0),

      opening_balance:
        Number(row.opening_balance ?? 0),

      closing_balance:
        Number(row.closing_balance ?? 0)
    }));
  }

  async getAvailableMonths(): Promise<string[]> {

    const { data, error } =
      await this.supabase.client
        .from('partner_finance_monthly_ledger')
        .select('transaction_month')
        .not(
          'transaction_month',
          'is',
          null
        );

    if (error) {
      throw error;
    }

    return [
      ...new Set(
        (data ?? [])
          .map(row => row.transaction_month)
          .filter(
            (month): month is string =>
              typeof month === 'string' &&
              month.length > 0
          )
      )
    ].sort((a, b) =>
      b.localeCompare(a)
    );
  }

  async getPartnerTransactions(
    partnerId: string
  ): Promise<PartnerFinanceTransaction[]> {

    const { data, error } =
      await this.supabase.client
        .from('partner_finance_transactions')
        .select('*')
        .eq(
          'partner_id',
          partnerId
        )
        .order(
          'transaction_date',
          {
            ascending: false
          }
        )
        .order(
          'created_at',
          {
            ascending: false
          }
        );

    if (error) {
      throw error;
    }

    return (data ?? []).map(row => ({
      ...row,
      amount: Number(row.amount ?? 0)
    })) as PartnerFinanceTransaction[];
  }

  async repayPartner(params: {
    partnerId: number;
    amount: number;
    transactionDate: string;
    paymentMode: string;
    description?: string;
  }): Promise<{
    firmBalance: number;
    partnerOutstanding: number;
  }> {

    const { data, error } =
      await this.supabase.client.rpc(
        'repay_partner_from_firm',
        {
          p_partner_id:
            params.partnerId,

          p_amount:
            params.amount,

          p_transaction_date:
            params.transactionDate,

          p_payment_mode:
            params.paymentMode,

          p_description:
            params.description || null,

          p_created_by:
            null
        }
      );

    if (error) {
      throw error;
    }

    const row =
      Array.isArray(data)
        ? data[0]
        : data;

    return {
      firmBalance:
        Number(row?.firm_balance ?? 0),

      partnerOutstanding:
        Number(
          row?.partner_outstanding ?? 0
        )
    };
  }

  async recordPartnerPaidFirmExpense(params: {
    partnerId: number;
    category: string;
    amount: number;
    transactionDate: string;
    paymentMode: string;
    description?: string;
  }): Promise<number> {

    const { data, error } =
      await this.supabase.client.rpc(
        'record_partner_paid_firm_expense',
        {
          p_partner_id:
            params.partnerId,

          p_category:
            params.category,

          p_amount:
            params.amount,

          p_transaction_date:
            params.transactionDate,

          p_payment_mode:
            params.paymentMode,

          p_description:
            params.description || null,

          p_created_by:
            null
        }
      );

    if (error) {
      throw error;
    }

    const row =
      Array.isArray(data)
        ? data[0]
        : data;

    return Number(
      row?.partner_outstanding ?? 0
    );
  }
}
