import { CommonModule } from '@angular/common';
import {
  Component,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterOutlet } from '@angular/router';

import {
  AttendanceRecord,
  AttendanceService,
  DailyAnnouncement,
  Employee,
  Payment,
  SessionUser,
  UserOption
} from './services/attendance.service';

import { LoginComponent } from './features/auth/login/login';
import { DashboardComponent } from './features/dashboard/dashboard/dashboard';
import { AttendanceComponent } from './features/attendance/attendance/attendance';
import { EmployeesComponent } from './features/employees/employees/employees';
import { ApprovalsComponent } from './features/approvals/approvals/approvals';
import { PaymentsComponent } from './features/payments/payments/payments';
import { ReceiptsComponent } from './features/receipts/receipts/receipts';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterOutlet,
    LoginComponent,
    DashboardComponent,
    AttendanceComponent,
    EmployeesComponent,
    ApprovalsComponent,
    PaymentsComponent,
    ReceiptsComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private readonly attendance = inject(AttendanceService);
  private readonly router = inject(Router);

  @ViewChild(AttendanceComponent)
  private attendanceFeature?: AttendanceComponent;

  @ViewChild(EmployeesComponent)
  private employeesFeature?: EmployeesComponent;

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

  readonly tab = signal<
    'overview' | 'attendance' | 'employees' | 'approval' | 'payments' | 'receipts'
  >('overview');

  readonly modal = signal<'password' | 'announcement' | null>(null);

  readonly passwordCurrent = signal('');
  readonly passwordNew = signal('');
  readonly forgotUsername = signal('');
  readonly announcementText = signal('');

  readonly pendingRecords = computed(() =>
    this.records().filter(record => record.approval_status === 'pending')
  );

  readonly approvedCount = computed(() =>
    this.records().filter(record => record.approval_status === 'approved').length
  );

  readonly totalOutstanding = computed(() =>
    this.records()
      .filter(record => record.approval_status === 'approved')
      .reduce((total, record) => total + Number(record.outstanding_amount || 0), 0)
  );

  readonly isCommunicationRoute = computed(() => {
    const url = this.router.url;
    return (
      url.startsWith('/chats') ||
      url.startsWith('/chat/') ||
      url.startsWith('/people') ||
      url.startsWith('/profile') ||
      url.startsWith('/call/')
    );
  });

  ngOnInit(): void {
    void this.init();
  }

  async init(): Promise<void> {
    if (this.session()) {
      await this.refresh();
    }
  }

  async refresh(): Promise<void> {
    if (!this.session()) return;

    await this.run(async () => {
      this.employees.set(await this.attendance.loadEmployees());
      this.users.set(await this.attendance.loadUsers());
      this.records.set(await this.attendance.loadAllAttendance());
      this.allPayments.set(await this.attendance.loadAllPayments());
      this.announcement.set(await this.attendance.loadActiveAnnouncement());

      const employee = this.employees().find(
        item => item.user_id === this.session()?.id
      );

      if (employee) {
        this.payments.set(await this.attendance.loadPayments(employee.id));
      } else {
        this.payments.set([]);
      }

      // Attendance is a self-contained feature, so refresh it when it is mounted.
      if (this.attendanceFeature) {
        await this.attendanceFeature.refresh();
      }
    });
  }

  async onLoggedIn(user: SessionUser): Promise<void> {
    this.session.set(user);
    this.tab.set(user.role === 'admin' ? 'overview' : 'attendance');
    await this.refresh();
  }

  onForgotPassword(): void {
    this.passwordCurrent.set('');
    this.passwordNew.set('');
    this.forgotUsername.set('');
    this.error.set('');
    this.message.set('');
    this.modal.set('password');
  }

  logout(): void {
    this.attendance.logout();
    this.session.set(null);
    this.tab.set('overview');
    this.modal.set(null);
    this.message.set('');
    this.error.set('');
  }

  openCommunication(): void {
    void this.router.navigate(['/chats']);
  }

  openPassword(): void {
    this.error.set('');
    this.message.set('');
    this.modal.set('password');
  }

  openAnnouncementEditor(): void {
    this.announcementText.set(this.announcement()?.message || '');
    this.error.set('');
    this.message.set('');
    this.modal.set('announcement');
  }

  async saveAnnouncement(): Promise<void> {
    const user = this.session();
    const text = this.announcementText().trim();

    if (!user) return;

    if (!text) {
      this.error.set('Enter today’s work plan before posting.');
      return;
    }

    await this.run(async () => {
      await this.attendance.publishDailyAnnouncement(text, user.id);
      this.announcement.set(await this.attendance.loadActiveAnnouncement());
      this.closeModal();
      this.message.set('Today’s work plan is visible until 8:00 PM.');
    });
  }

  async changePassword(): Promise<void> {
    const user = this.session();

    if (!user) return;

    if (!this.passwordCurrent() || !this.passwordNew()) {
      this.error.set('Enter your current and new password.');
      return;
    }

    await this.run(async () => {
      await this.attendance.updatePassword(
        user.id,
        this.passwordCurrent(),
        this.passwordNew()
      );

      this.passwordCurrent.set('');
      this.passwordNew.set('');
      this.closeModal();
      this.message.set('Password updated successfully.');
    });
  }

  async forgotPassword(): Promise<void> {
    const username = this.forgotUsername().trim();
    const newPassword = this.passwordNew();

    if (!username || !newPassword) {
      this.error.set('Enter the username/mobile and new password.');
      return;
    }

    await this.run(async () => {
      await this.attendance.resetPassword(username, newPassword);
      this.forgotUsername.set('');
      this.passwordNew.set('');
      this.closeModal();
      this.message.set('Password reset successfully.');
    });
  }

  selectTab(tab: 'overview' | 'attendance' | 'employees' | 'approval' | 'payments' | 'receipts'): void {
    this.tab.set(tab);
    this.error.set('');
    this.message.set('');
  }

  openEmployeeManager(): void {
    this.selectTab('employees');

    setTimeout(() => {
      this.employeesFeature?.openAddEmployee();
    });
  }

  onEmployeeSelected(employee: Employee): void {
    this.selectTab('attendance');

    setTimeout(() => {
      this.attendanceFeature?.selectEmployee(employee);
    });
  }

  onAttendanceRequested(employee: Employee): void {
    this.selectTab('attendance');

    setTimeout(() => {
      this.attendanceFeature?.selectEmployee(employee);
      this.attendanceFeature?.openDay(this.today());
    });
  }

  onFeatureRefresh(): void {
    void this.refresh();
  }

  onDashboardRefresh(): void {
    void this.refresh();
  }

  currency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(value || 0);
  }

  async removeEmployee(employee: Employee): Promise<void> {
    const confirmed = confirm(
      `Delete ${employee.name} (${employee.employee_code})?\n\n` +
      `This is only allowed when no attendance or payment history exists.`
    );

    if (!confirmed) return;

    await this.run(async () => {
      await this.attendance.deleteEmployee(employee.id);
      await this.refresh();
      this.message.set('Employee profile deleted.');
    });
  }

  shareCredentials(employee: Employee): void {
    if (!employee.mobile) {
      this.error.set('This employee has no mobile number.');
      return;
    }

    const text =
      `SURAKSHA HUB login\n` +
      `Username: ${employee.mobile}\n` +
      `Initial password: ${employee.mobile}\n` +
      `Please change your password after signing in.`;

    window.location.href = `sms:${employee.mobile}?body=${encodeURIComponent(text)}`;
  }

  closeModal(): void {
    this.modal.set(null);
    this.error.set('');
  }

  today(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;

    this.busy.set(true);
    this.error.set('');
    this.message.set('');

    try {
      await action();
    } catch (error) {
      this.error.set(this.readError(error));
    } finally {
      this.busy.set(false);
    }
  }

  private readError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Something went wrong. Please try again.';
  }
}
