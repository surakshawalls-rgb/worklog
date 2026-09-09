import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  AttendanceRecord,
  AttendanceService,
  AttendanceType,
  Employee,
  Payment,
  SessionUser
} from '../../../services/attendance.service';

@Component({
  selector: 'app-attendance',
  imports: [CommonModule, FormsModule],
  templateUrl: './attendance.html',
  styleUrl: './attendance.scss'
})
export class AttendanceComponent implements OnInit {
  private readonly attendance = inject(AttendanceService);

  readonly session = signal<SessionUser | null>(
    this.attendance.getSession()
  );

  readonly employees = signal<Employee[]>([]);
  readonly records = signal<AttendanceRecord[]>([]);
  @Input() allPayments: Payment[] = [];

  readonly selectedEmployee = signal<Employee | null>(null);
  readonly month = signal(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  readonly busy = signal(false);
  readonly message = signal('');
  readonly error = signal('');

  readonly modal = signal<
    | 'attendance'
    | 'day'
    | 'admin-attendance'
    | 'bulk-attendance'
    | 'range-attendance'
    | null
  >(null);

  readonly selectedDay = signal<string | null>(null);

  readonly attendanceType = signal<AttendanceType>('full_day');
  readonly customWage = signal(0);
  readonly attendanceNote = signal('');

  readonly adminAttendanceEmployee = signal<Employee | null>(null);
  readonly adminAttendanceDate = signal(this.today());
  readonly adminAttendanceType = signal<AttendanceType>('full_day');
  readonly adminAttendanceNote = signal('');

  readonly bulkEmployeeIds = signal<number[]>([]);
  readonly bulkAttendanceDate = signal(this.today());
  readonly bulkAttendanceType = signal<AttendanceType>('full_day');
  readonly bulkAttendanceNote = signal('Marked by admin');

  readonly rangeEmployeeIds = signal<number[]>([]);
  readonly rangeStartDate = signal(this.today());
  readonly rangeEndDate = signal(this.today());
  readonly rangeAttendanceType = signal<AttendanceType>('full_day');
  readonly rangeAttendanceNote = signal('Submitted after the work date');

  readonly correctingRecord = signal<AttendanceRecord | null>(null);

  readonly currentEmployee = computed(() =>
    this.selectedEmployee() ??
    this.employees().find(
      employee => employee.user_id === this.session()?.id
    ) ??
    null
  );

  readonly currentRecords = computed(() => {
    const employee = this.currentEmployee();

    if (!employee) {
      return [];
    }

    return this.records().filter(
      record => record.employee_id === employee.id
    );
  });

    readonly selectedEmployeeEarned = computed(() =>
    this.currentRecords()
      .filter(
        record =>
          record.approval_status === 'approved'
      )
      .reduce(
        (total, record) =>
          total + Number(record.earned_amount || 0),
        0
      )
  );

  readonly selectedEmployeePaid = computed(() => {
    const employee = this.currentEmployee();

    if (!employee) {
      return 0;
    }

    return this.allPayments
      .filter(
        payment =>
          payment.employee_id === employee.id &&
          payment.status === 'completed'
      )
      .reduce(
        (total, payment) =>
          total + Number(payment.amount || 0),
        0
      );
  });

  readonly selectedEmployeeBalance = computed(() =>
    this.selectedEmployeeEarned() -
    this.selectedEmployeePaid()
  );

  readonly selectedEmployeeBalanceLabel = computed(() => {
    const balance =
      this.selectedEmployeeBalance();

    if (balance > 0) {
      return 'Due';
    }

    if (balance < 0) {
      return 'Advance';
    }

    return 'Settled';
  });

  readonly selectedEmployeeBalanceAmount = computed(() =>
    Math.abs(
      this.selectedEmployeeBalance()
    )
  );

  readonly monthRecords = computed(() => {
    const value = this.month();

    const prefix =
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;

    return this.currentRecords().filter(
      record => record.attendance_date.startsWith(prefix)
    );
  });

  readonly monthLabel = computed(() =>
    this.month().toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric'
    })
  );

  readonly days = computed(() => {
    const value = this.month();

    const count = new Date(
      value.getFullYear(),
      value.getMonth() + 1,
      0
    ).getDate();

    return Array.from(
      { length: count },
      (_, index) =>
        `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`
    );
  });

  readonly calendarOffset = computed(() =>
    new Date(
      this.month().getFullYear(),
      this.month().getMonth(),
      1
    ).getDay()
  );

  readonly monthWorkingDays = computed(() =>
    this.monthRecords().filter(
      record => record.approval_status === 'approved'
    ).length
  );

  readonly monthPaidDays = computed(() =>
    this.monthRecords().filter(
      record =>
        record.approval_status === 'approved' &&
        record.earned_amount > 0 &&
        record.outstanding_amount === 0
    ).length
  );

  readonly monthUnpaidDays = computed(() =>
    this.monthRecords().filter(
      record =>
        record.approval_status === 'approved' &&
        record.earned_amount > 0 &&
        record.outstanding_amount > 0
    ).length
  );

  readonly monthLeaves = computed(() =>
    this.monthRecords().filter(
      record =>
        record.approval_status === 'approved' &&
        record.attendance_type === 'leave'
    ).length
  );

  readonly selectedRecord = computed(() =>
    this.records().find(
      record => record.attendance_date === this.selectedDay() &&
      record.employee_id === this.currentEmployee()?.id
    ) ?? null
  );

  ngOnInit(): void {
    void this.init();
  }

  async init(): Promise<void> {
    if (!this.session()) {
      return;
    }

    await this.refresh();
  }

  async refresh(): Promise<void> {
    await this.run(async () => {
      this.employees.set(
        await this.attendance.loadEmployees()
      );

      this.records.set(
        await this.attendance.loadAllAttendance()
      );

      const employee = this.currentEmployee();

      if (
        employee &&
        this.selectedEmployee()?.id !== employee.id
      ) {
        this.selectedEmployee.set(employee);
      }
    });
  }

  selectEmployee(employee: Employee): void {
    this.selectedEmployee.set(employee);
    this.clearFeedback();
  }

  previousMonth(): void {
    this.month.update(
      value =>
        new Date(
          value.getFullYear(),
          value.getMonth() - 1,
          1
        )
    );
  }

  nextMonth(): void {
    this.month.update(
      value =>
        new Date(
          value.getFullYear(),
          value.getMonth() + 1,
          1
        )
    );
  }

  openDay(date: string): void {
    if (this.isFutureDate(date)) {
      this.error.set('Future attendance cannot be marked.');
      return;
    }

    this.selectedDay.set(date);

    const employee = this.currentEmployee();

    if (!employee) {
      this.error.set('Please select an employee.');
      return;
    }

    const existing = this.records().some(
      record =>
        record.employee_id === employee.id &&
        record.attendance_date === date
    );

    // Employees may view an old record, but they cannot create a new
    // attendance entry once the 3-day marking window has passed.
    if (!existing && this.isPastAttendanceLocked(date)) {
      this.error.set(
        'Attendance older than 3 days can only be marked by admin.'
      );
      return;
    }

    this.modal.set(existing ? 'day' : 'attendance');
  }

  setAttendanceType(type: AttendanceType): void {
    this.attendanceType.set(type);

    if (type !== 'custom') {
      this.customWage.set(0);
    }
  }

  setAdminAttendanceType(type: AttendanceType): void {
    this.adminAttendanceType.set(type);

    if (type !== 'custom') {
      this.customWage.set(0);
    }
  }

  setBulkAttendanceType(type: AttendanceType): void {
    this.bulkAttendanceType.set(type);

    if (type !== 'custom') {
      this.customWage.set(0);
    }
  }

  setRangeAttendanceType(type: AttendanceType): void {
    this.rangeAttendanceType.set(type);

    if (type !== 'custom') {
      this.customWage.set(0);
    }
  }

  async submitAttendance(): Promise<void> {
    const employee = this.currentEmployee();
    const user = this.session();
    const date = this.selectedDay();

    if (!employee || !user || !date) {
      return;
    }

    if (!this.canMarkAttendanceDate(date)) {
      this.error.set(this.attendanceDateLockMessage(date));
      return;
    }

    await this.run(async () => {
      await this.attendance.submitAttendance(
        employee.id,
        user.id,
        date,
        this.attendanceType(),
        this.attendanceNote(),
        this.customWage()
      );

      this.closeModal();

      await this.refresh();

      this.message.set(
        'Attendance submitted for admin approval.'
      );
    });
  }

  openAdminAttendance(employee: Employee): void {
    this.openRangeAttendance(employee);
  }

  openBulkAttendance(): void {
    if (this.session()?.role !== 'admin') {
      this.error.set('Only admin can mark bulk attendance.');
      return;
    }

    this.bulkEmployeeIds.set(
      this.employees()
        .filter(employee => employee.status === 'active')
        .map(employee => employee.id)
    );

    this.bulkAttendanceDate.set(this.today());
    this.bulkAttendanceType.set('full_day');
    this.bulkAttendanceNote.set('Marked by admin');

    this.modal.set('bulk-attendance');
  }

  toggleBulkEmployee(employeeId: number): void {
    this.bulkEmployeeIds.update(ids =>
      ids.includes(employeeId)
        ? ids.filter(id => id !== employeeId)
        : [...ids, employeeId]
    );
  }

  async submitBulkAttendance(): Promise<void> {
    const user = this.session();
    const ids = this.bulkEmployeeIds();
    const date = this.bulkAttendanceDate();

    if (!user || user.role !== 'admin') {
      this.error.set('Only admin can mark bulk attendance.');
      return;
    }

    if (ids.length === 0) {
      this.error.set('Select at least one employee.');
      return;
    }

    if (this.isFutureDate(date)) {
      this.error.set('Future attendance cannot be marked.');
      return;
    }

    await this.run(async () => {
      const count =
        await this.attendance.submitBulkAttendance(
          ids,
          date,
          this.bulkAttendanceType(),
          this.bulkAttendanceNote(),
          this.customWage(),
          user.id
        );

      this.closeModal();

      await this.refresh();

      this.message.set(
        `Attendance marked for ${count} employees and sent for approval.`
      );
    });
  }

  openRangeAttendance(employee?: Employee): void {
    const user = this.session();

    if (!user) {
      return;
    }

    const ownEmployee = this.employees().find(
      item => item.user_id === user.id
    );

    this.rangeEmployeeIds.set(
      employee
        ? [employee.id]
        : user.role === 'admin'
          ? []
          : ownEmployee
            ? [ownEmployee.id]
            : []
    );

    this.rangeStartDate.set(this.today());
    this.rangeEndDate.set(this.today());
    this.rangeAttendanceType.set('full_day');
    this.rangeAttendanceNote.set(
      'Submitted after the work date'
    );

    this.modal.set('range-attendance');
  }

  toggleRangeEmployee(employeeId: number): void {
    this.rangeEmployeeIds.update(ids =>
      ids.includes(employeeId)
        ? ids.filter(id => id !== employeeId)
        : [...ids, employeeId]
    );
  }

  async submitRangeAttendance(): Promise<void> {
    const user = this.session();
    const start = this.rangeStartDate();
    const end = this.rangeEndDate();
    const employeeIds = this.rangeEmployeeIds();

    if (!user || employeeIds.length === 0) {
      this.error.set('Select at least one employee.');
      return;
    }

    if (this.session()?.role !== 'admin') {
      if (!this.canMarkAttendanceDate(start) || !this.canMarkAttendanceDate(end)) {
        this.error.set(
          'Employees can mark attendance only for today or the previous 3 days. Older dates are admin-only.'
        );
        return;
      }
    } else if (this.isFutureDate(start) || this.isFutureDate(end)) {
      this.error.set('Future attendance cannot be marked.');
      return;
    }

    if (start > end) {
      this.error.set(
        'Start date cannot be after end date.'
      );
      return;
    }

    await this.run(async () => {
      const count =
        await this.attendance.submitAttendanceRange(
          employeeIds,
          start,
          end,
          this.rangeAttendanceType(),
          this.rangeAttendanceNote(),
          this.customWage(),
          user.id
        );

      this.closeModal();

      await this.refresh();

      this.message.set(
        `${count} missed attendance entries submitted for approval.`
      );
    });
  }

  async submitAdminAttendance(): Promise<void> {
    const employee = this.adminAttendanceEmployee();
    const user = this.session();
    const date = this.adminAttendanceDate();

    if (!employee || !user) {
      return;
    }

    const correction = this.correctingRecord();

    if (
      !correction &&
      this.isFutureDate(date)
    ) {
      this.error.set(
        'Future attendance cannot be marked.'
      );
      return;
    }

    await this.run(async () => {
      if (correction) {
        await this.attendance.correctAttendance(
          correction.id,
          this.adminAttendanceType(),
          user.id,
          this.adminAttendanceNote(),
          this.customWage()
        );
      } else {
        await this.attendance.submitAttendance(
          employee.id,
          user.id,
          date,
          this.adminAttendanceType(),
          this.adminAttendanceNote(),
          this.customWage()
        );
      }

      this.closeModal();

      await this.refresh();

      this.message.set(
        correction
          ? 'Attendance corrected and approved.'
          : `Attendance marked for ${employee.name}. It is pending approval.`
      );
    });
  }

  openCorrection(record: AttendanceRecord): void {
    if (this.isFutureDate(record.attendance_date)) {
      this.error.set(
        'Future attendance cannot be corrected.'
      );
      return;
    }

    const employee = this.employees().find(
      item => item.id === record.employee_id
    );

    this.correctingRecord.set(record);
    this.adminAttendanceEmployee.set(employee ?? null);
    this.adminAttendanceDate.set(record.attendance_date);
    this.adminAttendanceType.set(record.attendance_type);
    this.adminAttendanceNote.set(
      record.note || 'Edited by admin'
    );

    this.modal.set('admin-attendance');
  }

  recordFor(date: string): AttendanceRecord | undefined {
    const employee = this.currentEmployee();

    if (!employee) {
      return undefined;
    }

    return this.records().find(
      record =>
        record.employee_id === employee.id &&
        record.attendance_date === date
    );
  }

  dayClass(date: string): string {
    const record = this.recordFor(date);

    if (!record) {
      if (this.isFutureDate(date)) {
        return 'future';
      }

      if (this.isPastAttendanceLocked(date)) {
        return 'past-locked';
      }

      return 'available';
    }

    if (record.approval_status === 'pending') {
      return 'pending';
    }

    if (record.approval_status === 'denied') {
      return 'denied';
    }

    if (
      record.outstanding_amount === 0 &&
      record.earned_amount > 0
    ) {
      return 'paid';
    }

    if (record.paid_amount > 0) {
      return 'partial';
    }

    if (record.attendance_type === 'half_day') {
      return 'half';
    }

    if (record.attendance_type === 'leave') {
      return 'leave';
    }

    return 'unpaid';
  }

  getAttendanceTypeLabel(date: string): string {
    const record = this.recordFor(date);

    if (record) {
      return record.attendance_type.replace('_', ' ');
    }

    return this.isPastAttendanceLocked(date)
      ? 'Locked'
      : '—';
  }

  formatType(type: AttendanceType): string {
    return type
      .replace('_', ' ')
      .replace(/\b\w/g, letter => letter.toUpperCase());
  }

  closeModal(): void {
    this.modal.set(null);
    this.correctingRecord.set(null);
  }

  clearFeedback(): void {
    this.error.set('');
    this.message.set('');
  }

  currency(value: number | string): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }

  toNumber(value: number | string): number {
    return Number(value);
  }

  today(): string {
    const now = new Date();

    return `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
  }

  isFutureDate(date: string): boolean {
    return date > this.today();
  }

  /**
   * Employees can create attendance for today and the previous 3 days.
   * Admin can create attendance for any non-future date.
   */
  isPastAttendanceLocked(date: string): boolean {
    if (this.session()?.role === 'admin' || this.isFutureDate(date)) {
      return false;
    }

    return date < this.dateDaysAgo(3);
  }

  canMarkAttendanceDate(date: string): boolean {
    if (this.isFutureDate(date)) {
      return false;
    }

    return this.session()?.role === 'admin' || !this.isPastAttendanceLocked(date);
  }

  attendanceDateLockMessage(date: string): string {
    if (this.isFutureDate(date)) {
      return 'Future attendance cannot be marked.';
    }

    return 'Employees can mark attendance only for today or the previous 3 days. Older dates are admin-only.';
  }

  employeeAttendanceCutoffDate(): string {
    return this.dateDaysAgo(3);
  }

  private dateDaysAgo(days: number): string {
    const now = new Date();
    const value = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - days
    );

    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  private async run(
    action: () => Promise<void>
  ): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');

    try {
      await action();
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Something went wrong. Please try again.'
      );
    } finally {
      this.busy.set(false);
    }
  }
}