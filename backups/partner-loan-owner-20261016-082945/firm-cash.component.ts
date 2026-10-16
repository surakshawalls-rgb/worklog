import {
  Component,
  EventEmitter,
  Output,
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
  FirmFinanceService,
  FirmFinanceDashboard,
  FirmFinanceTransaction
} from '../../../services/firm-finance.service';

import {
  FirmExpenseService,
  FirmFinanceCategory
} from '../../../services/firm-expense.service';

import {
  PartnerFundingService,
  FinancePartner
} from '../../../services/partner-funding.service';

import {
  SupabaseService
} from '../../../services/supabase.service';

@Component({
  selector: 'app-firm-cash',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule
  ],
  templateUrl: './firm-cash.component.html',
  styleUrl: './firm-cash.component.scss'
})
export class FirmCashComponent implements OnInit {
  @Output() balanceChanged = new EventEmitter<number>();

  private readonly finance =
    inject(FirmFinanceService);

  private readonly supabase = inject(SupabaseService);
  private readonly expenses =
    inject(FirmExpenseService);

  private readonly funding =
    inject(PartnerFundingService);
  private readonly cdr =
    inject(ChangeDetectorRef);

  dashboard: FirmFinanceDashboard = {
    firm_balance: 0,
    total_money_in: 0,
    total_money_out: 0,
    net_movement: 0,
    transaction_count: 0
  };

  transactions:
    FirmFinanceTransaction[] = [];

  readonly pageSizeOptions = [10, 25, 50];
  pageSize = this.pageSizeOptions[0];
  currentPage = 1;

  partners:
    FinancePartner[] = [];

  incomeCategories:
    FirmFinanceCategory[] = [];

  expenseCategories:
    FirmFinanceCategory[] = [];

  loading = true;
  saving = false;
  errorMessage = '';
  successMessage = '';

  modal:
    'income' |
    'partner-loan' |
    'money-out' |
    null = null;

  amount: number | null = null;
  category = '';
  partnerId = 0;
  transactionDate =
    this.getToday();

