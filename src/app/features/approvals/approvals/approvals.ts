import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import {
  AttendanceRecord,
  AttendanceService,
  Employee
} from '../../../services/attendance.service';

@Component({
  selector: 'app-approvals',
  imports: [CommonModule],
  templateUrl: './approvals.html',
  styleUrl: './approvals.scss'
})
export class ApprovalsComponent {
  private readonly attendance = inject(AttendanceService);

  @Input() records: AttendanceRecord[] = [];
  @Input() employees: Employee[] = [];

  @Output() refreshRequested = new EventEmitter<void>();

  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');

  employeeName(employeeId: number): string {
    return this.employees.find(employee => employee.id === employeeId)?.name || 'Employee';
  }

  pendingRecords(): AttendanceRecord[] {
    return this.records
      .filter(record => record.approval_status === 'pending')
      .sort((a, b) => {
        const dateCompare = b.attendance_date.localeCompare(a.attendance_date);
        return dateCompare || b.id - a.id;
      });
  }

  async decide(
    record: AttendanceRecord,
    status: 'approved' | 'denied'
  ): Promise<void> {
    if (this.busy()) return;

    const action = status === 'approved' ? 'Approve' : 'Deny';

    if (!confirm(`${action} this attendance record?`)) {
      return;
    }

    const user = this.attendance.getSession();

    if (!user) {
      this.error.set('Your session has expired. Please log in again.');
      return;
    }

    this.busy.set(true);
    this.error.set('');
    this.message.set('');

    try {
      await this.attendance.updateApproval(record.id, status, user.id);

      this.message.set(
        `Attendance ${status} successfully.`
      );

      this.refreshRequested.emit();
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Unable to update attendance approval.'
      );
    } finally {
      this.busy.set(false);
    }
  }

  refresh(): void {
    if (this.busy()) return;

    this.error.set('');
    this.message.set('');
    this.refreshRequested.emit();
  }

  attendanceTypeLabel(type: string): string {
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, character => character.toUpperCase());
  }

  formatDate(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  currency(value: number | string): string {
    return `₹${Number(value || 0).toLocaleString('en-IN', {
      maximumFractionDigits: 2
    })}`;
  }

  /* APPROVAL HISTORY METHODS START */

  approvalHistory(): AttendanceRecord[] {

    type ApprovalRecord = AttendanceRecord & {
      approved_at?: string | null;
    };

    return this.records
      .filter(
        record =>
          record.approval_status === 'approved' ||
          record.approval_status === 'denied'
      )
      .map(record => record as ApprovalRecord)
      .sort((a, b) => {

        const aDate =
          a.approved_at ||
          a.attendance_date ||
          '';

        const bDate =
          b.approved_at ||
          b.attendance_date ||
          '';

        const aTime =
          new Date(aDate).getTime() || 0;

        const bTime =
          new Date(bDate).getTime() || 0;

        if (bTime !== aTime) {
          return bTime - aTime;
        }

        return b.id - a.id;
      })
      .slice(0, 10);
  }

  approvalDate(record: AttendanceRecord): string {

    const value =
      (record as AttendanceRecord & {
        approved_at?: string | null;
      }).approved_at ||
      record.attendance_date;

    if (!value) {
      return '-';
    }

    return new Date(value).toLocaleDateString(
      'en-IN',
      {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }
    );
  }

  approvalTime(record: AttendanceRecord): string {

    const value =
      (record as AttendanceRecord & {
        approved_at?: string | null;
      }).approved_at;

    if (!value) {
      return '';
    }

    return new Date(value).toLocaleTimeString(
      'en-IN',
      {
        hour: 'numeric',
        minute: '2-digit'
      }
    );
  }

  /* APPROVAL HISTORY METHODS END */
}

