import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, Meeting } from '../api.service';

interface Cell {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
  meetings: Meeting[];
}

@Component({
  selector: 'app-calendar',
  imports: [RouterLink],
  template: `
    <div class="page-head">
      <div><h1>Calendar</h1><p class="muted">Your meetings, month by month.</p></div>
      <a class="btn btn-primary" routerLink="/meetings">+ New meeting</a>
    </div>

    <div class="card card-pad">
      <div class="cal-head">
        <div class="title">{{ monthLabel() }}</div>
        <div class="nav">
          <button class="btn btn-sm" (click)="prev()">‹</button>
          <button class="btn btn-sm" (click)="today()">Today</button>
          <button class="btn btn-sm" (click)="next()">›</button>
        </div>
      </div>

      <div class="weekdays">
        @for (d of weekdays; track d) { <div>{{ d }}</div> }
      </div>

      <div class="grid">
        @for (c of cells(); track c.key) {
          <div class="cell" [class.dim]="!c.inMonth" [class.today]="c.isToday">
            <div class="daynum">{{ c.date.getDate() }}</div>
            <div class="chips">
              @for (m of c.meetings.slice(0,3); track m.id) {
                <a class="chip {{m.status}}" routerLink="/meetings" [title]="m.title">{{ m.title }}</a>
              }
              @if (c.meetings.length > 3) {
                <a class="more" routerLink="/meetings">+{{ c.meetings.length - 3 }} more</a>
              }
            </div>
          </div>
        }
      </div>

      <div class="legend">
        <span><i class="dot upcoming"></i> Upcoming</span>
        <span><i class="dot completed"></i> Completed</span>
        <span><i class="dot cancelled"></i> Cancelled</span>
        <span class="muted">· Meetings without a date aren't shown here — set a date when creating them.</span>
      </div>
    </div>
  `,
  styles: [`
    .page-head { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; margin-bottom:1.2rem; }
    h1 { font-size:1.5rem; }
    .cal-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem; }
    .title { font-size:1.2rem; font-weight:700; }
    .nav { display:flex; gap:.4rem; }
    .weekdays { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; margin-bottom:6px; }
    .weekdays div { text-align:center; font-size:.72rem; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:.04em; }
    .grid { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
    .cell { min-height:92px; border:1px solid var(--border); border-radius:10px; padding:.35rem; background:var(--surface);
      display:flex; flex-direction:column; gap:.25rem; overflow:hidden; }
    .cell.dim { opacity:.45; }
    .cell.today { border-color:var(--brand); box-shadow:0 0 0 2px rgba(109,40,217,.18) inset; }
    .daynum { font-size:.78rem; font-weight:700; color:var(--text-dim); }
    .cell.today .daynum { color:var(--brand); }
    .chips { display:flex; flex-direction:column; gap:3px; }
    .chip { font-size:.7rem; font-weight:600; padding:.12rem .35rem; border-radius:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      background:var(--blue-bg); color:var(--blue); }
    .chip.completed { background:var(--green-bg); color:var(--green); }
    .chip.cancelled { background:var(--red-bg); color:var(--red); text-decoration:line-through; }
    .more { font-size:.68rem; color:var(--text-dim); font-weight:600; }
    .legend { display:flex; flex-wrap:wrap; gap:1rem; align-items:center; margin-top:1rem; font-size:.78rem; }
    .legend span { display:inline-flex; align-items:center; gap:.35rem; }
    .dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
    .dot.upcoming { background:var(--blue); } .dot.completed { background:var(--green); } .dot.cancelled { background:var(--red); }
    @media (max-width:640px){ .cell { min-height:70px; } .chip { font-size:.62rem; } }
  `],
})
export class CalendarComponent implements OnInit {
  private api = inject(ApiService);
  weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  private meetings = signal<Meeting[]>([]);
  private cursor = signal(new Date());

  monthLabel = computed(() =>
    this.cursor().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  );

  cells = computed<Cell[]>(() => {
    const cur = this.cursor();
    const year = cur.getFullYear();
    const month = cur.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay()); // back up to Sunday

    // Group meetings by local date key.
    const byDay = new Map<string, Meeting[]>();
    for (const m of this.meetings()) {
      if (!m.meeting_date) continue;
      const k = this.key(new Date(m.meeting_date));
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(m);
    }

    const todayKey = this.key(new Date());
    const out: Cell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = this.key(d);
      out.push({
        date: d,
        key: k,
        inMonth: d.getMonth() === month,
        isToday: k === todayKey,
        meetings: byDay.get(k) ?? [],
      });
    }
    return out;
  });

  ngOnInit() {
    this.api.listMeetings('all').subscribe({ next: (m) => this.meetings.set(m) });
  }

  prev() { const d = new Date(this.cursor()); d.setMonth(d.getMonth() - 1); this.cursor.set(d); }
  next() { const d = new Date(this.cursor()); d.setMonth(d.getMonth() + 1); this.cursor.set(d); }
  today() { this.cursor.set(new Date()); }

  private key(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
}
