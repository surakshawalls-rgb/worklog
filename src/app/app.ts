import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AttendanceRecord, AttendanceService, AttendanceType, DailyAnnouncement, Employee, Payment, SessionUser, UserOption } from './services/attendance.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private readonly attendance = inject(AttendanceService);
  private readonly router = inject(Router);
  readonly session = signal<SessionUser | null>(this.attendance.getSession());
  readonly employees = signal<Employee[]>([]);
  readonly users = signal<UserOption[]>([]);
  readonly records = signal<AttendanceRecord[]>([]);
  readonly payments = signal<Payment[]>([]);
  readonly allPayments = signal<Payment[]>([]);
  readonly announcement = signal<DailyAnnouncement | null>(null);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly tab = signal<'overview' | 'approval' | 'payments'>('overview');
  readonly selectedEmployee = signal<Employee | null>(null);
  readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly modal = signal<'attendance' | 'day' | 'payment' | 'employee' | 'admin-attendance' | 'bulk-attendance' | 'range-attendance' | 'admin-tools' | 'password' | 'announcement' | 'edit-payment' | null>(null);
  readonly selectedDay = signal<string | null>(null);
  readonly paymentTarget = signal<Employee | null>(null);
  readonly paymentAmount = signal(0);
  readonly paymentDate = signal(this.today());
  readonly paymentMethod = signal('cash');
  readonly paymentNote = signal('');
  readonly announcementText = signal('');
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
  readonly editingPayment = signal<Payment | null>(null);
  readonly editPaymentAmount = signal(0);
  readonly editPaymentNote = signal('');
  readonly editPaymentMethod = signal('cash');
  readonly editPaymentDate = signal(this.today());
  readonly passwordCurrent = signal('');
  readonly passwordNew = signal('');
  readonly forgotUsername = signal('');
  readonly loginUsername = signal('');
  readonly loginPassword = signal('');
  readonly newEmployee = signal({ name: '', employee_code: '', mobile: '', default_daily_rate: 500, joining_date: this.today(), user_id: null as number | null, login_username: '', login_password: '' });
  isCommunicationRoute(): boolean { return this.router.url.startsWith('/chats') || this.router.url.startsWith('/chat/') || this.router.url.startsWith('/people') || this.router.url.startsWith('/profile') || this.router.url.startsWith('/call/'); }

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
  readonly monthRecords = computed(() => this.currentRecords().filter(record => record.attendance_date.startsWith(`${this.month().getFullYear()}-${String(this.month().getMonth() + 1).padStart(2, '0')}`)));
  readonly monthWorkingDays = computed(() => this.monthRecords().filter(record => record.approval_status === 'approved').length);
  readonly monthPaidDays = computed(() => this.monthRecords().filter(record => record.approval_status === 'approved' && record.earned_amount > 0 && record.outstanding_amount === 0).length);
  readonly monthUnpaidDays = computed(() => this.monthRecords().filter(record => record.approval_status === 'approved' && record.earned_amount > 0 && record.outstanding_amount > 0).length);
  readonly monthLeaves = computed(() => this.monthRecords().filter(record => record.approval_status === 'approved' && record.attendance_type === 'leave').length);
  readonly pendingRecords = computed(() => this.records().filter(record => record.approval_status === 'pending'));
  readonly totalEarned = computed(() => this.currentRecords().filter(record => record.approval_status === 'approved').reduce((sum, record) => sum + Number(record.earned_amount), 0));
  readonly totalPaid = computed(() => this.employeePaid(this.currentEmployee()?.id));
  readonly outstanding = computed(() => this.totalEarned() - this.totalPaid());
  readonly fullDays = computed(() => this.currentRecords().filter(record => record.attendance_type === 'full_day' && record.approval_status === 'approved').length);
  readonly halfDays = computed(() => this.currentRecords().filter(record => record.attendance_type === 'half_day' && record.approval_status === 'approved').length);
  readonly leaves = computed(() => this.currentRecords().filter(record => record.attendance_type === 'leave' && record.approval_status === 'approved').length);
  readonly pending = computed(() => this.currentRecords().filter(record => record.approval_status === 'pending').length);

  ngOnInit(): void { void this.init(); }
  async init(): Promise<void> { if (this.session()) await this.refresh(); }
  async refresh(): Promise<void> { await this.run(async () => { this.employees.set(await this.attendance.loadEmployees()); this.users.set(await this.attendance.loadUsers()); this.records.set(await this.attendance.loadAllAttendance()); this.allPayments.set(await this.attendance.loadAllPayments()); this.announcement.set(await this.attendance.loadActiveAnnouncement()); const employee = this.currentEmployee(); if (employee) { this.selectedEmployee.set(employee); this.payments.set(await this.attendance.loadPayments(employee.id)); } }); }
  async login(): Promise<void> { await this.run(async () => { const result = await this.attendance.login(this.loginUsername(), this.loginPassword()); if (result.error || !result.user) throw new Error(result.error); this.session.set(result.user); await this.refresh(); }); }
  logout(): void { this.attendance.logout(); this.session.set(null); }
  openCommunication(): void { this.router.navigate(['/chats']); }
  openAnnouncementEditor(): void { this.announcementText.set(this.announcement()?.message || ''); this.modal.set('announcement'); }
  async saveAnnouncement(): Promise<void> { const user = this.session(); if (!user || !this.announcementText().trim()) { this.error.set('Enter today’s work plan before posting.'); return; } await this.run(async () => { await this.attendance.publishDailyAnnouncement(this.announcementText(), user.id); this.announcement.set(await this.attendance.loadActiveAnnouncement()); this.closeModal(); this.message.set('Today’s work plan is visible until 8:00 PM.'); }); }
  selectEmployee(employee: Employee): void { this.selectedEmployee.set(employee); void this.loadEmployeePayments(employee); }
  async loadEmployeePayments(employee: Employee): Promise<void> { try { this.payments.set(await this.attendance.loadPayments(employee.id)); } catch (error) { this.error.set(this.readError(error)); } }
  previousMonth(): void { this.month.update(value => new Date(value.getFullYear(), value.getMonth() - 1, 1)); }
  nextMonth(): void { this.month.update(value => new Date(value.getFullYear(), value.getMonth() + 1, 1)); }
  openDay(date: string): void { if (this.isFutureDate(date)) { this.error.set('Future attendance cannot be marked.'); return; } this.selectedDay.set(date); this.modal.set(this.records().some(record => record.employee_id === this.currentEmployee()?.id && record.attendance_date === date) ? 'day' : 'attendance'); }
  setAttendanceType(type: AttendanceType): void { this.attendanceType.set(type); if (type !== 'custom') this.customWage.set(0); }
  setAdminAttendanceType(type: AttendanceType): void { this.adminAttendanceType.set(type); if (type !== 'custom') this.customWage.set(0); }
  async submitAttendance(): Promise<void> { const employee = this.currentEmployee(); const user = this.session(); const date = this.selectedDay(); if (!employee || !user || !date) return; if (this.isFutureDate(date)) { this.error.set('Future attendance cannot be marked.'); return; } await this.run(async () => { await this.attendance.submitAttendance(employee.id, user.id, date, this.attendanceType(), this.attendanceNote(), this.customWage()); this.closeModal(); await this.refresh(); this.message.set('Attendance submitted for admin approval.'); }); }
  openAdminAttendance(employee: Employee): void { this.openRangeAttendance(employee); }
  openBulkAttendance(): void { this.bulkEmployeeIds.set(this.employees().filter(employee => employee.status === 'active').map(employee => employee.id)); this.bulkAttendanceDate.set(this.today()); this.bulkAttendanceType.set('full_day'); this.bulkAttendanceNote.set('Marked by admin'); this.modal.set('bulk-attendance'); }
  toggleBulkEmployee(employeeId: number): void { this.bulkEmployeeIds.update(ids => ids.includes(employeeId) ? ids.filter(id => id !== employeeId) : [...ids, employeeId]); }
  setBulkAttendanceType(type: AttendanceType): void { this.bulkAttendanceType.set(type); if (type !== 'custom') this.customWage.set(0); }
  async submitBulkAttendance(): Promise<void> { const user = this.session(); const ids = this.bulkEmployeeIds(); const date = this.bulkAttendanceDate(); if (!user || ids.length === 0) { this.error.set('Select at least one employee.'); return; } if (this.isFutureDate(date)) { this.error.set('Future attendance cannot be marked.'); return; } await this.run(async () => { const count = await this.attendance.submitBulkAttendance(ids, this.bulkAttendanceDate(), this.bulkAttendanceType(), this.bulkAttendanceNote(), this.customWage(), user.id); this.closeModal(); await this.refresh(); this.message.set(`Attendance marked for ${count} employees and sent for approval.`); }); }
  openRangeAttendance(employee?: Employee): void { const user = this.session(); const ownEmployee = this.employees().find(item => item.user_id === user?.id); this.rangeEmployeeIds.set(employee ? [employee.id] : user?.role === 'admin' ? [] : ownEmployee ? [ownEmployee.id] : []); this.rangeStartDate.set(this.today()); this.rangeEndDate.set(this.today()); this.rangeAttendanceType.set('full_day'); this.rangeAttendanceNote.set('Submitted after the work date'); this.modal.set('range-attendance'); }
  toggleRangeEmployee(employeeId: number): void { this.rangeEmployeeIds.update(ids => ids.includes(employeeId) ? ids.filter(id => id !== employeeId) : [...ids, employeeId]); }
  setRangeAttendanceType(type: AttendanceType): void { this.rangeAttendanceType.set(type); if (type !== 'custom') this.customWage.set(0); }
  async submitRangeAttendance(): Promise<void> { const user = this.session(); const start = this.rangeStartDate(); const end = this.rangeEndDate(); if (!user || this.rangeEmployeeIds().length === 0) { this.error.set('Select at least one employee.'); return; } if (this.isFutureDate(start) || this.isFutureDate(end)) { this.error.set('Future attendance cannot be marked.'); return; } if (start > end) { this.error.set('Start date cannot be after end date.'); return; } await this.run(async () => { const count = await this.attendance.submitAttendanceRange(this.rangeEmployeeIds(), start, end, this.rangeAttendanceType(), this.rangeAttendanceNote(), this.customWage(), user.id); this.closeModal(); await this.refresh(); this.message.set(`${count} missed attendance entries submitted for approval.`); }); }
  async submitAdminAttendance(): Promise<void> { const employee = this.adminAttendanceEmployee(); const user = this.session(); const date = this.adminAttendanceDate(); if (!employee || !user) return; const correction = this.correctingRecord(); if (!correction && this.isFutureDate(date)) { this.error.set('Future attendance cannot be marked.'); return; } await this.run(async () => { if (correction) await this.attendance.correctAttendance(correction.id, this.adminAttendanceType(), user.id, this.adminAttendanceNote(), this.customWage()); else await this.attendance.submitAttendance(employee.id, user.id, date, this.adminAttendanceType(), this.adminAttendanceNote(), this.customWage()); this.closeModal(); await this.refresh(); this.message.set(correction ? 'Attendance corrected and approved.' : `Attendance marked for ${employee.name}. It is pending approval.`); }); }
  openCorrection(record: AttendanceRecord): void { if (this.isFutureDate(record.attendance_date)) { this.error.set('Future attendance cannot be corrected.'); return; } this.correctingRecord.set(record); this.adminAttendanceEmployee.set(this.employees().find(employee => employee.id === record.employee_id) ?? null); this.adminAttendanceType.set(record.attendance_type); this.adminAttendanceNote.set(record.note || 'Edited by admin'); this.modal.set('admin-attendance'); }
  openPaymentEdit(payment: Payment): void { this.editingPayment.set(payment); this.editPaymentAmount.set(payment.amount); this.editPaymentDate.set(payment.payment_date); this.editPaymentMethod.set(payment.payment_method); this.editPaymentNote.set(payment.note || ''); this.modal.set('edit-payment'); }
  async savePaymentEdit(): Promise<void> { const user = this.session(); const payment = this.editingPayment(); if (!user || !payment || this.editPaymentAmount() <= 0) { this.error.set('Payment amount must be greater than zero.'); return; } if (!confirm(`Update payment to ${this.currency(this.editPaymentAmount())}?`)) return; await this.run(async () => { await this.attendance.updatePayment(payment.id, this.editPaymentAmount(), this.editPaymentDate(), this.editPaymentMethod(), this.editPaymentNote(), user.id); this.closeModal(); await this.refresh(); this.message.set('Payment updated successfully.'); }); }
  async decide(record: AttendanceRecord, status: 'approved' | 'denied'): Promise<void> { const user = this.session(); if (!user || !confirm(`${status === 'approved' ? 'Approve' : 'Deny'} this attendance record?`)) return; await this.run(async () => { await this.attendance.updateApproval(record.id, status, user.id); await this.refresh(); this.message.set(`Attendance ${status} successfully.`); }); }
  openPayment(employee: Employee): void { this.selectedEmployee.set(employee); this.paymentTarget.set(employee); this.paymentAmount.set(0); this.paymentDate.set(this.today()); this.paymentNote.set(''); this.modal.set('payment'); void this.loadEmployeePayments(employee); }
  async confirmPayment(): Promise<void> { const employee = this.paymentTarget(); const user = this.session(); if (!employee || !user || this.paymentAmount() <= 0) { this.error.set('Payment amount must be greater than zero.'); return; } if (!confirm(`Process ${this.currency(this.paymentAmount())} for ${employee.name}?`)) return; await this.run(async () => { await this.attendance.processPayment(employee.id, this.paymentAmount(), this.paymentDate(), this.paymentMethod(), this.paymentNote(), user.id); this.closeModal(); await this.refresh(); this.message.set('Payment processed successfully using FIFO allocation.'); }); }
  async reverse(payment: Payment): Promise<void> { const user = this.session(); if (!user || payment.status === 'reversed' || !confirm('Reverse this payment? Its allocations will no longer count as paid.')) return; await this.run(async () => { await this.attendance.reversePayment(payment.id, user.id); const employee = this.paymentTarget() ?? this.currentEmployee(); if (employee) await this.loadEmployeePayments(employee); await this.refresh(); this.message.set('Payment reversed successfully.'); }); }
  async saveEmployee(): Promise<void> { const value = this.newEmployee(); if (!value.name.trim() || !value.mobile.trim() || value.default_daily_rate < 0) { this.error.set('Name, mobile number and a valid rate are required.'); return; } await this.run(async () => { let userId = value.user_id; if (!userId) userId = await this.attendance.createEmployeeLogin(value.mobile, value.mobile, value.name); const employeeCode = value.employee_code.trim().toUpperCase() || this.nextEmployeeCode(); await this.attendance.saveEmployee({ user_id: userId, name: value.name.trim(), employee_code: employeeCode, mobile: value.mobile.trim(), default_daily_rate: value.default_daily_rate, joining_date: value.joining_date, status: 'active' }); this.closeModal(); await this.refresh(); this.message.set(`Employee added with ID ${employeeCode}. Mobile number is the initial username and password.`); }); }
  nextEmployeeCode(): string { const highest = this.employees().reduce((max, employee) => { const match = employee.employee_code.match(/SH-(\d+)/i); return Math.max(max, match ? Number(match[1]) : 0); }, 0); return `SH-${String(highest + 1).padStart(3, '0')}`; }
  shareCredentials(employee: Employee): void { if (!employee.mobile) { this.error.set('This employee has no mobile number.'); return; } const text = `SURAKSHA HUB login\nUsername: ${employee.mobile}\nInitial password: ${employee.mobile}\nPlease change your password after signing in.`; window.location.href = `sms:${employee.mobile}?body=${encodeURIComponent(text)}`; }
  async changePassword(): Promise<void> { const user = this.session(); if (!user) return; await this.run(async () => { await this.attendance.updatePassword(user.id, this.passwordCurrent(), this.passwordNew()); this.closeModal(); this.passwordCurrent.set(''); this.passwordNew.set(''); this.message.set('Password updated successfully.'); }); }
  async forgotPassword(): Promise<void> { await this.run(async () => { await this.attendance.resetPassword(this.forgotUsername(), this.passwordNew()); this.closeModal(); this.forgotUsername.set(''); this.passwordNew.set(''); this.message.set('Password reset successfully.'); }); }
  async removeEmployee(employee: Employee): Promise<void> { if (!confirm(`Delete ${employee.name} (${employee.employee_code})? This is only allowed when no attendance or payment history exists.`)) return; await this.run(async () => { await this.attendance.deleteEmployee(employee.id); if (this.selectedEmployee()?.id === employee.id) this.selectedEmployee.set(null); await this.refresh(); this.message.set('Employee profile deleted.'); }); }
  formatType(type: AttendanceType): string { return type.replace('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
  getAttendanceTypeLabel(date: string): string { const record = this.recordFor(date); return record ? record.attendance_type.replace('_', ' ') : '—'; }
  toNumber(value: number | string): number { return Number(value); }
  currency(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0); }
  employeeEarned(employeeId: number | undefined): number { return this.records().filter(record => record.employee_id === employeeId && record.approval_status === 'approved').reduce((total, record) => total + Number(record.earned_amount), 0); }
  employeePaid(employeeId: number | undefined): number { return this.allPayments().filter(payment => payment.employee_id === employeeId && payment.status === 'completed').reduce((total, payment) => total + Number(payment.amount), 0); }
  employeeBalance(employeeId: number | undefined): number { return this.employeeEarned(employeeId) - this.employeePaid(employeeId); }
  recordFor(date: string): AttendanceRecord | undefined { return this.monthRecords().find(record => record.attendance_date === date); }
  dayClass(date: string): string { const record = this.recordFor(date); if (!record) return 'future'; if (record.approval_status === 'pending') return 'pending'; if (record.approval_status === 'denied') return 'denied'; if (record.outstanding_amount === 0 && record.earned_amount > 0) return 'paid'; if (record.paid_amount > 0) return 'partial'; if (record.attendance_type === 'half_day') return 'half'; if (record.attendance_type === 'leave') return 'leave'; return 'unpaid'; }
  closeModal(): void { this.modal.set(null); }
  today(): string { const now = new Date(); const year = now.getFullYear(); const month = String(now.getMonth() + 1).padStart(2, '0'); const day = String(now.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }
  isFutureDate(date: string): boolean { return date > this.today(); }
  private async run(action: () => Promise<void>): Promise<void> { this.busy.set(true); this.error.set(''); this.message.set(''); try { await action(); } catch (error) { this.error.set(this.readError(error)); } finally { this.busy.set(false); } }
  private readError(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
}
