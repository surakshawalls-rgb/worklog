
import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface FirmFinanceTransaction {
  id: string;
  transaction_date: string;
  transaction_type: string;
  category: string;
  amount: number;
  partner_id?: number | null;
  employee_id?: number | null;
  reference_id?: string | null;
  payment_mode?: string | null;
  description?: string | null;
  created_at: string;
  created_by?: number | null;
  partner_name?: string | null;
  employee_name?: string | null;
  created_by_name?: string | null;
}

export interface FirmFinanceDashboard {
  firm_balance: number;
  total_money_in: number;
  total_money_out: number;
  net_movement: number;
  transaction_count: number;
}

@Injectable({
  providedIn: 'root'
})
export class FirmFinanceService {

  private readonly supabase = inject(SupabaseService);

  /**
   * Retrieves the centralized firm finance dashboard.
   */
  async getDashboard(): Promise<FirmFinanceDashboard> {
    const { data, error } =
      await this.supabase.client.rpc(
        'get_firm_finance_dashboard'
      );

    if (error) {
      throw error;
    }

    const row = Array.isArray(data)
      ? data[0]
      : data;

    return {
      firm_balance: Number(row?.firm_balance ?? 0),
      total_money_in: Number(row?.total_money_in ?? 0),
      total_money_out: Number(row?.total_money_out ?? 0),
      net_movement: Number(row?.net_movement ?? 0),
      transaction_count: Number(row?.transaction_count ?? 0)
    };
  }

  /**
   * Retrieves the current firm balance.
   */
  async getCurrentBalance(): Promise<number> {
    const dashboard = await this.getDashboard();
    return dashboard.firm_balance;
  }

  /**
   * Retrieves centralized finance transactions.
   *
   * Primary sorting:
   *   created_at DESC       - latest recorded transaction first
   *
   * Secondary sorting:
   *   transaction_date DESC - latest payment date first
   *
   * Final sorting:
   *   id DESC               - deterministic tie-breaker
   *
   * Payment date and recording timestamp remain separate.
   */
  async getTransactions(
    limit = 100,
    offset = 0
  ): Promise<FirmFinanceTransaction[]> {

    const safeLimit = Math.max(
      1,
      Math.floor(limit)
    );

    const safeOffset = Math.max(
      0,
      Math.floor(offset)
    );

    const { data, error } =
      await this.supabase.client
        .from('firm_finance_transaction_history')
        .select('*')
        .order('created_at', {
          ascending: false,
          nullsFirst: false
        })
        .order('transaction_date', {
          ascending: false,
          nullsFirst: false
        })
        .order('id', {
          ascending: false
        })
        .range(
          safeOffset,
          safeOffset + safeLimit - 1
        );

    if (error) {
      throw error;
    }

    return (data ?? []).map(row => ({
      ...row,
      amount: Number(row.amount ?? 0),
      partner_id: row.partner_id != null
        ? Number(row.partner_id)
        : null,
      employee_id: row.employee_id != null
        ? Number(row.employee_id)
        : null
    })) as FirmFinanceTransaction[];
  }

  /**
   * Records money received by the firm.
   * transactionDate is the actual payment date.
   * The database should generate created_at automatically.
   */
  async recordFirmIncome(params: {
    category: string;
    amount: number;
    transactionDate: string;
    paymentMode?: string | null;
    description?: string | null;
  }): Promise<void> {

    const { error } =
      await this.supabase.client.rpc(
        'record_firm_money_in',
        {
          p_category: params.category,
          p_amount: params.amount,
          p_transaction_date: params.transactionDate,
          p_payment_mode:
            params.paymentMode || null,
          p_description:
            params.description || null,
          p_created_by: null
        }
      );

    if (error) {
      throw error;
    }
  }
}
