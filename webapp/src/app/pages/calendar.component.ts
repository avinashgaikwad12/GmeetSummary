import { Component, inject, signal, computed, OnInit, NgZone } from '@angular/core';
import { ApiService, Meeting } from '../api.service';
import { GoogleCalendarService, GEvent } from '../google-calendar.service';

interface Item { id: string; title: string; cls: string; }
interface Cell {
  date: Date; key: string; inMonth: boolean; isToday: boolean; items: Item[];
}

@Component({
  selector: 'app-calendar',
  template: `
    <div class="cal">
      <div class="bar">
        <h1>Calendar</h1>
        <div class="center">
          <button class="btn btn-sm btn-icon" (click)="prev()">‹</button>
          <span class="title">{{ monthLabel() }}</span>
          <button class="btn btn-sm btn-icon" (click)="next()">›</button>
          <button class="btn btn-sm" (click)="today()">Today</button>
        </div>
        <div class="right">
          @if (connected()) {
            <span class="synced">📆 Google Calendar</span>
            <button class="btn btn-sm" (click)="connect()" [disabled]="gLoading()">{{ gLoading() ? '…' : '↻' }}</button>
          } @else {
            <button class="btn btn-sm btn-primary" (click)="connect()" [disabled]="gLoading()">
              {{ gLoading() ? 'Connecting…' : 'Connect Google Calendar' }}
            </button>
          }
        </div>
      </div>

      @if (gError()) { <p class="error-banner" style="margin-bottom:.6rem">{{ gError() }}</p> }
      @else if (!connected()) {
        <p class="hint">Connect your Google Calendar to see all your real events here, alongside meetings created in MeetHub.</p>
      }

      <div class="weekdays">
        @for (d of weekdays; track d) { <div>{{ d }}</div> }
      </div>

      <div class="grid">
        @for (c of cells(); track c.key) {
          <div class="cell" [class.dim]="!c.inMonth" [class.today]="c.isToday">
            <div class="daynum">{{ c.date.getDate() }}</div>
            <div class="chips">
              @for (it of c.items.slice(0,2); track it.id) {
                <span class="chip {{it.cls}}" [title]="it.title">{{ it.title }}</span>
              }
              @if (c.items.length > 2) { <span class="more">+{{ c.items.length - 2 }} more</span> }
            </div>
          </div>
        }
      </div>

      <div class="legend">
        <span><i class="dot gcal"></i> Google event</span>
        <span><i class="dot upcoming"></i> MeetHub upcoming</span>
        <span><i class="dot completed"></i> Completed</span>
        <span><i class="dot cancelled"></i> Cancelled</span>
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex; flex-direction:column; height: calc(100vh - 105px); min-height: 420px; }
    .cal { display:flex; flex-direction:column; flex:1; min-height:0; }
    .bar { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:.6rem; }
    h1 { font-size:1.4rem; }
    .center { display:flex; align-items:center; gap:.4rem; }
    .title { font-size:1.05rem; font-weight:700; min-width:155px; text-align:center; }
    .right { display:flex; align-items:center; gap:.5rem; }
    .synced { font-size:.72rem; font-weight:700; color:var(--green); background:var(--green-bg); padding:.18rem .55rem; border-radius:999px; }
    .hint { font-size:.82rem; color:var(--text-dim); background:var(--surface-2); padding:.55rem .8rem; border-radius:10px; margin:0 0 .6rem; }
    .weekdays { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; margin-bottom:6px; }
    .weekdays div { text-align:center; font-size:.7rem; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:.04em; }
    .grid { flex:1; min-height:0; display:grid; grid-template-columns:repeat(7,1fr); grid-template-rows:repeat(6, minmax(0,1fr)); gap:6px; }
    .cell { border:1px solid var(--border); border-radius:10px; padding:.3rem .35rem; background:var(--surface);
      display:flex; flex-direction:column; gap:.2rem; overflow:hidden; min-height:0; }
    .cell.dim { opacity:.42; }
    .cell.today { border-color:var(--brand); box-shadow:0 0 0 2px rgba(109,40,217,.18) inset; }
    .daynum { font-size:.74rem; font-weight:700; color:var(--text-dim); flex-shrink:0; }
    .cell.today .daynum { color:var(--brand); }
    .chips { display:flex; flex-direction:column; gap:3px; overflow:hidden; }
    .chip { font-size:.68rem; font-weight:600; padding:.1rem .35rem; border-radius:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      background:var(--blue-bg); color:var(--blue); flex-shrink:0; }
    .chip.gcal { background:#ede9fe; color:var(--brand); }
    .chip.completed { background:var(--green-bg); color:var(--green); }
    .chip.cancelled { background:var(--red-bg); color:var(--red); text-decoration:line-through; }
    .more { font-size:.66rem; color:var(--text-dim); font-weight:600; }
    .legend { display:flex; flex-wrap:wrap; gap:.9rem; align-items:center; margin-top:.7rem; font-size:.76rem; flex-shrink:0; }
    .legend span { display:inline-flex; align-items:center; gap:.35rem; }
    .dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
    .dot.gcal { background:var(--brand); } .dot.upcoming { background:var(--blue); }
    .dot.completed { background:var(--green); } .dot.cancelled { background:var(--red); }
    @media (max-width:760px){ :host{ height:auto; } .grid{ grid-template-rows:repeat(6, minmax(64px,1fr)); } .bar{ flex-wrap:wrap; } }
  `],
})
export class CalendarComponent implements OnInit {
  private api = inject(ApiService);
  private cal = inject(GoogleCalendarService);
  private zone = inject(NgZone);
  weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  private meetings = signal<Meeting[]>([]);
  private gEvents = signal<GEvent[]>([]);
  private cursor = signal(new Date());
  connected = signal(false);
  gLoading = signal(false);
  gError = signal<string | null>(null);

