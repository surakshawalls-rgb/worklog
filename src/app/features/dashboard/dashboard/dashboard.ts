import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FirmCashComponent } from '../../firm-cash/firm-cash/firm-cash.component';
import { FirmFinanceService } from '../../../services/firm-finance.service';
import {
  AttendanceRecord,
  Employee,
  Payment
} from '../../../services/attendance.service';

interface EmployeeBalanceRow {
  employee: Employee;
  earned: number;
  paid: number;
  balance: number;
}

@Component({
  selector: 'app-dashboard',
  imports: [
    FirmCashComponent,CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class DashboardComponent implements OnInit {
  private readonly firmFinance = inject(FirmFinanceService);

  @Input() employees: Employee[] = [];
  @Input() records: AttendanceRecord[] = [];
  @Input() allPayments: Payment[] = [];
  @Input() pendingCount = 0;

  @Input() announcement: { message?: string } | null = null;

  @Output() announcementEditRequested = new EventEmitter<void>();

  @Output() refreshRequested = new EventEmitter<void>();

  readonly busy = signal(false);
  readonly firmBalance = signal<number | null>(null);
  readonly firmBalanceError = signal('');
  readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  ngOnInit(): void {
    void this.loadFirmBalance();
  }

  async loadFirmBalance(): Promise<void> {
    this.firmBalanceError.set('');

    try {
      this.firmBalance.set(await this.firmFinance.getCurrentBalance());
    } catch (error) {
      console.error('[Dashboard] firm balance load error', error);
      this.firmBalanceError.set('Unable to load the current firm balance.');
    }
  }

  scrollToFirmCash(): void {
    document.getElementById('firm-cash-details')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  monthLabel(): string {
    return this.month().toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric'
    });
  }

  monthStart(): string {
    const date = this.month();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  }

  monthEnd(): string {
    const date = this.month();
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }

  monthRecords(): AttendanceRecord[] {
    const start = this.monthStart();
    const end = this.monthEnd();
    return this.records.filter(record =>
      record.attendance_date >= start &&
      record.attendance_date <= end
    );
  }

  approvedMonthRecords(): AttendanceRecord[] {
    return this.monthRecords().filter(record => record.approval_status === 'approved');
  }

  monthPayments(): Payment[] {
    const start = this.monthStart();
    const end = this.monthEnd();
    return this.allPayments.filter(payment =>
      payment.status === 'completed' &&
      payment.payment_date >= start &&
      payment.payment_date <= end
    );
  }

  totalExpense(): number {
    return this.approvedMonthRecords().reduce(
      (total, record) => total + Number(record.earned_amount || 0),
      0
    );
  }

  totalPaid(): number {
    return this.monthPayments().reduce(
      (total, payment) => total + Number(payment.amount || 0),
      0
    );
  }

  monthOutstanding(): number {
    return this.approvedMonthRecords().reduce(
      (total, record) => total + Math.max(0, Number(record.outstanding_amount || 0)),
      0
    );
  }

  totalAdvance(): number {
    return this.employeeBalanceRows()
      .reduce(
        (advance, row) => advance + Math.max(0, -row.balance),
        0
      );
  }

  employeeBalanceRows(): EmployeeBalanceRow[] {
    const earned = new Map<number, number>();
    const paid = new Map<number, number>();

    for (const record of this.records) {
      if (record.approval_status !== 'approved') continue;
      earned.set(
        record.employee_id,
        (earned.get(record.employee_id) || 0) + Number(record.earned_amount || 0)
      );
    }

    for (const payment of this.allPayments) {
      if (payment.status !== 'completed') continue;
      paid.set(
        payment.employee_id,
        (paid.get(payment.employee_id) || 0) + Number(payment.amount || 0)
      );
    }

    return this.employees
      .map(employee => {
        const employeeEarned = earned.get(employee.id) || 0;
        const employeePaid = paid.get(employee.id) || 0;

        return {
          employee,
          earned: employeeEarned,
          paid: employeePaid,
          balance: employeeEarned - employeePaid
        };
      })
      .filter(row =>
        row.balance < 0 ||
        (row.balance === 0 && (row.earned > 0 || row.paid > 0))
      )
      .sort((first, second) =>
        first.balance - second.balance ||
        first.employee.name.localeCompare(second.employee.name)
      );
  }

  approvedDays(): number {
    return this.approvedMonthRecords().length;
  }

  fullDays(): number {
    return this.approvedMonthRecords().filter(record => record.attendance_type === 'full_day').length;
  }

  halfDays(): number {
    return this.approvedMonthRecords().filter(record => record.attendance_type === 'half_day').length;
  }

  leaves(): number {
    return this.approvedMonthRecords().filter(record => record.attendance_type === 'leave').length;
  }

  pendingMonthCount(): number {
    return this.monthRecords().filter(record => record.approval_status === 'pending').length;
  }

  paymentCount(): number {
    return this.monthPayments().length;
  }

  averageExpense(): number {
    return this.employees.length ? this.totalExpense() / this.employees.length : 0;
  }

  previousMonth(): void {
    const current = this.month();
    this.month.set(new Date(current.getFullYear(), current.getMonth() - 1, 1));
  }

  nextMonth(): void {
    const current = this.month();
    const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    if (next <= currentMonth) {
      this.month.set(next);
    }
  }

  refresh(): void {
    if (this.busy()) return;

    this.busy.set(true);
    void this.loadFirmBalance();
    this.refreshRequested.emit();
    setTimeout(() => this.busy.set(false), 300);
  }

  currency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(value || 0);
  }
}
