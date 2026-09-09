import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  Output,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  AttendanceRecord,
  AttendanceService,
  Employee,
  Payment,
  UserOption
} from '../../../services/attendance.service';

import { ConversationService } from '../../../services/conversation.service';

@Component({
  selector: 'app-employees',
  imports: [
    CommonModule,
    FormsModule
  ],
  templateUrl: './employees.html',
  styleUrl: './employees.scss'
})
export class EmployeesComponent {
  @Input() employees: Employee[] = [];
  @Input() users: UserOption[] = [];
  @Input() records: AttendanceRecord[] = [];
  @Input() allPayments: Payment[] = [];

  @Output() employeeSelected =
    new EventEmitter<Employee>();

  @Output() attendanceRequested =
    new EventEmitter<Employee>();

  @Output() refreshRequested =
    new EventEmitter<void>();

  readonly showAddForm = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');

  /*
   * Holds the user ID of the employee whose chat
   * conversation is currently being opened.
   */
  readonly chattingUserId =
    signal<number | null>(null);

  readonly newEmployee = signal({
    name: '',
    employee_code: '',
    mobile: '',
    default_daily_rate: 500,
    joining_date: this.today(),
    user_id: null as number | null
  });

  constructor(
    private readonly attendance: AttendanceService,
    private readonly conversationService: ConversationService,
    private readonly router: Router
  ) {}

  readonly availableUsers = () => {
    const linkedUserIds = new Set(
      this.employees
        .map(employee => employee.user_id)
        .filter(
          (id): id is number =>
            id !== null
        )
    );

    return this.users.filter(
      user => !linkedUserIds.has(user.id)
    );
  };

  /*
   * Total approved earnings for this employee.
   */
  employeeEarned(
    employee: Employee
  ): number {
    return this.records
      .filter(
        record =>
          record.employee_id === employee.id &&
          record.approval_status === 'approved'
      )
      .reduce(
        (total, record) =>
          total + Number(record.earned_amount || 0),
        0
      );
  }

  /*
   * Total completed payments made to this employee.
   */
  employeePaid(
    employee: Employee
  ): number {
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
  }

  /*
   * Positive balance = employee is still owed money.
   * Negative balance = employee has received an advance.
   * Zero = completely settled.
   */
  employeeBalance(
    employee: Employee
  ): number {
    return (
      this.employeeEarned(employee) -
      this.employeePaid(employee)
    );
  }

  /*
   * Display label for employee balance.
   */
  employeeBalanceLabel(
    employee: Employee
  ): string {
    const balance =
      this.employeeBalance(employee);

    if (balance > 0) {
      return 'Pending';
    }

    if (balance < 0) {
      return 'Advance';
    }

    return 'Settled';
  }

  /*
   * Always display the balance as a positive amount.
   * The label tells whether it is Pending or Advance.
   */
  employeeBalanceAmount(
    employee: Employee
  ): number {
    return Math.abs(
      this.employeeBalance(employee)
    );
  }

  openAddEmployee(): void {
    this.error.set('');
    this.message.set('');

    this.newEmployee.set({
      name: '',
      employee_code: '',
      mobile: '',
      default_daily_rate: 500,
      joining_date: this.today(),
      user_id: null
    });

    this.showAddForm.set(true);
  }

  closeAddEmployee(): void {
    if (this.busy()) {
      return;
    }

    this.showAddForm.set(false);
    this.error.set('');
  }

  updateName(
    value: string
  ): void {
    this.newEmployee.update(
      employee => ({
        ...employee,
        name: value
      })
    );
  }

  updateEmployeeCode(
    value: string
  ): void {
    this.newEmployee.update(
      employee => ({
        ...employee,
        employee_code: value
      })
    );
  }

  updateMobile(
    value: string
  ): void {
    this.newEmployee.update(
      employee => ({
        ...employee,
        mobile: value
      })
    );
  }

  updateDailyRate(
    value: number | string
  ): void {
    this.newEmployee.update(
      employee => ({
        ...employee,
        default_daily_rate:
          Number(value) || 0
      })
    );
  }

  updateJoiningDate(
    value: string
  ): void {
    this.newEmployee.update(
      employee => ({
        ...employee,
        joining_date: value
      })
    );
  }

  updateUser(
    value: number | string | null
  ): void {
    this.newEmployee.update(
      employee => ({
        ...employee,
        user_id: value
          ? Number(value)
          : null
      })
    );
  }

