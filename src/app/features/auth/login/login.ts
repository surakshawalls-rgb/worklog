import { CommonModule } from '@angular/common';
import { Component, EventEmitter, inject, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AttendanceService,
  SessionUser
} from '../../../services/attendance.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent {
  private readonly attendance = inject(AttendanceService);

  @Output() loggedIn = new EventEmitter<SessionUser>();
  @Output() forgotPassword = new EventEmitter<void>();

  readonly username = signal('');
  readonly password = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  async login(): Promise<void> {
    if (this.busy()) return;

    const username = this.username().trim();
    const password = this.password();

    if (!username || !password) {
      this.error.set('Enter your username and password.');
      return;
    }

    this.busy.set(true);
    this.error.set('');

    try {
      const result = await this.attendance.login(username, password);

      if (result.error || !result.user) {
        this.error.set(result.error || 'Invalid username or password.');
        return;
      }

      this.password.set('');
      this.loggedIn.emit(result.user);
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

  openForgotPassword(): void {
    this.forgotPassword.emit();
  }
}