import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  template: `
    <div class="shell" [class.nav-open]="navOpen()">
      <aside class="sidebar">
        <div class="brand">
          <span class="mark">C</span>
          <div>
            <div class="name">Cadence</div>
            <div class="tag">Meeting Intelligence</div>
          </div>
        </div>
        <nav class="nav">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}" (click)="closeNav()"><span class="ic">▣</span> Dashboard</a>
          <a routerLink="/meetings" routerLinkActive="active" (click)="closeNav()"><span class="ic">◴</span> Meetings</a>
          <a routerLink="/tasks" routerLinkActive="active" (click)="closeNav()"><span class="ic">✔</span> Action items</a>
          <a routerLink="/jira" routerLinkActive="active" (click)="closeNav()"><span class="ic">⌗</span> Jira tracker</a>
          <a routerLink="/search" routerLinkActive="active" (click)="closeNav()"><span class="ic">⌕</span> Search</a>
          <div class="sec">Workspace</div>
          <a routerLink="/settings" routerLinkActive="active" (click)="closeNav()"><span class="ic">⚙</span> Settings</a>
          @if (user()?.isAdmin) {
            <a routerLink="/admin" routerLinkActive="active" (click)="closeNav()"><span class="ic">⛨</span> Admin</a>
          }
        </nav>
        <div class="side-foot">Signed in as<br><strong>{{ user()?.email }}</strong></div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="hamburger" (click)="toggleNav()" aria-label="Menu">☰</button>
          <div class="search">
            <span class="mag">⌕</span>
            <input type="search" placeholder="Search meetings, transcripts & summaries…"
                   [(ngModel)]="q" (keyup.enter)="runSearch()" />
          </div>
          <span class="spacer"></span>
          <button class="btn btn-icon btn-ghost" (click)="auth.toggleTheme()" [title]="auth.theme()==='light' ? 'Dark mode' : 'Light mode'">
            {{ auth.theme() === 'light' ? '☾' : '☀' }}
          </button>
          <div class="userchip" (click)="menuOpen.set(!menuOpen())">
            @if (user()?.picture) { <img [src]="user()!.picture" referrerpolicy="no-referrer" alt="" /> }
            @else { <span class="fallback">{{ (user()?.name || user()?.email || '?')[0] }}</span> }
            <span class="uname">{{ user()?.name || user()?.email }}</span>
            @if (menuOpen()) {
              <div class="menu" (click)="$event.stopPropagation()">
                <div class="em">{{ user()?.email }}</div>
                <a class="btn btn-sm btn-ghost" routerLink="/settings" (click)="menuOpen.set(false)" style="justify-content:flex-start">Settings</a>
                <button class="btn btn-sm btn-ghost" (click)="logout()" style="justify-content:flex-start">Log out</button>
              </div>
            }
          </div>
        </header>

        <main class="content"><router-outlet /></main>
      </div>

      @if (navOpen()) { <div class="overlay" (click)="closeNav()"></div> }
    </div>
  `,
})
export class LayoutComponent {
  auth = inject(AuthService);
  private router = inject(Router);
  user = this.auth.user;
  navOpen = signal(false);
  menuOpen = signal(false);
  q = '';

  toggleNav() { this.navOpen.set(!this.navOpen()); }
  closeNav() { this.navOpen.set(false); }
  runSearch() {
    const term = this.q.trim();
    this.router.navigate(['/search'], { queryParams: term ? { q: term } : {} });
    this.closeNav();
  }
  logout() {
    this.menuOpen.set(false);
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
