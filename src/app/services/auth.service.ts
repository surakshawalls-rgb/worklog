import { Injectable } from '@angular/core';
import { AttendanceService, SessionUser } from './attendance.service';
import { User } from '../core/models/user.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(private readonly attendance: AttendanceService) {}
  getCurrentUser(): User | null { const session = this.attendance.getSession(); return session ? this.toUser(session) : null; }
  isLoggedIn(): boolean { return !!this.getCurrentUser(); }
  private toUser(session: SessionUser): User { return { id: session.id, username: session.username, displayName: session.name, email: null, isActive: true, createdAt: new Date().toISOString() }; }
}
