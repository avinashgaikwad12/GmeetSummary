import { Component, inject, signal, OnInit, AfterViewInit, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { GoogleCalendarService } from '../google-calendar.service';
import { environment } from '../../environments/environment';

declare const google: any;

@Component({
  selector: 'app-login',
  template: `
    <div class="wrap">
      <div class="card login">
        <div class="brand"><span class="badge">📹</span><span class="name">MeetHub</span></div>
        <h1>Your Google Meet command center</h1>
        <p class="muted sub">Plan meetings, capture notes & summaries, and track action items — all in one place.</p>

        <div class="features">
          <div><span>📅</span> Organize every meeting</div>
          <div><span>✅</span> Never lose an action item</div>
          <div><span>📝</span> Auto-summaries from notes</div>
        </div>

        <div id="google-button" class="gbtn"></div>
        @if (signingIn()) { <p class="muted">Signing you in…</p> }
        @if (error()) { <p class="error-banner">{{ error() }}</p> }
        <p class="fine muted">Secure sign-in with Google. We only store your name, email & photo.</p>
      </div>
    </div>
  `,
  styles: [`
    .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:1.5rem;
      background:
        radial-gradient(1200px 600px at 10% -10%, rgba(124,58,237,.18), transparent),
        radial-gradient(1000px 500px at 110% 110%, rgba(37,99,235,.18), transparent),
        var(--bg); }
    .login { width:100%; max-width:440px; padding:2.4rem 2rem; text-align:center; }
    .brand { display:flex; align-items:center; justify-content:center; gap:.5rem; margin-bottom:1.4rem; }
    .badge { font-size:1.8rem; }
    .name { font-weight:800; font-size:1.5rem; background:var(--brand-grad); -webkit-background-clip:text; background-clip:text; color:transparent; }
    h1 { font-size:1.5rem; line-height:1.25; }
    .sub { margin:.6rem 0 1.3rem; }
    .features { display:flex; flex-direction:column; gap:.55rem; text-align:left; margin:0 auto 1.5rem; max-width:320px; }
    .features div { display:flex; align-items:center; gap:.6rem; font-size:.9rem; font-weight:500; }
    .features span { font-size:1.1rem; }
    .gbtn { display:flex; justify-content:center; min-height:44px; }
    .fine { font-size:.75rem; margin-top:1.2rem; }
    .error-banner { margin-top:1rem; }
  `],
})
export class LoginComponent implements OnInit, AfterViewInit {
  private auth = inject(AuthService);
  private cal = inject(GoogleCalendarService);
  private router = inject(Router);
  private zone = inject(NgZone);
  signingIn = signal(false);
  error = signal<string | null>(null);

  ngOnInit() {
    if (this.auth.user()) this.router.navigate(['/']);
  }
  ngAfterViewInit() { this.initButton(); }

  private initButton(attempt = 0) {
    if (typeof google === 'undefined' || !google.accounts?.id) {
      if (attempt < 50) setTimeout(() => this.initButton(attempt + 1), 100);
      return;
    }
    google.accounts.id.initialize({
      client_id: environment.googleClientId,
      callback: (resp: { credential: string }) =>
        this.zone.run(() => this.onCredential(resp.credential)),
    });
    const el = document.getElementById('google-button');
    if (el) {
      google.accounts.id.renderButton(el, {
        theme: 'filled_blue', size: 'large', text: 'continue_with', shape: 'pill', width: 280,
      });
    }
  }

  private onCredential(credential: string) {
    this.signingIn.set(true);
    this.error.set(null);
    // Authorize Google Calendar as part of signing in, while the sign-in
    // gesture is still fresh, so the user grants it once here and never has to
    // click "Connect" inside the app. For returning users who already granted
    // it, this resolves silently. Failures are non-fatal — the in-app Connect
    // button stays as a fallback.
    this.cal.requestAccess().catch(() => {});
    this.auth.loginWithGoogle(credential).subscribe({
      next: () => { this.signingIn.set(false); this.router.navigate(['/']); },
      error: (err) => {
        this.signingIn.set(false);
        this.error.set(err?.error?.error ?? 'Sign-in failed. Please try again.');
      },
    });
  }
}
