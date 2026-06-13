import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../environments/environment';

export interface User {
  email: string;
  name: string | null;
  picture: string | null;
}

const STORAGE_KEY = 'gmeet_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  // Current signed-in user (null when logged out). Restored from localStorage
  // so a page refresh keeps you logged in.
  readonly user = signal<User | null>(this.restore());

  /** Send the Google ID token to the API, which verifies it and logs the login. */
  loginWithGoogle(credential: string): Observable<User> {
    return this.http
      .post<User>(`${this.baseUrl}/api/auth/google`, { credential })
      .pipe(
        tap((user) => {
          this.user.set(user);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
        })
      );
  }

  logout(): void {
    this.user.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  private restore(): User | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  }
}
