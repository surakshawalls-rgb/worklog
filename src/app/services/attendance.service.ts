import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';
import { environment } from '../../environments/environment';

export type AttendanceType = 'full_day' | 'half_day' | 'leave' | 'custom';
export type ApprovalStatus = 'pending' | 'approved' | 'denied';
export type PaymentStatus = 'completed' | 'reversed';

export interface SessionUser { id: number; name: string; username: string; role: 'admin' | 'employee'; }
export interface UserOption { id: number; username: string; display_name: string | null; role: string; }
export interface Employee { id: number; user_id: number | null; employee_code: string; name: string; mobile: string | null; default_daily_rate: number; joining_date: string; status: 'active' | 'inactive'; }
export interface AttendanceRecord { id: number; employee_id: number; attendance_date: string; attendance_type: AttendanceType; daily_rate: number; earned_amount: number; approval_status: ApprovalStatus; note: string | null; approved_by: number | null; approved_by_name: string | null; paid_amount: number; outstanding_amount: number; }
export interface Payment { id: number; employee_id: number; amount: number; payment_date: string; payment_method: string; note: string | null; status: PaymentStatus; created_by: number | null; created_at: string; }

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly client: SupabaseClient = createClient(environment.supabase.url, environment.supabase.anonKey);
  private readonly sessionKey = 'attendance_maintenance_user';

  async login(username: string, password: string): Promise<{ user?: SessionUser; error?: string }> {
    const identifier = username.trim().toLowerCase();
    const { data, error } = await this.client.from('users').select('id, username, password, display_name, role, is_active').or(`username.eq.${identifier},email.eq.${identifier}`).maybeSingle();
    if (error || !data || !data.is_active) return { error: 'Invalid username or password.' };
    const valid = data.password?.startsWith('$2') ? await bcrypt.compare(password, data.password) : data.password === password;
    if (!valid) return { error: 'Invalid username or password.' };
    const user: SessionUser = { id: data.id, username: data.username, name: data.display_name || data.username, role: data.role === 'admin' ? 'admin' : 'employee' };
    localStorage.setItem(this.sessionKey, JSON.stringify(user));
    return { user };
  }

  getSession(): SessionUser | null {
    try { return JSON.parse(localStorage.getItem(this.sessionKey) || 'null') as SessionUser | null; } catch { return null; }
  }
  logout(): void { localStorage.removeItem(this.sessionKey); }

  async loadEmployees(): Promise<Employee[]> {
    const { data, error } = await this.client.from('attendance_employees').select('*').order('name');
    if (error) throw error;
    return (data || []) as Employee[];
  }
  async loadUsers(): Promise<UserOption[]> {
    const { data, error } = await this.client.from('users').select('id, username, display_name, role').eq('is_active', true).order('username');
    if (error) throw error;
    return (data || []) as UserOption[];
  }
  async createEmployeeLogin(username: string, password: string, displayName: string): Promise<number> {
    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3 || password.length < 4) throw new Error('Labour username must be at least 3 characters and password at least 4 characters.');
    const passwordHash = await bcrypt.hash(password, 10);
    const { data, error } = await this.client.from('users').insert({ username: cleanUsername, password: passwordHash, display_name: displayName.trim(), is_active: true, role: 'employee' }).select('id').single();
    if (error) {
      if (error.code === '23505') throw new Error('That labour username is already in use. Choose another username.');
      throw error;
    }
    return data.id as number;
  }
  async updatePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 4) throw new Error('Password must be at least 4 characters.');
    const { data, error } = await this.client.from('users').select('password').eq('id', userId).single();
    if (error || !data) throw new Error('User account not found.');
    const valid = data.password?.startsWith('$2') ? await bcrypt.compare(currentPassword, data.password) : data.password === currentPassword;
    if (!valid) throw new Error('Current password is incorrect.');
    const { error: updateError } = await this.client.from('users').update({ password: await bcrypt.hash(newPassword, 10) }).eq('id', userId);
    if (updateError) throw updateError;
  }
  async resetPassword(username: string, newPassword: string): Promise<void> {
    if (newPassword.length < 4) throw new Error('Password must be at least 4 characters.');
    const { error } = await this.client.from('users').update({ password: await bcrypt.hash(newPassword, 10) }).eq('username', username.trim().toLowerCase()).eq('is_active', true);
    if (error) throw error;
  }
  async saveEmployee(payload: Partial<Employee>): Promise<void> {
    const { error } = await this.client.from('attendance_employees').upsert(payload, { onConflict: 'id' });
    if (error) {
      if (error.code === '23505' && error.message.includes('attendance_employees_user_id_key')) {
        throw new Error('This Sync Point account is already linked to another employee. Choose “Not linked yet” or use a different account.');
      }
      if (error.code === '23505' && error.message.includes('attendance_employees_employee_code_key')) {
        throw new Error('That employee ID is already in use. Enter a different employee ID.');
      }
      throw error;
    }
  }
  async deleteEmployee(employeeId: number): Promise<void> {
    const [{ data: attendance, error: attendanceError }, { data: payments, error: paymentError }] = await Promise.all([
      this.client.from('attendance_records').select('id').eq('employee_id', employeeId).limit(1),
      this.client.from('attendance_payments').select('id').eq('employee_id', employeeId).limit(1)
    ]);
    if (attendanceError) throw attendanceError;
    if (paymentError) throw paymentError;
    if ((attendance?.length ?? 0) > 0 || (payments?.length ?? 0) > 0) {
      throw new Error('This employee has attendance or payment history and cannot be deleted. Keep the record for audit history.');
    }
    const { error } = await this.client.from('attendance_employees').delete().eq('id', employeeId);
    if (error) throw error;
  }
  async loadAttendance(employeeId: number): Promise<AttendanceRecord[]> {
    const { data, error } = await this.client.from('attendance_payment_summary').select('*').eq('employee_id', employeeId).order('attendance_date');
    if (error) throw error;
    return this.mapAttendanceRows(data);
  }
  async loadAllAttendance(): Promise<AttendanceRecord[]> {
    const { data, error } = await this.client.from('attendance_payment_summary').select('*').order('attendance_date');
    if (error) throw error;
    return this.mapAttendanceRows(data);
  }
  async submitAttendance(employeeId: number, userId: number, date: string, type: AttendanceType, note: string, customWage = 0): Promise<void> {
    const { data: employee } = await this.client.from('attendance_employees').select('default_daily_rate').eq('id', employeeId).single();
    if (!employee) throw new Error('Employee not found.');
    const rate = Number(employee.default_daily_rate);
    const earned = type === 'full_day' ? rate : type === 'half_day' ? rate / 2 : type === 'custom' ? customWage : 0;
    if (type === 'custom' && customWage <= 0) throw new Error('Enter a custom wage greater than zero.');
    const { error } = await this.client.from('attendance_records').insert({ employee_id: employeeId, attendance_date: date, attendance_type: type, daily_rate: rate, earned_amount: earned, note: note.trim() || null, submitted_by: userId });
    if (error) throw new Error(error.code === '23505' ? 'Attendance already submitted for this date.' : error.message);
  }
  async updateApproval(id: number, status: 'approved' | 'denied', adminId: number): Promise<void> {
    const { error } = await this.client.from('attendance_records').update({ approval_status: status, approved_by: adminId, approved_at: new Date().toISOString() }).eq('id', id).eq('approval_status', 'pending');
    if (error) throw error;
  }
  async correctAttendance(id: number, type: AttendanceType, adminId: number, note: string, customWage = 0): Promise<void> {
    const { data: record, error: recordError } = await this.client.from('attendance_records').select('employee_id, daily_rate').eq('id', id).single();
    if (recordError || !record) throw new Error('Attendance record not found.');
    const earned = type === 'full_day' ? Number(record.daily_rate) : type === 'half_day' ? Number(record.daily_rate) / 2 : type === 'custom' ? customWage : 0;
    if (type === 'custom' && customWage <= 0) throw new Error('Enter a custom wage greater than zero.');
    const { error } = await this.client.from('attendance_records').update({ attendance_type: type, earned_amount: earned, approval_status: 'approved', note: note.trim() || null, approved_by: adminId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }
  async processPayment(employeeId: number, amount: number, date: string, method: string, note: string, adminId: number): Promise<void> {
    const { error } = await this.client.rpc('process_attendance_payment', { p_employee_id: employeeId, p_amount: amount, p_payment_date: date, p_payment_method: method, p_note: note || null, p_created_by: adminId });
    if (error) throw new Error(error.message.includes('PAYMENT_EXCEEDS_OUTSTANDING') ? 'Payment cannot exceed current outstanding amount.' : error.message);
  }
  async loadPayments(employeeId: number): Promise<Payment[]> {
    const { data, error } = await this.client.from('attendance_payments').select('*').eq('employee_id', employeeId).order('payment_date', { ascending: false });
    if (error) throw error;
    return (data || []) as Payment[];
  }
  async reversePayment(paymentId: number, adminId: number): Promise<void> {
    const { error } = await this.client.rpc('reverse_attendance_payment', { p_payment_id: paymentId, p_reversed_by: adminId });
    if (error) throw error;
  }
  private mapAttendanceRows(rows: unknown[] | null): AttendanceRecord[] {
    return (rows || []).map(row => {
      const item = row as Record<string, unknown>;
      return { ...item, id: Number(item['id'] ?? item['attendance_id']) } as AttendanceRecord;
    });
  }
}
