import {
  Component,
  OnInit,
  ChangeDetectorRef,
  inject
} from '@angular/core';

import {
  CommonModule
} from '@angular/common';

import {
  FormsModule
} from '@angular/forms';

import {
  PartnerFinanceService,
  PartnerFinanceMonthlyLedger,
  PartnerFinanceTransaction
} from '../../services/partner-finance.service';

import {
  PartnerFundingService,
  FinancePartner
} from '../../services/partner-funding.service';

@Component({
  selector: 'app-partner-finance',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule
  ],
  templateUrl: './partner-finance.component.html',
  styleUrl: './partner-finance.component.scss'
})
export class PartnerFinanceComponent
  implements OnInit {

  private readonly finance =
    inject(PartnerFinanceService);

  private readonly funding =
    inject(PartnerFundingService);

  private readonly cdr =
    inject(ChangeDetectorRef);

  months: string[] = [];
  selectedMonth = '';

  ledger:
    PartnerFinanceMonthlyLedger[] = [];

  partners:
    FinancePartner[] = [];

  selectedPartnerId = 0;

  transactions:
    PartnerFinanceTransaction[] = [];

  loading = true;
  transactionsLoading = false;

  errorMessage = '';
  successMessage = '';

  repaymentOpen = false;
  expenseOpen = false;

  saving = false;

  amount: number | null = null;
  transactionDate =
    this.getToday();

  paymentMode = 'bank_transfer';
  description = '';

  expenseCategory = '';
  expensePartnerId = 0;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {

    this.loading = true;
    this.errorMessage = '';

    try {

      this.partners =
        await this.funding.getActivePartners();

      this.months =
        await this.finance.getAvailableMonths();

      if (
        !this.selectedMonth &&
        this.months.length
      ) {
        this.selectedMonth =
          this.months[0];
      }

      await this.loadLedger();

      if (
        this.selectedPartnerId === 0 &&
        this.partners.length
      ) {
        this.selectedPartnerId =
          this.partners[0].id;
      }

      await this.loadTransactions();

    } catch (error) {

      console.error(
        '[PartnerFinance] load error',
        error
      );

      this.errorMessage =
        'Unable to load partner finance.';

    } finally {

      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  async loadLedger(): Promise<void> {

    if (!this.selectedMonth) {
      this.ledger = [];
      return;
    }

    this.ledger =
      await this.finance
        .getPartnerMonthlyLedger(
          this.selectedMonth
        );
  }

  async loadTransactions(): Promise<void> {

    if (!this.selectedPartnerId) {
      this.transactions = [];
      return;
    }

    this.transactionsLoading = true;

    try {

      this.transactions =
        await this.finance
          .getPartnerTransactions(
            String(
              this.selectedPartnerId
            )
          );

    } catch (error) {

      console.error(
        '[PartnerFinance] transactions error',
        error
      );

      this.transactions = [];

    } finally {

      this.transactionsLoading = false;
      this.cdr.detectChanges();
    }
  }

  async onMonthChange(
    event: Event
  ): Promise<void> {

    this.selectedMonth =
      (event.target as HTMLSelectElement)
        .value;

    try {
      await this.loadLedger();
    } catch (error) {
      console.error(error);
      this.errorMessage =
        'Unable to load selected month.';
    }
  }

  async onPartnerChange(): Promise<void> {
    await this.loadTransactions();
  }

  openRepayment(): void {

    this.amount = null;
    this.transactionDate =
      this.getToday();

    this.paymentMode =
      'bank_transfer';

    this.description = '';

    this.errorMessage = '';
    this.successMessage = '';

    this.repaymentOpen = true;
  }

  openPartnerExpense(): void {

    this.amount = null;
    this.transactionDate =
      this.getToday();

    this.paymentMode = 'cash';

    this.description = '';
    this.expenseCategory = '';

    this.expensePartnerId =
      this.selectedPartnerId;

    this.errorMessage = '';
    this.successMessage = '';

    this.expenseOpen = true;
  }

  closeDialogs(): void {

    if (this.saving) {
      return;
    }

    this.repaymentOpen = false;
    this.expenseOpen = false;
    this.errorMessage = '';
  }

  async saveRepayment(): Promise<void> {

    this.errorMessage = '';
    this.successMessage = '';

    const value =
      Number(this.amount);

    if (!this.selectedPartnerId) {
      this.errorMessage =
        'Select a partner.';
      return;
    }

    if (
      !Number.isFinite(value) ||
      value <= 0
    ) {
      this.errorMessage =
        'Enter a valid repayment amount.';
      return;
    }

    this.saving = true;

    try {

      await this.finance.repayPartner({
        partnerId:
          this.selectedPartnerId,

        amount:
          value,

        transactionDate:
          this.transactionDate,

        paymentMode:
          this.paymentMode,

        description:
          this.description
      });

      this.repaymentOpen = false;

      this.successMessage =
        'Partner repayment recorded.';

      await this.load();

    } catch (error: any) {

      console.error(error);

      this.errorMessage =
        error?.message ||
        'Unable to record repayment.';

    } finally {

      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  async savePartnerExpense(): Promise<void> {

    this.errorMessage = '';
    this.successMessage = '';

    const value =
      Number(this.amount);

    if (!this.expensePartnerId) {
      this.errorMessage =
        'Select the partner.';
      return;
    }

    if (!this.expenseCategory.trim()) {
      this.errorMessage =
        'Enter the expense category.';
      return;
    }

    if (
      !Number.isFinite(value) ||
      value <= 0
    ) {
      this.errorMessage =
        'Enter a valid expense amount.';
      return;
    }

    this.saving = true;

    try {

      await this.finance
        .recordPartnerPaidFirmExpense({
          partnerId:
            this.expensePartnerId,

          category:
            this.expenseCategory,

          amount:
            value,

          transactionDate:
            this.transactionDate,

          paymentMode:
            this.paymentMode,

          description:
            this.description
        });

      this.expenseOpen = false;

      this.successMessage =
        'Partner-paid firm expense recorded.';

      await this.load();

    } catch (error: any) {

      console.error(error);

      this.errorMessage =
        error?.message ||
        'Unable to record partner-paid expense.';

    } finally {

      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  selectedPartner():
    FinancePartner | undefined {

    return this.partners.find(
      item =>
        item.id ===
        this.selectedPartnerId
    );
  }

  selectedLedger():
    PartnerFinanceMonthlyLedger |
    undefined {

    return this.ledger.find(
      item =>
        Number(item.partner_id) ===
        Number(this.selectedPartnerId)
    );
  }

  formatCurrency(
    value: number
  ): string {

    return `\u20B9${Number(value || 0).toLocaleString(
      'en-IN',
      {
        maximumFractionDigits: 2
      }
    )}`;
  }

  formatMonth(
    value: string
  ): string {

    if (!value) {
      return '';
    }

    const date =
      new Date(
        `${value}-01T00:00:00`
      );

    return date.toLocaleDateString(
      'en-IN',
      {
        month: 'long',
        year: 'numeric'
      }
    );
  }

  formatDate(
    value: string
  ): string {

    return new Date(value)
      .toLocaleDateString(
        'en-IN',
        {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }
      );
  }

  transactionLabel(
    transaction:
      PartnerFinanceTransaction
  ): string {

    switch (
      transaction.transaction_type
    ) {
      case 'loan_received':
        return 'Loan Received';

      case 'expense_paid_by_partner':
        return 'Firm Expense Paid';

      case 'repayment':
        return 'Repayment';

      case 'adjustment':
        return 'Adjustment';

      default:
        return transaction.transaction_type;
    }
  }

  private getToday(): string {

    const now = new Date();
    const offset =
      now.getTimezoneOffset();

    return new Date(
      now.getTime() -
      offset * 60000
    )
      .toISOString()
      .slice(0, 10);
  }
}
