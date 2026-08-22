import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AttendanceService } from '../../services/attendance.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="profile-page">
      <header class="profile-header"><button class="back-button" (click)="goBack()">&#8592;</button><h1>Profile</h1><span></span></header>
      <main class="profile-content">
        <div class="profile-avatar">{{ session?.name?.charAt(0)?.toUpperCase() }}</div>
        <h2>{{ session?.name }}</h2><p class="muted">{{ session?.username }}</p>
        <div class="profile-card"><div><span>Role</span><b>{{ session?.role }}</b></div><div><span>Account</span><b>Active</b></div></div>
        <button class="profile-action" (click)="goBack()">Back to attendance</button>
      </main>
    </div>
  `,
  styles: [`
    :host { display:block; min-height:100vh; background:#f5f7f5; color:#16251e; }
    .profile-header { height:72px; padding:0 5vw; display:flex; align-items:center; justify-content:space-between; background:#102c23; color:#f6f4ed; }
    .profile-header h1 { font:500 25px Georgia,serif; margin:0; }.back-button { background:transparent; border:0; color:inherit; font-size:24px; cursor:pointer; }
    .profile-content { max-width:520px; margin:0 auto; padding:60px 24px; text-align:center; }.profile-avatar { width:82px; height:82px; margin:0 auto 18px; border-radius:50%; display:grid; place-items:center; background:#d8a947; color:#102c23; font-size:34px; font-weight:800; }
    .profile-content h2 { font:500 32px Georgia,serif; margin:0 0 6px; }.muted { color:#66756c; }.profile-card { background:#fff; border:1px solid #e0e8e1; border-radius:10px; margin:30px 0 18px; text-align:left; }.profile-card div { display:flex; justify-content:space-between; padding:16px; border-bottom:1px solid #edf1ed; text-transform:capitalize; }.profile-card div:last-child { border:0; }.profile-card span { color:#728077; }.profile-action { width:100%; border:0; border-radius:8px; padding:13px; background:#d8a947; color:#102c23; font-weight:700; cursor:pointer; }
  `]
})
export class ProfileComponent {
  readonly session = inject(AttendanceService).getSession();
  private readonly router = inject(Router);
  goBack(): void { this.router.navigate(['/']); }
}
