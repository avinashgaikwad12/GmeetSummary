import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

export interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  access_enabled: boolean;
  created_at: string;
}

export interface LoginRecord {
  id: number;
  email: string;
  name: string | null;
  ip: string | null;
  user_agent: string | null;
  logged_in_at: string;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  listUsers(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[]>(`${this.base}/api/admin/users`);
  }
  listLogins(): Observable<LoginRecord[]> {
    return this.http.get<LoginRecord[]>(`${this.base}/api/admin/logins`);
  }
  setAccess(id: number, enabled: boolean): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`${this.base}/api/admin/users/${id}/access`, { enabled });
  }
}
