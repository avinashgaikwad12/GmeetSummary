import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell" [class.nav-open]="navOpen()">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="logo">
          <span class="logo-badge">📹</span>
          <span class="logo-text">MeetHub</span>
        </div>
        <nav>
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}" (click)="closeNav()">
            <span class="ic">🏠</span> Dashboard
          </a>
          <a routerLink="/meetings" routerLinkActive="active" (click)="closeNav()">
            <span class="ic">📅</span> Meetings
          </a>
          <a routerLink="/calendar" routerLinkActive="active" (click)="closeNav()">
            <span class="ic">📆</span> Calendar
          </a>
          <a routerLink="/tasks" routerLinkActive="active" (click)="closeNav()">
            <span class="ic">✅</span> Action Items
          </a>
          @if (user()?.isAdmin) {
            <a routerLink="/admin" routerLinkActive="active" (click)="closeNav()">
              <span class="ic">🛡️</span> Admin
            </a>
          }
        </nav>
        <div class="side-foot">
          <div class="tip">Tip: paste a transcript into a meeting's notes to auto-generate a summary.</div>
        </div>
      </aside>

      <!-- Main -->
      <div class="main">
        <header class="topbar">
          <button class="btn btn-icon hamburger" (click)="toggleNav()" aria-label="Menu">☰</button>
          <div class="spacer"></div>
          <button class="btn btn-icon" (click)="auth.toggleTheme()" [title]="auth.theme()==='light' ? 'Dark mode' : 'Light mode'">
            {{ auth.theme() === 'light' ? '🌙' : '☀️' }}
          </button>
          <div class="userchip" (click)="menuOpen.set(!menuOpen())">
            @if (user()?.picture) {
              <img [src]="user()!.picture" referrerpolicy="no-referrer" alt="" />
            } @else {
              <span class="avatar-fallback">{{ (user()?.name || user()?.email || '?')[0] }}</span>
            }
            <span class="uname">{{ user()?.name || user()?.email }}</span>
            @if (menuOpen()) {
              <div class="menu" (click)="$event.stopPropagation()">
                <div class="menu-email">{{ user()?.email }}</div>
                @if (user()?.isAdmin) { <div class="menu-tag">Admin</div> }
                <button class="btn btn-ghost" (click)="logout()">Log out</button>
              </div>
            }
          </div>
        </header>

        <main class="content">
          <router-outlet />
        </main>
      </div>

      <!-- Mobile overlay -->
      @if (navOpen()) { <div class="overlay" (click)="closeNav()"></div> }
    </div>
  `,
  styles: [`
    .shell { display:flex; min-height:100vh; }
    .sidebar {
      width: 248px; flex-shrink:0; background: var(--surface); border-right:1px solid var(--border);
      display:flex; flex-direction:column; padding: 1rem .8rem; position:sticky; top:0; height:100vh;
    }
    .logo { display:flex; align-items:center; gap:.6rem; padding:.4rem .5rem 1.2rem; }
    .logo-badge { font-size:1.5rem; }
    .logo-text { font-weight:800; font-size:1.2rem; letter-spacing:-.02em;
      background: var(--brand-grad); -webkit-background-clip:text; background-clip:text; color:transparent; }
    nav { display:flex; flex-direction:column; gap:.2rem; }
    nav a {
      display:flex; align-items:center; gap:.7rem; padding:.65rem .75rem; border-radius:10px;
      color: var(--text-dim); font-weight:600; font-size:.92rem; transition: background .12s, color .12s;
    }
    nav a:hover { background: var(--surface-2); color: var(--text); }
    nav a.active { background: var(--brand-grad); color:#fff; box-shadow: 0 4px 14px rgba(109,40,217,.3); }
    nav a.active .ic { filter: grayscale(0); }
    .ic { font-size:1.05rem; width:1.3rem; text-align:center; }
    .side-foot { margin-top:auto; }
    .tip { font-size:.78rem; color:var(--text-dim); background:var(--surface-2); padding:.7rem; border-radius:10px; line-height:1.4; }

    .main { flex:1; min-width:0; display:flex; flex-direction:column; }
    .topbar { display:flex; align-items:center; gap:.5rem; padding:.75rem 1.25rem;
      border-bottom:1px solid var(--border); background:var(--surface); position:sticky; top:0; z-index:20; }
    .hamburger { display:none; }
    .userchip { display:flex; align-items:center; gap:.5rem; padding:.3rem .5rem .3rem .35rem;
      border:1px solid var(--border); border-radius:999px; cursor:pointer; position:relative; }
    .userchip:hover { background:var(--surface-2); }
    .userchip img, .avatar-fallback { width:30px; height:30px; border-radius:50%; object-fit:cover; }
    .avatar-fallback { background:var(--brand-grad); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; text-transform:uppercase; }
    .uname { font-size:.88rem; font-weight:600; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .menu { position:absolute; top:calc(100% + 8px); right:0; background:var(--surface); border:1px solid var(--border);
      border-radius:12px; box-shadow:var(--shadow-lg); padding:.7rem; min-width:200px; display:flex; flex-direction:column; gap:.5rem; }
    .menu-email { font-size:.8rem; color:var(--text-dim); word-break:break-all; }
    .menu-tag { align-self:flex-start; font-size:.7rem; font-weight:700; background:var(--brand-grad); color:#fff; padding:.1rem .5rem; border-radius:999px; }
    .content { padding: 1.5rem; max-width: 1100px; width:100%; margin:0 auto; }
    .overlay { display:none; }

    @media (max-width: 860px) {
      .sidebar { position:fixed; left:0; top:0; z-index:40; transform:translateX(-100%); transition:transform .2s; }
      .nav-open .sidebar { transform:translateX(0); box-shadow:var(--shadow-lg); }
      .hamburger { display:inline-flex; }
      .nav-open .overlay { display:block; position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:35; }
      .uname { display:none; }
    }
  `],
})
export class LayoutComponent {
  auth = inject(AuthService);
  private router = inject(Router);
  user = this.auth.user;
  navOpen = signal(false);
  menuOpen = signal(false);

  toggleNav() { this.navOpen.set(!this.navOpen()); }
  closeNav() { this.navOpen.set(false); }
  logout() {
    this.menuOpen.set(false);
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
