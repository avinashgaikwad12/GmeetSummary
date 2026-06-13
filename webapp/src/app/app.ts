import { Component, signal, inject, OnInit, AfterViewInit, NgZone } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SummaryService, Summary } from './summary.service';
import { AuthService } from './auth.service';
import { AdminService, AdminUser, LoginRecord } from './admin.service';
import { environment } from '../environments/environment';

// Google Identity Services is loaded from index.html and attaches to window.
declare const google: any;

type View = 'app' | 'admin';

@Component({
  selector: 'app-root',
  imports: [FormsModule, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, AfterViewInit {
  private service = inject(SummaryService);
  private auth = inject(AuthService);
  private admin = inject(AdminService);
  private zone = inject(NgZone);

  // Auth state (exposed to the template).
  readonly user = this.auth.user;
  protected readonly authError = signal<string | null>(null);
  protected readonly signingIn = signal(false);
  protected readonly view = signal<View>('app');

  // Summaries state.
  protected readonly summaries = signal<Summary[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected title = '';
  protected transcript = '';

  // Admin state.
  protected readonly adminUsers = signal<AdminUser[]>([]);
  protected readonly logins = signal<LoginRecord[]>([]);
  protected readonly adminLoading = signal(false);
  protected readonly adminError = signal<string | null>(null);

  ngOnInit(): void {
    if (this.user()) {
      this.refresh();
    }
  }

  ngAfterViewInit(): void {
    if (!this.user()) {
      this.initGoogleButton();
    }
  }

  // ---- Google sign-in --------------------------------------------------

  private initGoogleButton(attempt = 0): void {
    // The GSI script loads asynchronously; retry briefly until it's ready.
    if (typeof google === 'undefined' || !google.accounts?.id) {
      if (attempt < 40) {
        setTimeout(() => this.initGoogleButton(attempt + 1), 100);
      }
      return;
    }

    google.accounts.id.initialize({
      client_id: environment.googleClientId,
      callback: (response: { credential: string }) =>
        this.zone.run(() => this.onGoogleCredential(response.credential)),
    });

    const target = document.getElementById('google-button');
    if (target) {
      google.accounts.id.renderButton(target, {
        theme: 'filled_blue',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
      });
    }
  }

  private onGoogleCredential(credential: string): void {
    this.signingIn.set(true);
    this.authError.set(null);
    this.auth.loginWithGoogle(credential).subscribe({
      next: () => {
        this.signingIn.set(false);
        this.refresh();
      },
      error: (err) => {
        this.signingIn.set(false);
        // 403 => blocked by admin; show the server's message.
        this.authError.set(
          err?.error?.error ?? 'Sign-in failed. Please try again.'
        );
      },
    });
  }

  logout(): void {
    if (typeof google !== 'undefined' && google.accounts?.id) {
      google.accounts.id.disableAutoSelect();
    }
    this.auth.logout();
    this.summaries.set([]);
    this.view.set('app');
    // Re-render the Google button for the next login.
    setTimeout(() => this.initGoogleButton(), 0);
  }

  // ---- Navigation ------------------------------------------------------

  showApp(): void {
    this.view.set('app');
  }

  showAdmin(): void {
    this.view.set('admin');
    this.loadAdmin();
  }

  // ---- Admin -----------------------------------------------------------

  loadAdmin(): void {
    this.adminLoading.set(true);
    this.adminError.set(null);
    this.admin.listUsers().subscribe({
      next: (users) => this.adminUsers.set(users),
      error: (err) => this.adminError.set(this.adminMsg(err)),
    });
    this.admin.listLogins().subscribe({
      next: (rows) => {
        this.logins.set(rows);
        this.adminLoading.set(false);
      },
      error: (err) => {
        this.adminError.set(this.adminMsg(err));
        this.adminLoading.set(false);
      },
    });
  }

  toggleAccess(u: AdminUser): void {
    const next = !u.access_enabled;
    this.admin.setAccess(u.id, next).subscribe({
      next: (updated) =>
        this.adminUsers.update((list) =>
          list.map((x) => (x.id === updated.id ? updated : x))
        ),
      error: (err) => this.adminError.set(this.adminMsg(err)),
    });
  }

  private adminMsg(err: any): string {
    if (err?.status === 401) return 'Your session expired — please log out and sign in again.';
    return err?.error?.error ?? 'Something went wrong loading admin data.';
  }

  // ---- Summaries -------------------------------------------------------

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: (rows) => {
        this.summaries.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not reach the API. Is it running?');
        this.loading.set(false);
      },
    });
  }

  add(): void {
    if (!this.title.trim() || !this.transcript.trim()) {
      return;
    }
    this.service.create(this.title, this.transcript).subscribe({
      next: (created) => {
        this.summaries.update((rows) => [created, ...rows]);
        this.title = '';
        this.transcript = '';
      },
      error: () => this.error.set('Failed to save. Check the API and database.'),
    });
  }
}
