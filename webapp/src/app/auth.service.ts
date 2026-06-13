import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../environments/environment';

export interface User {
  email: string;
  name: string | null;
  picture: string | null;
  isAdmin?: boolean;
}

const USER_KEY = 'gmeet_user';
const TOKEN_KEY = 'gmeet_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  // Current signed-in user (null when logged out). Restored from localStorage
  // so a page refresh keeps you logged in.
  readonly user = signal<User | null>(this.restore());

  // The Google ID token, sent as a Bearer token on admin requests. It expires
  // ~1h after login; admin calls then 401 and prompt a re-login.
  private credential: string | null = localStorage.getItem(TOKEN_KEY);

  get token(): string | null {
    return this.credential;
  }

  /** Send the Google ID token to the API, which verifies it and logs the login. */
  loginWithGoogle(credential: string): Observable<User> {
    return this.http
      .post<User>(`${this.baseUrl}/api/auth/google`, { credential })
      .pipe(
        tap((user) => {
          this.user.set(user);
          this.credential = credential;
          localStorage.setItem(USER_KEY, JSON.stringify(user));
          localStorage.setItem(TOKEN_KEY, credential);
        })
      );
  }

  logout(): void {
    this.user.set(null);
    this.credential = null;
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }

  private restore(): User | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  }
}