  paymentMode = 'cash';
  description = '';

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {

    this.loading = true;
    this.errorMessage = '';

    try {

      const [
        dashboard,
        partners,
        incomeCategories,
        expenseCategories
      ] = await Promise.all([
        this.finance.getDashboard(),
        this.funding.getActivePartners(),
        this.loadIncomeCategories(),
        this.expenses.getCategories()
      ]);

      this.dashboard =
        dashboard;
      this.balanceChanged.emit(dashboard.firm_balance);

      this.currentPage = Math.min(
        this.currentPage,
        this.pageCount()
      );
      this.transactions = await this.finance.getTransactions(
        this.pageSize,
        (this.currentPage - 1) * this.pageSize
      );

      this.partners =
        partners;

      this.incomeCategories =
        incomeCategories;

      this.expenseCategories =
        expenseCategories;

      if (
        !this.category &&
        this.incomeCategories.length
      ) {
        this.category =
          this.incomeCategories[0]
            .category_name;
      }

    } catch (error) {

      console.error(
        '[FirmCash] load error',
        error
      );

      this.errorMessage =
        'Unable to load firm cash data.';

    } finally {

      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  private async loadIncomeCategories():
    Promise<FirmFinanceCategory[]> {

    const fallbackCategories: FirmFinanceCategory[] = [
      {
        id: -1,
        category_name: 'Sales / Client Payment',
        category_type: 'income',
        active: true,
        display_order: 10
      },
      {
        id: -2,
        category_name: 'Service Income',
        category_type: 'income',
        active: true,
        display_order: 20
      },
      {
        id: -3,
        category_name: 'Other Income',
        category_type: 'income',
        active: true,
        display_order: 30
      }
    ];

    try {

      const { data, error } =
        await this.supabase.client
          .from('firm_finance_categories')
          .select(
            'id, category_name, category_type, active, display_order'
          )
          .eq(
            'active',
            true
          )
          .eq(
            'category_type',
            'income'
          )
          .order(
            'display_order',
            {
              ascending: true
            }
          );

      if (error) {
        console.warn(
          '[FirmCash] Income categories could not be loaded. Using fallback categories.',
          error
        );

        return fallbackCategories;
      }

      const categories =
        (data ?? []) as FirmFinanceCategory[];

      if (categories.length === 0) {
        console.warn(
          '[FirmCash] No income categories found in database. Using fallback categories.'
        );

        return fallbackCategories;
      }

      return categories;

    } catch (error) {

      console.warn(
        '[FirmCash] Income category loading failed. Using fallback categories.',
        error
      );

      return fallbackCategories;
    }
  }

  openIncome(): void {
    this.resetForm();
    this.modal = 'income';

    if (this.incomeCategories.length) {
      this.category =
        this.incomeCategories[0]
          .category_name;
    }
  }

  openPartnerLoan(): void {
    this.resetForm();
    this.modal = 'partner-loan';
  }

  openMoneyOut(): void {
    this.resetForm();
    this.modal = 'money-out';

    if (this.expenseCategories.length) {
      this.category =
        this.expenseCategories[0]
          .category_name;
    }
  }

  closeModal(): void {

    if (this.saving) {
      return;
    }

    this.modal = null;
    this.errorMessage = '';
  }

  resetForm(): void {
    this.amount = null;
    this.category = '';
    this.partnerId = 0;
    this.transactionDate =
      this.getToday();
    this.paymentMode = 'cash';
    this.description = '';
    this.errorMessage = '';
    this.successMessage = '';
  }

  async save(): Promise<void> {

    this.errorMessage = '';
    this.successMessage = '';

    const amount =
      Number(this.amount);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      this.errorMessage =
        'Enter a valid amount greater than zero.';
      return;
    }

    if (!this.transactionDate) {
      this.errorMessage =
        'Select a transaction date.';
      return;
    }

    if (
      this.modal === 'partner-loan' &&
      !this.partnerId
    ) {
      this.errorMessage =
        'Select the partner who provided the loan.';
      return;
    }

    if (
      this.modal !== 'partner-loan' &&
      !this.category
    ) {
      this.errorMessage =
        'Select a category.';
      return;
    }

    this.saving = true;

    try {

      if (this.modal === 'partner-loan') {

        await this.funding.addPartnerFunding({
          partnerId:
            this.partnerId,

          amount,

          transactionDate:
            this.transactionDate,

          paymentMode:
            this.paymentMode,

          description:
            this.description
        });

      } else if (
        this.modal === 'income'
      ) {

        await this.finance.recordFirmIncome({
          category:
            this.category,

          amount,

          transactionDate:
            this.transactionDate,

          paymentMode:
            this.paymentMode,

          description:
            this.description
        });

      } else if (
        this.modal === 'money-out'
      ) {

        await this.expenses.recordMoneyOut({
          category:
            this.category,

          amount,

          transactionDate:
            this.transactionDate,

          paymentMode:
            this.paymentMode,

          description:
            this.description
        });
      }

      this.modal = null;

      this.successMessage =
        'Finance transaction recorded successfully.';

      await this.load();

    } catch (error: any) {

      console.error(
        '[FirmCash] save error',
        error
      );

      this.errorMessage =
        error?.message ||
        'Unable to save transaction.';

    } finally {

      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  refresh(): void {
    void this.load();
  }

  pageCount(): number {
    return Math.max(1, Math.ceil(this.dashboard.transaction_count / this.pageSize));
  }

  pageStart(): number {
    return this.dashboard.transaction_count === 0
      ? 0
      : (this.currentPage - 1) * this.pageSize + 1;
  }

  pageEnd(): number {
    return Math.min(
      this.currentPage * this.pageSize,
      this.dashboard.transaction_count
    );
  }

  changePage(page: number): void {
    if (this.loading || page < 1 || page > this.pageCount()) return;
    this.currentPage = page;
    void this.loadTransactions();
  }

  changePageSize(pageSize: number): void {
    if (!this.pageSizeOptions.includes(pageSize)) return;
    this.pageSize = pageSize;
    this.currentPage = 1;
    void this.loadTransactions();
  }

  private async loadTransactions(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    try {
      this.transactions = await this.finance.getTransactions(
        this.pageSize,
        (this.currentPage - 1) * this.pageSize
      );
    } catch (error) {
      console.error('[FirmCash] transaction page load error', error);
      this.errorMessage = 'Unable to load firm cash activity.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
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

  formatDate(
    value: string
  ): string {

    if (!value) {
      return '-';
    }

    return new Date(
      value
    ).toLocaleDateString(
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
      FirmFinanceTransaction
  ): string {

    if (
      transaction.transaction_type ===
      'money_in'
    ) {
      return 'Money In';
    }

    if (
      transaction.transaction_type ===
      'money_out'
    ) {
      return 'Money Out';
    }

    if (
      transaction.transaction_type ===
      'expense_on_credit'
    ) {
      return 'Partner Paid Expense';
    }

    return transaction.transaction_type;
  }

  private getToday(): string {

    const now =
      new Date();

    const offset =
      now.getTimezoneOffset();

    const local =
      new Date(
        now.getTime() -
        offset * 60000
      );

    return local
      .toISOString()
      .slice(0, 10);
  }
}


