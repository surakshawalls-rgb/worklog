import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface FinancePartner {
  id: number;
  partner_name: string;
  share_percentage: number;
  role: string;
  active: boolean;
}

export interface PartnerFundingResult {
  firm_transaction_id: string;
  partner_transaction_id: number;
  firm_balance: number | string;
  partner_outstanding: number | string;
}

@Injectable({
  providedIn: 'root'
})
export class PartnerFundingService {

  private readonly supabase = inject(SupabaseService);

  async getActivePartners(): Promise<FinancePartner[]> {
    const { data, error } = await this.supabase.client
      .from('partner_master')
      .select('id, partner_name, share_percentage, role, active')
      .eq('active', true)
      .order('partner_name');

    if (error) {
      throw error;
    }

    return (data ?? []) as FinancePartner[];
  }

  async addPartnerFunding(params: {
    partnerId: number;
    amount: number;
    transactionDate: string;
    paymentMode: string;
    description: string;
  }): Promise<PartnerFundingResult> {

    const { data, error } = await this.supabase.client.rpc(
      'add_partner_funding_to_firm',
      {
        p_partner_id: params.partnerId,
        p_amount: params.amount,
        p_transaction_date: params.transactionDate,
        p_payment_mode: params.paymentMode,
        p_description: params.description || null,
        p_created_by: null
      }
    );

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      throw new Error('No result returned from funding transaction.');
    }

    return {
      ...data[0],
      firm_balance: Number(data[0].firm_balance),
      partner_outstanding: Number(data[0].partner_outstanding)
    };
  }
}
