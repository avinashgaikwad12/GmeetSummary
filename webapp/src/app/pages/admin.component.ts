import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminService, AdminUser, LoginRecord } from '../admin.service';

@Component({
  selector: 'app-admin',
  imports: [DatePipe],
  template: `
    <div class="page-head row">
      <div><h1>Admin</h1><p class="muted">Manage who can sign in and review the login history.</p></div>
      <button class="btn" (click)="load()">↻ Refresh</button>
    </div>

    @if (error()) { <p class="error-banner">{{ error() }}</p> }

    <section class="card card-pad" style="margin-bottom:1.2rem">
      <h2>Users & access</h2>
      <p class="muted sm">Toggle whether each person is allowed to sign in. Admins can't be blocked.</p>
      @if (users().length === 0) { <div class="empty">No users yet.</div> }
      @else {
        <div class="table">
          <div class="thead"><span>User</span><span>Email</span><span>First seen</span><span>Access</span></div>
          @for (u of users(); track u.id) {
            <div class="trow">
              <span class="who">
                @if (u.picture) { <img [src]="u.picture" referrerpolicy="no-referrer" alt=""/> }
                {{ u.name || '—' }}
              </span>
              <span class="muted">{{ u.email }}</span>
              <span class="muted">{{ u.created_at | date:'mediumDate' }}</span>
              <span>
                <button class="toggle" [class.on]="u.access_enabled" (click)="toggle(u)">
                  <span class="dot"></span>{{ u.access_enabled ? 'Allowed' : 'Blocked' }}
                </button>
              </span>
            </div>
          }
        </div>
      }
    </section>

    <section class="card card-pad">
      <h2>Login history</h2>
      <p class="muted sm">Every successful sign-in ({{ logins().length }} shown).</p>
      @if (logins().length === 0) { <div class="empty">No logins recorded yet.</div> }
      @else {
        <div class="table login">
          <div class="thead"><span>When</span><span>Name</span><span>Email</span><span>IP</span></div>
          @for (l of logins(); track l.id) {
            <div class="trow">
              <span>{{ l.logged_in_at | date:'MMM d, y • h:mm a' }}</span>
              <span>{{ l.name || '—' }}</span>
              <span class="muted">{{ l.email }}</span>
              <span class="muted">{{ l.ip || '—' }}</span>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    h1 { font-size:1.5rem; } h2 { font-size:1.1rem; }
    .page-head { margin-bottom:1.2rem; align-items:flex-start; }
    .sm { font-size:.83rem; margin:.2rem 0 1rem; }
    .table { display:flex; flex-direction:column; font-size:.88rem; }
    .thead, .trow { display:grid; grid-template-columns:1.4fr 1.8fr 1.2fr 1fr; gap:.8rem; align-items:center; padding:.6rem .2rem; }
    .thead { color:var(--text-dim); font-weight:700; font-size:.78rem; border-bottom:2px solid var(--border); text-transform:uppercase; letter-spacing:.03em; }
    .trow { border-bottom:1px solid var(--border); }
    .who { display:flex; align-items:center; gap:.5rem; font-weight:600; }
    .who img { width:26px; height:26px; border-radius:50%; }
    .toggle { display:inline-flex; align-items:center; gap:.4rem; border:none; cursor:pointer;
      border-radius:999px; padding:.3rem .7rem; font-weight:700; font-size:.78rem; background:var(--red-bg); color:var(--red); }
    .toggle.on { background:var(--green-bg); color:var(--green); }
    .toggle .dot { width:8px; height:8px; border-radius:50%; background:currentColor; }
    @media (max-width:760px){ .thead{ display:none } .trow{ grid-template-columns:1fr 1fr; row-gap:.2rem } }
  `],
})
export class AdminComponent implements OnInit {
  private admin = inject(AdminService);
  users = signal<AdminUser[]>([]);
  logins = signal<LoginRecord[]>([]);
  error = signal<string | null>(null);

  ngOnInit() { this.load(); }

  load() {
    this.error.set(null);
    this.admin.listUsers().subscribe({ next: (u) => this.users.set(u), error: (e) => this.fail(e) });
    this.admin.listLogins().subscribe({ next: (l) => this.logins.set(l), error: (e) => this.fail(e) });
  }

  toggle(u: AdminUser) {
    this.admin.setAccess(u.id, !u.access_enabled).subscribe({
      next: (up) => this.users.update((l) => l.map((x) => (x.id === up.id ? up : x))),
      error: (e) => this.fail(e),
    });
  }

  private fail(e: any) {
    this.error.set(e?.status === 401 ? 'Session expired — please log out and back in.' : 'Something went wrong.');
  }
}
