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
  readonly tab = signal<'overview' | 'approval' | 'payments' | 'receipts'>('overview');
  readonly selectedEmployee = signal<Employee | null>(null);
  readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly modal = signal<'attendance' | 'day' | 'payment' | 'employee' | 'admin-attendance' | 'bulk-attendance' | 'range-attendance' | 'admin-tools' | 'password' | 'announcement' | 'edit-payment' | 'receipt-view' | null>(null);
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
  readonly receiptEmployeeId = signal<number | null>(null);
  readonly receiptPayment = signal<Payment | null>(null);
  readonly receiptEmployee = signal<Employee | null>(null);
  readonly receiptYear = signal(new Date().getFullYear());
  readonly receiptMonth = signal(new Date().getMonth() + 1);
  readonly receiptStartDate = signal(this.today());
  readonly receiptEndDate = signal(this.today());
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
  readonly receiptYears = computed(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    this.records().forEach(r => years.add(Number(r.attendance_date.slice(0, 4))));
    this.allPayments().forEach(p => years.add(Number(p.payment_date.slice(0, 4))));
    return Array.from(years).filter(Boolean).sort((a, b) => b - a);
  });
  readonly receiptMonths = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i, 1).toLocaleDateString('en-IN', { month: 'long' }) }));
  readonly receiptMonthStart = computed(() => `${this.receiptYear()}-${String(this.receiptMonth()).padStart(2, '0')}-01`);
  readonly receiptMonthEnd = computed(() => {
    const last = new Date(this.receiptYear(), this.receiptMonth(), 0).getDate();
    return `${this.receiptYear()}-${String(this.receiptMonth()).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  });
  readonly receiptPayments = computed(() => {
    const employeeId = this.receiptEmployeeId();
    const start = this.receiptMonthStart();
    const end = this.receiptMonthEnd();
    return this.allPayments().filter(p => p.status === 'completed' && p.payment_date >= start && p.payment_date <= end && (employeeId === null || p.employee_id === employeeId)).sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.id - a.id);
  });
  readonly receiptMonthPayments = computed(() => {
    const employeeId = this.receiptEmployee()?.id;
    if (!employeeId) return [];
    return this.allPayments().filter(p => p.employee_id === employeeId && p.status === 'completed' && p.payment_date >= this.receiptStartDate() && p.payment_date <= this.receiptEndDate()).sort((a, b) => a.payment_date.localeCompare(b.payment_date) || a.id - b.id);
  });
  readonly receiptNumber = computed(() => {
    const payment = this.receiptPayment();
    return payment ? `SH-PAY-${String(payment.id).padStart(6, '0')}` : `SH-${this.receiptYear()}${String(this.receiptMonth()).padStart(2, '0')}`;
  });
  readonly receiptWorkDays = computed(() => {
    const id = this.receiptEmployee()?.id;
    if (!id) return 0;
    return this.records().filter(r => r.employee_id === id && r.approval_status === 'approved' && Number(r.earned_amount) > 0 && r.attendance_date >= this.receiptStartDate() && r.attendance_date <= this.receiptEndDate()).length;
  });
  readonly receiptPeriodEarnings = computed(() => {
    const id = this.receiptEmployee()?.id;
    if (!id) return 0;
    return this.records().filter(r => r.employee_id === id && r.approval_status === 'approved' && r.attendance_date >= this.receiptStartDate() && r.attendance_date <= this.receiptEndDate()).reduce((sum, r) => sum + Number(r.earned_amount), 0);
  });
  readonly receiptPreviousBalance = computed(() => {
    const id = this.receiptEmployee()?.id;
    const start = this.receiptStartDate();
    if (!id || !start) return 0;
    const earned = this.records().filter(r => r.employee_id === id && r.approval_status === 'approved' && r.attendance_date < start).reduce((sum, r) => sum + Number(r.earned_amount), 0);
    const paid = this.allPayments().filter(p => p.employee_id === id && p.status === 'completed' && p.payment_date < start).reduce((sum, p) => sum + Number(p.amount), 0);
    return earned - paid;
  });
  readonly receiptMonthlyPaid = computed(() => this.receiptMonthPayments().reduce((sum, p) => sum + Number(p.amount), 0));
  readonly receiptRemainingBalance = computed(() => this.receiptPreviousBalance() + this.receiptPeriodEarnings() - this.receiptMonthlyPaid());
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
  employeeForPayment(employeeId: number): Employee | undefined { return this.employees().find(employee => employee.id === employeeId); }

  openReceipt(payment: Payment): void {
    if (payment.status !== 'completed') { this.error.set('Only completed payments can have receipts.'); return; }
    const employee = this.employeeForPayment(payment.employee_id);
    if (!employee) { this.error.set('Employee profile not found.'); return; }
    const date = new Date(`${payment.payment_date}T00:00:00`);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    this.receiptYear.set(year);
    this.receiptMonth.set(month);
    this.receiptPayment.set(payment);
    this.receiptEmployee.set(employee);
    this.receiptStartDate.set(`${year}-${String(month).padStart(2, '0')}-01`);
    this.receiptEndDate.set(`${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`);
    this.modal.set('receipt-view');
  }

  viewReceipt(payment: Payment): void {
    this.openReceipt(payment);
  }

  selectReceiptMonth(): void {
    const start = this.receiptMonthStart();
    const end = this.receiptMonthEnd();
    const employee = this.receiptEmployeeId() === null
      ? null
      : this.employeeForPayment(this.receiptEmployeeId()!);

    // Changing the receipt filters must only refresh the list.
    // Never open a receipt automatically; the user must click View.
    this.receiptPayment.set(null);
    this.receiptEmployee.set(employee ?? null);
    this.receiptStartDate.set(start);
    this.receiptEndDate.set(end);

    if (this.modal() === 'receipt-view') {
      this.closeModal();
    }
  }

  saveReceiptPeriod(): void {
    const payment = this.receiptPayment();
    if (!payment) return;
    if (this.receiptStartDate() > this.receiptEndDate()) { this.error.set('Receipt start date cannot be after the end date.'); return; }
    if (this.receiptEndDate() > payment.payment_date) { this.error.set('Receipt period cannot end after the payment date.'); return; }
    this.closeModal();
  }

  private formatReceiptDate(value: string): string {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private pdfEscape(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
  private makeReceiptPdf(): Blob | null {
    const employee = this.receiptEmployee();
    if (!employee) return null;

    const esc = (value: string) => this.pdfEscape(value.replace(/₹/g, 'Rs.'));
    const money = (value: number) => esc(this.currency(value));
    const pageWidth = 595;
    const pageHeight = 842;
    const left = 42;
    const right = 553;
    const contentWidth = right - left;

    const commands: string[] = [];
    const text = (value: string, x: number, y: number, size = 10, bold = false) => {
      commands.push(`${bold ? '/F2' : '/F1'} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj`);
    };
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
    };
    const fillRect = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
      commands.push(`${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f 0 0 0 rg`);
    };
    const strokeRect = (x: number, y: number, w: number, h: number) => {
      commands.push(`${x} ${y} ${w} ${h} re S`);
    };

    // Header
    fillRect(left, 758, 56, 56, 0.06, 0.17, 0.14);
    text('SG', left + 14, 779, 20, true);
    text('SURAKSHA GROUP', left + 70, 796, 13, true);
    text('PAYMENT RECEIPT', left + 70, 776, 21, true);
    text('Employee wage payment statement', left + 70, 759, 9);

    text('RECEIPT NO.', 420, 797, 8, true);
    text(this.receiptNumber(), 420, 782, 11, true);
    text(this.formatReceiptDate(this.receiptPayment()?.payment_date || ''), 420, 766, 9);

    line(left, 744, right, 744);

    // Employee information card
    fillRect(left, 650, contentWidth, 72, 0.965, 0.976, 0.969);
    strokeRect(left, 650, contentWidth, 72);
    text('EMPLOYEE', left + 14, 701, 8, true);
    text(employee.name, left + 14, 684, 13, true);
    text(`${employee.employee_code}  |  ${employee.mobile || 'Mobile not available'}`, left + 14, 668, 9);

    text('DAILY RATE', 390, 701, 8, true);
    text(this.currency(employee.default_daily_rate), 390, 684, 12, true);

    // Period
    text('STATEMENT PERIOD', left, 625, 8, true);
    text(`${this.formatReceiptDate(this.receiptStartDate())}  -  ${this.formatReceiptDate(this.receiptEndDate())}`, left, 607, 12, true);
    text(`Approved work days: ${this.receiptWorkDays()}`, 390, 607, 9);

    line(left, 590, right, 590);

    // Financial summary
    text('PAYMENT SUMMARY', left, 570, 9, true);
    const rows: Array<[string, string]> = [
      ['Earnings in selected period', this.currency(this.receiptPeriodEarnings())],
      [this.receiptPreviousBalance() < 0 ? 'Previous advance' : 'Previous outstanding', this.currency(Math.abs(this.receiptPreviousBalance()))],
      ['Payments made in selected period', this.currency(this.receiptMonthlyPaid())]
    ];
    let y = 546;
    rows.forEach(([label, value]) => {
      text(label, left + 4, y, 10);
      text(value, 450, y, 10, true);
      line(left, y - 10, right, y - 10);
      y -= 30;
    });

    const balance = this.receiptRemainingBalance();
    fillRect(left, y - 5, contentWidth, 45, balance < 0 ? 1 : 0.93, balance < 0 ? 0.96 : 0.965, balance < 0 ? 0.95 : 0.94);
    text(balance < 0 ? 'REMAINING ADVANCE' : 'REMAINING BALANCE', left + 14, y + 17, 9, true);
    text(this.currency(Math.abs(balance)), 430, y + 14, 15, true);
    y -= 68;

    // Payment breakdown
    const periodPayments = this.receiptMonthPayments();
    text('PAYMENT ACTIVITY', left, y, 9, true);
    y -= 20;
    text('DATE', left, y, 8, true);
    text('METHOD', 285, y, 8, true);
    text('AMOUNT', 460, y, 8, true);
    line(left, y - 7, right, y - 7);
    y -= 24;

    periodPayments.slice(0, 12).forEach(payment => {
      text(this.formatReceiptDate(payment.payment_date), left, y, 9);
      text(String(payment.payment_method).replace(/_/g, ' '), 285, y, 9);
      text(this.currency(payment.amount), 460, y, 9, true);
      y -= 20;
    });
    if (periodPayments.length > 12) {
      text(`+ ${periodPayments.length - 12} more payment(s)`, left, y, 8);
      y -= 20;
    }

    // Footer
    line(left, 92, right, 92);
    text('For enquiry & assistance', left, 74, 8, true);
    text('Pradeep Vishwakarma  |  Mo. 9506629814', left, 58, 8);
    text('Praveen Pandey  |  Mo. 8090272727', left, 44, 8);
    text('www.surakshawalls.space', 390, 58, 8, true);
    text('Computer-generated receipt issued by Suraksha Group', 170, 25, 7);

    const content = ['q', '0 0 0 RG', '0.7 w', ...commands, 'Q'].join('\n');
    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((obj, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => pdf += `${String(offset).padStart(10, '0')} 00000 n \n`);
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
  }

  downloadReceiptPdf(): void {
    const pdf = this.makeReceiptPdf();
    const employee = this.receiptEmployee();
    if (!pdf || !employee) {
      this.error.set('Open a receipt before downloading the PDF.');
      return;
    }
    const url = URL.createObjectURL(pdf);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.receiptNumber()}-${employee.employee_code}.pdf`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  downloadReceiptForPayment(payment: Payment): void {
    this.openReceipt(payment);
    setTimeout(() => this.downloadReceiptPdf(), 100);
  }

  printReceiptForPayment(payment: Payment): void {
    this.downloadReceiptForPayment(payment);
  }

  printReceipt(): void {
    this.downloadReceiptPdf();
  }

  payEmployeeViaUpi(): void {
    const employee = this.receiptEmployee();
    if (!employee?.mobile) { this.error.set('This employee has no mobile number.'); return; }

    const mobile = employee.mobile.replace(/\D/g, '');
    if (!mobile) { this.error.set('Employee mobile number is invalid.'); return; }

    const amount = Math.max(0, Number(this.receiptMonthlyPaid()));
    const note = `Suraksha Group payment - ${employee.name}`;
    const upiUrl =
      `upi://pay?pa=${encodeURIComponent(`${mobile}@upi`)}` +
      `&pn=${encodeURIComponent(employee.name)}` +
      (amount > 0 ? `&am=${encodeURIComponent(amount.toFixed(2))}` : '') +
      `&cu=INR&tn=${encodeURIComponent(note)}`;

    window.location.href = upiUrl;
  }

  async shareReceiptWhatsApp(payment: Payment = this.receiptPayment() as Payment): Promise<void> {
    if (!payment) return;
    this.openReceipt(payment);
    const employee = this.employeeForPayment(payment.employee_id);
    if (!employee?.mobile) { this.error.set('This employee has no mobile number.'); return; }

    await new Promise(resolve => setTimeout(resolve, 180));
    const pdf = this.makeReceiptPdf();
    const file = pdf ? new File([pdf], `${this.receiptNumber()}-${employee.employee_code}.pdf`, { type: 'application/pdf' }) : null;
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data?: ShareData) => boolean;
    };

    if (file && nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      try {
        await nav.share({
          title: `Suraksha Group - ${this.receiptNumber()}`,
          text: `Monthly wage statement for ${employee.name}`,
          files: [file]
        });
        return;
      } catch { }
    }

    const balance = this.receiptRemainingBalance();
    const text = `SURAKSHA GROUP – PAYMENT RECEIPT
Receipt: ${this.receiptNumber()}
Employee: ${employee.name} (${employee.employee_code})
Period: ${this.formatReceiptDate(this.receiptStartDate())} to ${this.formatReceiptDate(this.receiptEndDate())}
Work days: ${this.receiptWorkDays()}
Period earnings: ${this.currency(this.receiptPeriodEarnings())}
Payment made: ${this.currency(this.receiptMonthlyPaid())}
${balance < 0 ? 'Remaining advance' : 'Remaining balance'}: ${this.currency(Math.abs(balance))}`;

    // Keep navigation in the current Android WebView/tab so Back returns to SURAKSHA HUB.
    window.location.href = `https://wa.me/${employee.mobile.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
  }


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
