import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService, Meeting, Task, Stats } from '../api.service';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h1>{{ greeting() }}, {{ firstName() }} 👋</h1>
        <p class="muted">Here's what's happening with your meetings.</p>
      </div>
      <a class="btn btn-primary" routerLink="/meetings">+ New meeting</a>
    </div>

    <!-- Stat cards -->
    <div class="stats">
      <div class="card card-pad stat">
        <div class="stat-ic" style="background:var(--blue-bg);color:var(--blue)">📅</div>
        <div><div class="num">{{ stats()?.meetings?.total ?? 0 }}</div><div class="lbl">Total meetings</div></div>
      </div>
      <div class="card card-pad stat">
        <div class="stat-ic" style="background:var(--amber-bg);color:var(--amber)">⏳</div>
        <div><div class="num">{{ stats()?.meetings?.upcoming ?? 0 }}</div><div class="lbl">Upcoming</div></div>
      </div>
      <div class="card card-pad stat">
        <div class="stat-ic" style="background:var(--green-bg);color:var(--green)">✔️</div>
        <div><div class="num">{{ stats()?.meetings?.completed ?? 0 }}</div><div class="lbl">Completed</div></div>
      </div>
      <div class="card card-pad stat">
        <div class="stat-ic" style="background:#ede9fe;color:var(--brand)">✅</div>
        <div><div class="num">{{ stats()?.tasks?.open ?? 0 }}</div><div class="lbl">Open action items</div></div>
      </div>
    </div>

    <div class="grid2">
      <!-- Upcoming meetings -->
      <section class="card card-pad">
        <div class="row"><h2>Upcoming meetings</h2><a class="btn btn-sm btn-ghost" routerLink="/meetings">View all</a></div>
        @if (upcoming().length === 0) {
          <div class="empty"><span class="em">📭</span>No upcoming meetings.</div>
        } @else {
          @for (m of upcoming(); track m.id) {
            <div class="item">
              <div>
                <div class="t">{{ m.title }}</div>
                <div class="muted sm">{{ m.meeting_date ? (m.meeting_date | date:'EEE, MMM d • h:mm a') : 'No date set' }}</div>
              </div>
              @if (m.meet_link) { <a class="btn btn-sm" [href]="m.meet_link" target="_blank">Join</a> }
            </div>
          }
        }
      </section>

      <!-- Open action items -->
      <section class="card card-pad">
        <div class="row"><h2>Open action items</h2><a class="btn btn-sm btn-ghost" routerLink="/tasks">View all</a></div>
        @if (openTasks().length === 0) {
          <div class="empty"><span class="em">🎉</span>Nothing pending. Nice!</div>
        } @else {
          @for (t of openTasks(); track t.id) {
            <div class="item">
              <div>
                <div class="t">{{ t.title }}</div>
                <div class="muted sm">
                  <span class="badge {{t.priority}}">{{ t.priority }}</span>
                  @if (t.due_date) { · due {{ t.due_date | date:'MMM d' }} }
                </div>
              </div>
              <button class="btn btn-sm" (click)="complete(t)">Done</button>
            </div>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    .page-head { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; margin-bottom:1.3rem; }
    h1 { font-size:1.5rem; }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:1rem; margin-bottom:1.3rem; }
    .stat { display:flex; align-items:center; gap:.9rem; }
    .stat-ic { width:46px; height:46px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:1.3rem; }
    .num { font-size:1.7rem; font-weight:800; line-height:1; }
    .lbl { font-size:.8rem; color:var(--text-dim); margin-top:.2rem; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
    .item { display:flex; align-items:center; justify-content:space-between; gap:.8rem; padding:.7rem 0; border-bottom:1px solid var(--border); }
    .item:last-child { border-bottom:none; }
    .t { font-weight:600; font-size:.92rem; }
    .sm { font-size:.78rem; margin-top:.15rem; }
    h2 { font-size:1.05rem; }
    @media (max-width: 920px) { .stats { grid-template-columns:repeat(2,1fr);} .grid2 { grid-template-columns:1fr; } }
  `],
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  stats = signal<Stats | null>(null);
  upcoming = signal<Meeting[]>([]);
  openTasks = signal<Task[]>([]);

  firstName = computed(() => (this.auth.user()?.name || this.auth.user()?.email || '').split(' ')[0]);

  ngOnInit() { this.load(); }

  greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  load() {
    this.api.stats().subscribe({ next: (s) => this.stats.set(s) });
    this.api.listMeetings('upcoming').subscribe({ next: (m) => this.upcoming.set(m.slice(0, 5)) });
    this.api.listTasks(false).subscribe({ next: (t) => this.openTasks.set(t.slice(0, 5)) });
  }

  complete(t: Task) {
    this.api.updateTask(t.id, { done: true }).subscribe({
      next: () => { this.openTasks.update((l) => l.filter((x) => x.id !== t.id)); this.load(); },
    });
  }
}
