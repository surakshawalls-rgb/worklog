import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { AttendanceRecord, Employee, Payment } from '../../../services/attendance.service';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class DashboardComponent {
  @Input() employees: Employee[] = [];
  @Input() records: AttendanceRecord[] = [];
  @Input() allPayments: Payment[] = [];
  @Input() pendingCount = 0;

  @Output() refreshRequested = new EventEmitter<void>();

  readonly busy = signal(false);
  readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

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

    let advance = 0;
    for (const employee of this.employees) {
      const balance = (earned.get(employee.id) || 0) - (paid.get(employee.id) || 0);
      if (balance < 0) advance += Math.abs(balance);
    }

    return advance;
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