  monthLabel = computed(() =>
    this.cursor().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  );

  cells = computed<Cell[]>(() => {
    const cur = this.cursor();
    const month = cur.getMonth();
    const first = new Date(cur.getFullYear(), month, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());

    const byDay = new Map<string, Item[]>();
    const push = (k: string, it: Item) => {
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k)!.push(it);
    };

    const gids = new Set<string>();
    for (const e of this.gEvents()) {
      if (!e.startISO) continue;
      gids.add(e.id);
      push(this.key(new Date(e.startISO)), { id: 'g' + e.id, title: e.title, cls: 'gcal' });
    }
    for (const m of this.meetings()) {
      if (!m.meeting_date) continue;
      if (m.google_event_id && gids.has(m.google_event_id)) continue; // avoid dupes
      push(this.key(new Date(m.meeting_date)), { id: 'm' + m.id, title: m.title, cls: m.status });
    }

    const todayKey = this.key(new Date());
    const out: Cell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = this.key(d);
      out.push({ date: d, key: k, inMonth: d.getMonth() === month, isToday: k === todayKey, items: byDay.get(k) ?? [] });
    }
    return out;
  });

  ngOnInit() {
    this.api.listMeetings('all').subscribe({ next: (m) => this.meetings.set(m) });
    // Auto-connect: returning users sync silently; first-timers get Google's
    // own consent screen right away (no app "Connect" click needed).
    this.syncGoogle(!this.cal.wasConnected());
  }

  connect() { this.syncGoogle(true); }
  prev() { this.shift(-1); }
  next() { this.shift(1); }
  today() { this.cursor.set(new Date()); if (this.connected()) this.syncGoogle(false); }

  private shift(delta: number) {
    const d = new Date(this.cursor());
    d.setMonth(d.getMonth() + delta);
    this.cursor.set(d);
    if (this.connected()) this.syncGoogle(false);
  }

  private syncGoogle(interactive: boolean) {
    const { minISO, maxISO } = this.range();
    this.gLoading.set(true);
    this.gError.set(null);
    this.cal.listEvents(minISO, maxISO, interactive)
      .then((events) => this.zone.run(() => {
        this.gLoading.set(false);
        if (events === null) { this.connected.set(false); return; }
        this.connected.set(true);
        this.gEvents.set(events);
      }))
      .catch((e) => this.zone.run(() => {
        this.gLoading.set(false);
        this.gError.set(this.calErr(e));
      }));
  }

  private range() {
    const cur = this.cursor();
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 42);
    return { minISO: start.toISOString(), maxISO: end.toISOString() };
  }

  private calErr(e: any): string {
    const s = JSON.stringify(e?.message ?? e?.error ?? e ?? '').toLowerCase();
    if (s.includes('403') || s.includes('permission') || s.includes('disabled'))
      return 'Couldn’t read Google Calendar — make sure the Calendar API is enabled and the calendar scope is added.';
    if (s.includes('denied') || s.includes('closed') || s.includes('popup'))
      return 'Calendar permission wasn’t granted. Click “Connect Google Calendar” and choose Allow.';
    return 'Couldn’t load Google Calendar events. Try again.';
  }

  private key(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
}
