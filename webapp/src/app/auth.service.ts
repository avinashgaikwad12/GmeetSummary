import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../environments/environment';

export interface User {
  email: string;
  name: string | null;
  picture: string | null;
  isAdmin: boolean;
}

const USER_KEY = 'mh_user';
const TOKEN_KEY = 'mh_token';
const THEME_KEY = 'mh_theme';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  readonly user = signal<User | null>(this.restore());
  readonly theme = signal<'light' | 'dark'>(
    (localStorage.getItem(THEME_KEY) as 'light' | 'dark') || 'light'
  );

  private _token: string | null = localStorage.getItem(TOKEN_KEY);
  get token(): string | null {
    return this._token;
  }

  /** Exchange the Google ID token for our own session JWT. */
  loginWithGoogle(credential: string): Observable<{ token: string; user: User }> {
    return this.http
      .post<{ token: string; user: User }>(`${this.baseUrl}/api/auth/google`, { credential })
      .pipe(
        tap(({ token, user }) => {
          this._token = token;
          this.user.set(user);
          localStorage.setItem(TOKEN_KEY, token);
          localStorage.setItem(USER_KEY, JSON.stringify(user));
        })
      );
  }

  logout(): void {
    this._token = null;
    this.user.set(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  toggleTheme(): void {
    const next = this.theme() === 'light' ? 'dark' : 'light';
    this.theme.set(next);
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.setAttribute('data-theme', next);
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