  /*
   * Open or create a conversation with the selected employee.
   *
   * The existing ConversationService handles the
   * get-or-create logic.
   */
  async openChat(
    employee: Employee,
    event?: Event
  ): Promise<void> {
    event?.stopPropagation();

    if (this.chattingUserId() !== null) {
      return;
    }

    if (!employee.user_id) {
      this.error.set(
        `${employee.name} does not have a linked login account, so chat is not available.`
      );
      return;
    }

    const currentUser =
      this.attendance.getSession();

    if (!currentUser) {
      this.error.set(
        'Please log in again to start a chat.'
      );
      return;
    }

    if (
      employee.user_id === currentUser.id
    ) {
      this.error.set(
        'You cannot start a chat with your own account.'
      );
      return;
    }

    this.chattingUserId.set(
      employee.user_id
    );

    this.error.set('');
    this.message.set('');

    try {
      const conversationId =
        await this.conversationService
          .getOrCreateConversation(
            currentUser.id,
            employee.user_id
          );

      if (!conversationId) {
        throw new Error(
          `Unable to create or find a conversation with ${employee.name}.`
        );
      }

      await this.router.navigate(
        ['/chat', conversationId],
        {
          state: {
            otherDisplayName:
              employee.name,
            otherUserId:
              employee.user_id
          }
        }
      );
    } catch (error) {
      this.error.set(
        this.readError(error)
      );
    } finally {
      this.chattingUserId.set(null);
    }
  }

  async saveEmployee(): Promise<void> {
    if (this.busy()) {
      return;
    }

    const value =
      this.newEmployee();

    this.error.set('');
    this.message.set('');

    if (!value.name.trim()) {
      this.error.set(
        'Employee name is required.'
      );
      return;
    }

    if (!value.mobile.trim()) {
      this.error.set(
        'Mobile number is required.'
      );
      return;
    }

    if (
      value.default_daily_rate < 0
    ) {
      this.error.set(
        'Daily rate cannot be negative.'
      );
      return;
    }

    if (!value.joining_date) {
      this.error.set(
        'Joining date is required.'
      );
      return;
    }

    this.busy.set(true);

    try {
      let userId =
        value.user_id;

      /*
       * If no existing account is selected,
       * create a new employee login using
       * the mobile number.
       */
      if (!userId) {
        userId =
          await this.attendance
            .createEmployeeLogin(
              value.mobile.trim(),
              value.mobile.trim(),
              value.name.trim()
            );
      }

      const employeeCode =
        value.employee_code
          .trim()
          .toUpperCase() ||
        this.nextEmployeeCode();

      await this.attendance.saveEmployee({
        user_id: userId,
        name: value.name.trim(),
        employee_code:
          employeeCode,
        mobile:
          value.mobile.trim(),
        default_daily_rate:
          value.default_daily_rate,
        joining_date:
          value.joining_date,
        status: 'active'
      });

      this.showAddForm.set(false);

      this.message.set(
        `Employee added with ID ${employeeCode}. Mobile number is the initial username and password.`
      );

      this.refreshRequested.emit();
    } catch (error) {
      this.error.set(
        this.readError(error)
      );
    } finally {
      this.busy.set(false);
    }
  }

  nextEmployeeCode(): string {
    const highest =
      this.employees.reduce(
        (max, employee) => {
          const match =
            employee.employee_code.match(
              /SH-(\d+)/i
            );

          return Math.max(
            max,
            match
              ? Number(match[1])
              : 0
          );
        },
        0
      );

    return `SH-${String(
      highest + 1
    ).padStart(3, '0')}`;
  }

  async removeEmployee(
    employee: Employee
  ): Promise<void> {
    if (this.busy()) {
      return;
    }

    const confirmed =
      confirm(
        `Delete ${employee.name} (${employee.employee_code})?\n\n` +
        `This is only allowed when no attendance or payment history exists.`
      );

    if (!confirmed) {
      return;
    }

    this.busy.set(true);
    this.error.set('');
    this.message.set('');

    try {
      await this.attendance
        .deleteEmployee(
          employee.id
        );

      this.message.set(
        `${employee.name} was deleted successfully.`
      );

      this.refreshRequested.emit();
    } catch (error) {
      this.error.set(
        this.readError(error)
      );
    } finally {
      this.busy.set(false);
    }
  }

  shareCredentials(
    employee: Employee
  ): void {
    if (!employee.mobile) {
      this.error.set(
        'This employee has no mobile number.'
      );
      return;
    }

    const text =
      `SURAKSHA HUB login\n` +
      `Username: ${employee.mobile}\n` +
      `Initial password: ${employee.mobile}\n` +
      `Please change your password after signing in.`;

    window.location.href =
      `sms:${employee.mobile}?body=${encodeURIComponent(
        text
      )}`;
  }

  selectEmployee(
    employee: Employee
  ): void {
    this.employeeSelected.emit(
      employee
    );
  }

  openAttendance(
    employee: Employee
  ): void {
    this.attendanceRequested.emit(
      employee
    );
  }

  refresh(): void {
    this.refreshRequested.emit();
  }

  currency(
    value: number
  ): string {
    return new Intl.NumberFormat(
      'en-IN',
      {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
      }
    ).format(value || 0);
  }

  private today(): string {
    const now = new Date();

    const year =
      now.getFullYear();

    const month =
      String(
        now.getMonth() + 1
      ).padStart(2, '0');

    const day =
      String(
        now.getDate()
      ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private readError(
    error: unknown
  ): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Something went wrong. Please try again.';
  }
}