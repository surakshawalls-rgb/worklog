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

  async getCurrentBalance(): Promise<number> {
    const dashboard = await this.getDashboard();
    return dashboard.firm_balance;
  }

  async getTransactions(
    limit = 100,
    offset = 0
  ): Promise<FirmFinanceTransaction[]> {

    const { data, error } =
      await this.supabase.client
        .from('firm_finance_transaction_history')
        .select('*')
        .order('transaction_date', {
          ascending: false
        })
        .order('created_at', {
          ascending: false
        })
        .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    return (data ?? []).map(row => ({
      ...row,
      amount: Number(row.amount ?? 0),
      partner_id: row.partner_id
        ? Number(row.partner_id)
        : null,
      employee_id: row.employee_id
        ? Number(row.employee_id)
        : null
    })) as FirmFinanceTransaction[];
  }

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
