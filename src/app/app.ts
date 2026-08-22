import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AttendanceRecord, AttendanceService, AttendanceType, Employee, Payment, SessionUser, UserOption } from './services/attendance.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private readonly attendance = inject(AttendanceService);
  readonly session = signal<SessionUser | null>(this.attendance.getSession());
  readonly employees = signal<Employee[]>([]);
  readonly users = signal<UserOption[]>([]);
  readonly records = signal<AttendanceRecord[]>([]);
  readonly payments = signal<Payment[]>([]);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly tab = signal<'overview' | 'approval' | 'payments'>('overview');
  readonly selectedEmployee = signal<Employee | null>(null);
  readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly modal = signal<'attendance' | 'day' | 'payment' | 'employee' | 'admin-attendance' | 'password' | null>(null);
  readonly selectedDay = signal<string | null>(null);
  readonly paymentTarget = signal<Employee | null>(null);
  readonly paymentAmount = signal(0);
  readonly paymentDate = signal(this.today());
  readonly paymentMethod = signal('cash');
  readonly paymentNote = signal('');
  readonly attendanceType = signal<AttendanceType>('full_day');
  readonly customWage = signal(0);
  readonly attendanceNote = signal('');
  readonly adminAttendanceEmployee = signal<Employee | null>(null);
  readonly adminAttendanceDate = signal(this.today());
  readonly adminAttendanceType = signal<AttendanceType>('full_day');
  readonly adminAttendanceNote = signal('');
  readonly correctingRecord = signal<AttendanceRecord | null>(null);
  readonly passwordCurrent = signal('');
  readonly passwordNew = signal('');
  readonly forgotUsername = signal('');
  readonly loginUsername = signal('');
  readonly loginPassword = signal('');
  readonly newEmployee = signal({ name: '', employee_code: '', mobile: '', default_daily_rate: 500, joining_date: this.today(), user_id: null as number | null, login_username: '', login_password: '' });

  readonly monthLabel = computed(() => this.month().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));
  readonly selectedRecord = computed(() => this.records().find(record => record.attendance_date === this.selectedDay()) ?? null);
  readonly days = computed(() => { const value = this.month(); const count = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate(); return Array.from({ length: count }, (_, index) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`); });
  readonly calendarOffset = computed(() => new Date(this.month().getFullYear(), this.month().getMonth(), 1).getDay());
  readonly currentEmployee = computed(() => this.selectedEmployee() ?? this.employees().find(employee => employee.user_id === this.session()?.id) ?? null);
  readonly availableUsers = computed(() => {
    const linkedUserIds = new Set(this.employees().map(employee => employee.user_id).filter((id): id is number => id !== null));
    return this.users().filter(user => !linkedUserIds.has(user.id));
  });
  readonly currentRecords = computed(() => this.records().filter(record => record.employee_id === this.currentEmployee()?.id));
  readonly pendingRecords = computed(() => this.records().filter(record => record.approval_status === 'pending'));
  readonly totalEarned = computed(() => this.currentRecords().filter(record => record.approval_status === 'approved').reduce((sum, record) => sum + Number(record.earned_amount), 0));
  readonly totalPaid = computed(() => this.currentRecords().reduce((sum, record) => sum + Number(record.paid_amount), 0));
  readonly outstanding = computed(() => Math.max(this.totalEarned() - this.totalPaid(), 0));
  readonly fullDays = computed(() => this.currentRecords().filter(record => record.attendance_type === 'full_day' && record.approval_status === 'approved').length);
  readonly halfDays = computed(() => this.currentRecords().filter(record => record.attendance_type === 'half_day' && record.approval_status === 'approved').length);
  readonly leaves = computed(() => this.currentRecords().filter(record => record.attendance_type === 'leave' && record.approval_status === 'approved').length);
  readonly pending = computed(() => this.currentRecords().filter(record => record.approval_status === 'pending').length);

  ngOnInit(): void { void this.init(); }
  async init(): Promise<void> { if (this.session()) await this.refresh(); }
  async refresh(): Promise<void> { await this.run(async () => { this.employees.set(await this.attendance.loadEmployees()); this.users.set(await this.attendance.loadUsers()); this.records.set(await this.attendance.loadAllAttendance()); const employee = this.currentEmployee(); if (employee) { this.selectedEmployee.set(employee); this.payments.set(await this.attendance.loadPayments(employee.id)); } }); }
  async login(): Promise<void> { await this.run(async () => { const result = await this.attendance.login(this.loginUsername(), this.loginPassword()); if (result.error || !result.user) throw new Error(result.error); this.session.set(result.user); await this.refresh(); }); }
  logout(): void { this.attendance.logout(); this.session.set(null); }
  selectEmployee(employee: Employee): void { this.selectedEmployee.set(employee); void this.loadEmployeePayments(employee); }
  async loadEmployeePayments(employee: Employee): Promise<void> { try { this.payments.set(await this.attendance.loadPayments(employee.id)); } catch (error) { this.error.set(this.readError(error)); } }
  previousMonth(): void { this.month.update(value => new Date(value.getFullYear(), value.getMonth() - 1, 1)); }
  nextMonth(): void { this.month.update(value => new Date(value.getFullYear(), value.getMonth() + 1, 1)); }
  openDay(date: string): void { this.selectedDay.set(date); this.modal.set(this.records().some(record => record.employee_id === this.currentEmployee()?.id && record.attendance_date === date) ? 'day' : 'attendance'); }
  setAttendanceType(type: AttendanceType): void { this.attendanceType.set(type); if (type !== 'custom') this.customWage.set(0); }
  setAdminAttendanceType(type: AttendanceType): void { this.adminAttendanceType.set(type); if (type !== 'custom') this.customWage.set(0); }
  async submitAttendance(): Promise<void> { const employee = this.currentEmployee(); const user = this.session(); if (!employee || !user || !this.selectedDay()) return; await this.run(async () => { await this.attendance.submitAttendance(employee.id, user.id, this.selectedDay()!, this.attendanceType(), this.attendanceNote(), this.customWage()); this.closeModal(); await this.refresh(); this.message.set('Attendance submitted for admin approval.'); }); }
  openAdminAttendance(employee: Employee): void { this.adminAttendanceEmployee.set(employee); this.adminAttendanceDate.set(this.today()); this.adminAttendanceType.set('full_day'); this.adminAttendanceNote.set('Marked by admin'); this.modal.set('admin-attendance'); }
  async submitAdminAttendance(): Promise<void> { const employee = this.adminAttendanceEmployee(); const user = this.session(); if (!employee || !user) return; await this.run(async () => { const correction = this.correctingRecord(); if (correction) await this.attendance.correctAttendance(correction.id, this.adminAttendanceType(), user.id, this.adminAttendanceNote(), this.customWage()); else await this.attendance.submitAttendance(employee.id, user.id, this.adminAttendanceDate(), this.adminAttendanceType(), this.adminAttendanceNote(), this.customWage()); this.closeModal(); await this.refresh(); this.message.set(correction ? 'Attendance corrected and approved.' : `Attendance marked for ${employee.name}. It is pending approval.`); }); }
  openCorrection(record: AttendanceRecord): void { this.correctingRecord.set(record); this.adminAttendanceEmployee.set(this.employees().find(employee => employee.id === record.employee_id) ?? null); this.adminAttendanceType.set(record.attendance_type); this.adminAttendanceNote.set(record.note || 'Corrected by admin'); this.modal.set('admin-attendance'); }
  async decide(record: AttendanceRecord, status: 'approved' | 'denied'): Promise<void> { const user = this.session(); if (!user || !confirm(`${status === 'approved' ? 'Approve' : 'Deny'} this attendance record?`)) return; await this.run(async () => { await this.attendance.updateApproval(record.id, status, user.id); await this.refresh(); this.message.set(`Attendance ${status} successfully.`); }); }
  openPayment(employee: Employee): void { this.paymentTarget.set(employee); this.paymentAmount.set(0); this.paymentDate.set(this.today()); this.paymentNote.set(''); this.modal.set('payment'); void this.loadEmployeePayments(employee); }
  async confirmPayment(): Promise<void> { const employee = this.paymentTarget(); const user = this.session(); if (!employee || !user || this.paymentAmount() <= 0) { this.error.set('Payment amount must be greater than zero.'); return; } if (!confirm(`Process ${this.currency(this.paymentAmount())} for ${employee.name}?`)) return; await this.run(async () => { await this.attendance.processPayment(employee.id, this.paymentAmount(), this.paymentDate(), this.paymentMethod(), this.paymentNote(), user.id); this.closeModal(); await this.refresh(); this.message.set('Payment processed successfully using FIFO allocation.'); }); }
  async reverse(payment: Payment): Promise<void> { const user = this.session(); if (!user || payment.status === 'reversed' || !confirm('Reverse this payment? Its allocations will no longer count as paid.')) return; await this.run(async () => { await this.attendance.reversePayment(payment.id, user.id); const employee = this.paymentTarget() ?? this.currentEmployee(); if (employee) await this.loadEmployeePayments(employee); await this.refresh(); this.message.set('Payment reversed successfully.'); }); }
  async saveEmployee(): Promise<void> { const value = this.newEmployee(); if (!value.name.trim() || !value.mobile.trim() || value.default_daily_rate < 0) { this.error.set('Name, mobile number and a valid rate are required.'); return; } await this.run(async () => { let userId = value.user_id; if (!userId) userId = await this.attendance.createEmployeeLogin(value.mobile, value.mobile, value.name); const employeeCode = value.employee_code.trim().toUpperCase() || this.nextEmployeeCode(); await this.attendance.saveEmployee({ user_id: userId, name: value.name.trim(), employee_code: employeeCode, mobile: value.mobile.trim(), default_daily_rate: value.default_daily_rate, joining_date: value.joining_date, status: 'active' }); this.closeModal(); await this.refresh(); this.message.set(`Employee added with ID ${employeeCode}. Mobile number is the initial username and password.`); }); }
  nextEmployeeCode(): string { const highest = this.employees().reduce((max, employee) => { const match = employee.employee_code.match(/SH-(\d+)/i); return Math.max(max, match ? Number(match[1]) : 0); }, 0); return `SH-${String(highest + 1).padStart(3, '0')}`; }
  shareCredentials(employee: Employee): void { if (!employee.mobile) { this.error.set('This employee has no mobile number.'); return; } const text = `SURAKSHA HUB login\nUsername: ${employee.mobile}\nInitial password: ${employee.mobile}\nPlease change your password after signing in.`; window.location.href = `sms:${employee.mobile}?body=${encodeURIComponent(text)}`; }
  async changePassword(): Promise<void> { const user = this.session(); if (!user) return; await this.run(async () => { await this.attendance.updatePassword(user.id, this.passwordCurrent(), this.passwordNew()); this.closeModal(); this.passwordCurrent.set(''); this.passwordNew.set(''); this.message.set('Password updated successfully.'); }); }
  async forgotPassword(): Promise<void> { await this.run(async () => { await this.attendance.resetPassword(this.forgotUsername(), this.passwordNew()); this.closeModal(); this.forgotUsername.set(''); this.passwordNew.set(''); this.message.set('Password reset successfully.'); }); }
  async removeEmployee(employee: Employee): Promise<void> { if (!confirm(`Delete ${employee.name} (${employee.employee_code})? This is only allowed when no attendance or payment history exists.`)) return; await this.run(async () => { await this.attendance.deleteEmployee(employee.id); if (this.selectedEmployee()?.id === employee.id) this.selectedEmployee.set(null); await this.refresh(); this.message.set('Employee profile deleted.'); }); }
  formatType(type: AttendanceType): string { return type.replace('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
  toNumber(value: number | string): number { return Number(value); }
  currency(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0); }
  recordFor(date: string): AttendanceRecord | undefined { return this.currentRecords().find(record => record.attendance_date === date); }
  dayClass(date: string): string { const record = this.recordFor(date); if (!record) return 'future'; if (record.approval_status === 'pending') return 'pending'; if (record.approval_status === 'denied') return 'denied'; if (record.outstanding_amount === 0 && record.earned_amount > 0) return 'paid'; if (record.paid_amount > 0) return 'partial'; if (record.attendance_type === 'half_day') return 'half'; if (record.attendance_type === 'leave') return 'leave'; return 'unpaid'; }
  closeModal(): void { this.modal.set(null); }
  private today(): string { return new Date().toISOString().slice(0, 10); }
  private async run(action: () => Promise<void>): Promise<void> { this.busy.set(true); this.error.set(''); this.message.set(''); try { await action(); } catch (error) { this.error.set(this.readError(error)); } finally { this.busy.set(false); } }
  private readError(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
}
