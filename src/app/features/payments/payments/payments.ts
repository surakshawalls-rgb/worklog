import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AttendanceService,
  Employee,
  Payment
} from '../../../services/attendance.service';
import { FirmFinanceService } from '../../../services/firm-finance.service';

@Component({
  selector: 'app-payments',
  imports: [CommonModule, FormsModule],
  templateUrl: './payments.html',
  styleUrl: './payments.scss'
})
export class PaymentsComponent {
  private readonly attendance = inject(AttendanceService);
  private readonly firmFinance = inject(FirmFinanceService);

  @Input() employees: Employee[] = [];
  @Input() payments: Payment[] = [];
  @Input() allPayments: Payment[] = [];

  @Output() refreshRequested = new EventEmitter<void>();

  readonly selectedEmployee = signal<Employee | null>(null);

  readonly paymentAmount = signal(0);

  paymentAmountValue(): number {
    return Number(this.paymentAmount() || 0);
  }
  readonly paymentDate = signal(this.today());
  readonly paymentMethod = signal('cash');
  readonly paymentNote = signal('');

  readonly editingPayment = signal<Payment | null>(null);
  readonly editPaymentAmount = signal(0);
  readonly editPaymentDate = signal(this.today());
  readonly editPaymentMethod = signal('cash');
  readonly editPaymentNote = signal('');

  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly firmBalance = signal(0);
  readonly firmBalanceLoading = signal(false);

  async loadFirmBalance(): Promise<void> {
    this.firmBalanceLoading.set(true);

    try {
      const balance = await this.firmFinance.getCurrentBalance();
      this.firmBalance.set(Number(balance || 0));
    } catch (error) {
      this.error.set(this.readError(error));
    } finally {
      this.firmBalanceLoading.set(false);
    }
  }
  selectEmployee(employee: Employee): void {
    void this.loadFirmBalance();
    this.selectedEmployee.set(employee);
    this.error.set('');
    this.message.set('');
    void this.loadEmployeePayments(employee);
  }

  async loadEmployeePayments(employee: Employee): Promise<void> {
    try {
      const payments = await this.attendance.loadPayments(employee.id);
      this.localPayments.set(payments);
    } catch (error) {
      this.error.set(this.readError(error));
    }
  }

  readonly localPayments = signal<Payment[]>([]);

