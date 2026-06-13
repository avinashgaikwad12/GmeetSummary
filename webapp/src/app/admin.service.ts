import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService } from './auth.service';

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
  private auth = inject(AuthService);
  private baseUrl = environment.apiUrl;

  // Attach the Google ID token so the API can verify the caller is an admin.
  private authHeaders(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.token ?? ''}` });
  }

  listUsers(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[]>(`${this.baseUrl}/api/admin/users`, {
      headers: this.authHeaders(),
    });
  }

  listLogins(): Observable<LoginRecord[]> {
    return this.http.get<LoginRecord[]>(`${this.baseUrl}/api/admin/logins`, {
      headers: this.authHeaders(),
    });
  }

  setAccess(userId: number, enabled: boolean): Observable<AdminUser> {
    return this.http.patch<AdminUser>(
      `${this.baseUrl}/api/admin/users/${userId}/access`,
      { enabled },
      { headers: this.authHeaders() }
    );
  }
}
