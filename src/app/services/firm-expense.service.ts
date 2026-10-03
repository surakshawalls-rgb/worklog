import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface FirmFinanceCategory {
  id: number;
  category_name: string;
  category_type: string;
  active: boolean;
  display_order: number;
}

export interface FirmMoneyOutResult {
  firm_transaction_id: string;
  firm_balance: number;
}

@Injectable({
  providedIn: 'root'
})
export class FirmExpenseService {
  private readonly supabase = inject(SupabaseService);

  async getCategories(): Promise<FirmFinanceCategory[]> {
    const { data, error } = await this.supabase.client
      .from('firm_finance_categories')
      .select(`
        id,
        category_name,
        category_type,
        active,
        display_order
      `)
      .eq('active', true)
      .eq('category_type', 'expense')
      .order('display_order', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as FirmFinanceCategory[];
  }

  async recordMoneyOut(params: {
    category: string;
    amount: number;
    transactionDate: string;
    paymentMode: string;
    description?: string;
  }): Promise<FirmMoneyOutResult> {
    const { data, error } = await this.supabase.client.rpc(
      'record_firm_money_out',
      {
        p_category: params.category,
        p_amount: params.amount,
        p_transaction_date: params.transactionDate,
        p_payment_mode: params.paymentMode || null,
        p_description: params.description || null,
        p_created_by: null
      }
    );

    if (error) {
      throw error;
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result) {
      throw new Error('No response received from firm finance transaction.');
    }

    return {
      firm_transaction_id: result.firm_transaction_id,
      firm_balance: Number(result.firm_balance ?? 0)
    };
  }
}