  openPayment(employee: Employee): void {
    void this.loadFirmBalance();
    this.selectedEmployee.set(employee);
    this.paymentAmount.set(0);
    this.paymentDate.set(this.today());
    this.paymentMethod.set('cash');
    this.paymentNote.set('');
    this.error.set('');
    this.message.set('');
    void this.loadEmployeePayments(employee);

    // Make the payment action immediately visible on mobile and desktop.
    setTimeout(() => {
      document.getElementById('payment-form-panel')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  }

  async confirmPayment(): Promise<void> {
    if (this.busy()) return;

    const employee = this.selectedEmployee();
    const user = this.attendance.getSession();

    if (!employee || !user) {
      this.error.set('Please select an employee and make sure you are logged in.');
      return;
    }

    if (this.paymentAmount() <= 0) {
      this.error.set('Payment amount must be greater than zero.');
      return;
    }

    if (!this.paymentDate()) {
      this.error.set('Payment date is required.');
      return;
    }

    if (
      !confirm(
        `Process ${this.currency(this.paymentAmount())} for ${employee.name}?`
      )
    ) {
      return;
    }

    this.busy.set(true);
    this.error.set('');
    this.message.set('');

    try {
      await this.attendance.processPayment(
        employee.id,
        this.paymentAmount(),
        this.paymentDate(),
        this.paymentMethod(),
        this.paymentNote(),
        user.id
      );

      await this.loadEmployeePayments(employee);

      this.paymentAmount.set(0);
      this.paymentNote.set('');

      this.message.set(
        'Payment processed successfully using FIFO allocation.'
      );

      this.refreshRequested.emit();
    } catch (error) {
      this.error.set(this.readError(error));
    } finally {
      this.busy.set(false);
    }
  }

  openPaymentEdit(payment: Payment): void {
    if (payment.status === 'reversed') return;

    this.editingPayment.set(payment);
    this.editPaymentAmount.set(Number(payment.amount));
    this.editPaymentDate.set(payment.payment_date);
    this.editPaymentMethod.set(payment.payment_method);
    this.editPaymentNote.set(payment.note || '');
    this.error.set('');
    this.message.set('');
  }

  closePaymentEdit(): void {
    this.editingPayment.set(null);
  }

  async savePaymentEdit(): Promise<void> {
    if (this.busy()) return;

    const user = this.attendance.getSession();
    const payment = this.editingPayment();

    if (!user || !payment) return;

    if (this.editPaymentAmount() <= 0) {
      this.error.set('Payment amount must be greater than zero.');
      return;
    }

    if (
      !confirm(
        `Update payment to ${this.currency(this.editPaymentAmount())}?`
      )
    ) {
      return;
    }

    this.busy.set(true);
    this.error.set('');
    this.message.set('');

    try {
      await this.attendance.updatePayment(
        payment.id,
        this.editPaymentAmount(),
        this.editPaymentDate(),
        this.editPaymentMethod(),
        this.editPaymentNote(),
        user.id
      );

      this.closePaymentEdit();

      const employee = this.selectedEmployee();
      if (employee) {
        await this.loadEmployeePayments(employee);
      }

      this.message.set('Payment updated successfully.');
      this.refreshRequested.emit();
    } catch (error) {
      this.error.set(this.readError(error));
    } finally {
      this.busy.set(false);
    }
  }

  async reverse(payment: Payment): Promise<void> {
    if (this.busy()) return;

    const user = this.attendance.getSession();

    if (!user || payment.status === 'reversed') return;

    if (
      !confirm(
        'Reverse this payment? Its allocations will no longer count as paid.'
      )
    ) {
      return;
    }

    this.busy.set(true);
    this.error.set('');
    this.message.set('');

    try {
      await this.attendance.reversePayment(payment.id, user.id);

      const employee = this.selectedEmployee();

      if (employee) {
        await this.loadEmployeePayments(employee);
      }

      this.message.set('Payment reversed successfully.');
      this.refreshRequested.emit();
    } catch (error) {
      this.error.set(this.readError(error));
    } finally {
      this.busy.set(false);
    }
  }

  employeeBalance(employee: Employee): number {
    const earned = this.allPayments.length
      ? this.getEmployeeEarned(employee.id)
      : 0;

    const paid = this.allPayments
      .filter(
        payment =>
          payment.employee_id === employee.id &&
          payment.status === 'completed'
      )
      .reduce((sum, payment) => sum + Number(payment.amount), 0);

    return earned - paid;
  }

  private getEmployeeEarned(employeeId: number): number {
    // Payment allocation is handled by the existing service/database.
    // This component does not alter the existing wage calculation.
    return 0;
  }

  employeePayments(employeeId: number): Payment[] {
    return this.allPayments
      .filter(
        payment =>
          payment.employee_id === employeeId &&
          payment.status === 'completed'
      )
      .sort(
        (a, b) =>
          b.payment_date.localeCompare(a.payment_date) || b.id - a.id
      );
  }

  currency(value: number | string): string {
    return `\u20B9${Number(value || 0).toLocaleString('en-IN', {
      maximumFractionDigits: 2
    })}`;
  }

  today(): string {
    const date = new Date();

    return `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  paymentMethodLabel(method: string): string {
    return method
      .replace(/_/g, ' ')
      .replace(/\b\w/g, character => character.toUpperCase());
  }

  private readError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error
    ) {
      return String((error as { message: unknown }).message);
    }

    return 'Something went wrong. Please try again.';
  }
}







