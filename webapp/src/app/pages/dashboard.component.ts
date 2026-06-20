import { Component, inject, signal, computed, OnInit, NgZone } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService, Meeting } from '../api.service';
import { GoogleCalendarService } from '../google-calendar.service';
import { AuthService } from '../auth.service';

interface Item { id: number | null; title: string; dateMs: number; dateISO: string | null; words: number; hasSummary: boolean; }

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <div class="eyebrow">{{ greeting() }}</div>
        <h1 class="takeaway">{{ headline() }}</h1>
      </div>
      <a class="btn btn-primary" routerLink="/meetings">+ New meetingyyyyyyyyyyyyyyy</a>
    </div>

    <!-- KPI tiles -->
    <div class="kpis">
      @if (loading()) {
        @for (i of [1,2,3,4]; track i) {
          <div class="kpi"><div class="skel skel-line" style="width:60%"></div><div class="skel" style="height:30px;width:40%;margin:.5rem 0"></div><div class="skel skel-line" style="width:50%"></div></div>
        }
      } @else {
        <div class="kpi accent">
          <span class="cap">◴</span>
          <div class="label">Meetings this week</div>
          <div class="num">{{ kpis().week }}</div>
          <div class="sub">{{ kpis().total }} total in workspace</div>
        </div>
        <div class="kpi">
          <span class="cap">▤</span>
          <div class="label">Hours transcribed (est.)</div>
          <div class="num">{{ kpis().hours }}</div>
          <div class="sub">{{ kpis().transcribed }} meetings transcribed</div>
        </div>
        <div class="kpi">
          <span class="cap">✔</span>
          <div class="label">Open action items</div>
          <div class="num">{{ openTasks() }}</div>
          <div class="sub"><a class="linkbtn" routerLink="/tasks">View tracker →</a></div>
        </div>
        <div class="kpi">
          <span class="cap">▦</span>
          <div class="label">Summaries pending review</div>
          <div class="num">{{ kpis().pending }}</div>
          <div class="sub">AI-generated, awaiting sign-off</div>
        </div>
      }
    </div>

    <div class="split">
      <!-- Recent meetings -->
      <section class="panel">
        <div class="panel-head"><h2>Recent meetings</h2><a class="linkbtn" routerLink="/meetings">All meetings →</a></div>
        @if (loading()) {
          @for (i of [1,2,3,4]; track i) { <div class="skel skel-line" style="height:42px;margin:.4rem 0"></div> }
        } @else if (recent().length === 0) {
          <div class="empty"><span class="em">▢</span><div class="et">No meetings yet</div><div>Create one to start capturing transcripts.</div></div>
        } @else {
          <div class="rows">
            @for (m of recent(); track m.title + m.dateMs) {
              <div class="rowitem">
                <div class="ri-main">
                  <div class="ri-title">{{ m.title }}</div>
                  <div class="ri-sub">{{ m.dateISO ? (m.dateISO | date:'EEE, MMM d • h:mm a') : 'No date' }}</div>
                </div>
                @if (m.hasSummary) { <span class="status summarized">Summarized</span> }
                @if (m.id) { <a class="btn btn-sm btn-ghost" [routerLink]="['/meetings', m.id]">Open</a> }
              </div>
            }
          </div>
        }
      </section>

      <!-- Volume chart -->
      <section class="panel">
        <div class="panel-head"><h2>Meeting volume</h2><span class="dim">last 8 weeks</span></div>
        @if (loading()) {
          <div class="skel" style="height:160px"></div>
        } @else {
          <div class="chart">
            @for (c of volume(); track c.label) {
              <div class="col" [title]="c.value + ' meetings'">
                <div class="val">{{ c.value }}</div>
                <div class="bar" [style.height.%]="c.pct"></div>
                <div class="lbl">{{ c.label }}</div>
              </div>
            }
          </div>
        }
      </section>
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService);
  private cal = inject(GoogleCalendarService);
  private zone = inject(NgZone);
  private auth = inject(AuthService);

  private meetings = signal<Meeting[]>([]);
  private gItems = signal<Item[]>([]);
  openTasks = signal(0);
  loading = signal(true);

  greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const name = (this.auth.user()?.name || '').split(' ')[0];
    return name ? `${part}, ${name}` : part;
  }

  headline = computed(() => {
    const k = this.kpis();
    if (this.loading()) return 'Your meeting intelligence at a glance';
    if (k.week === 0) return 'No meetings scheduled this week';
    return `${k.week} ${k.week === 1 ? 'meeting' : 'meetings'} this week, ${this.openTasks()} action ${this.openTasks() === 1 ? 'item' : 'items'} open`;
  });

  kpis = computed(() => {
    const now = new Date();
    const ws = new Date(now); ws.setDate(now.getDate() - now.getDay()); ws.setHours(0, 0, 0, 0);
    const we = new Date(ws); we.setDate(ws.getDate() + 7);
    const all = this.mergedForCount();
    let week = 0, totalWords = 0, transcribed = 0, pending = 0;
    for (const m of all) {
      if (!isNaN(m.dateMs) && m.dateMs >= ws.getTime() && m.dateMs < we.getTime()) week++;
      if (m.words > 0) { totalWords += m.words; transcribed++; }
      if (m.hasSummary) pending++;
    }
    const hours = totalWords / 130 / 60; // ~130 wpm speaking rate
    return { week, total: all.length, transcribed, pending, hours: hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10 };
  });

  private mergedForCount = computed<Item[]>(() => {
    // DB meetings + Google-only events (deduped by google_event_id) for counts.
    const synced = new Set(this.meetings().map((m) => m.google_event_id).filter(Boolean) as string[]);
    const base: Item[] = this.meetings().map((m) => ({
      id: m.id, title: m.title, dateMs: m.meeting_date ? Date.parse(m.meeting_date) : NaN,
      dateISO: m.meeting_date, words: m.transcript ? m.transcript.trim().split(/\s+/).length : 0, hasSummary: !!m.summary,
    }));
    const extra = this.gItems().filter((g) => !(g as any).gid || !synced.has((g as any).gid));
    return [...base, ...extra];
  });

  recent = computed<Item[]>(() =>
    [...this.mergedForCount()]
      .filter((m) => !isNaN(m.dateMs))
      .sort((a, b) => b.dateMs - a.dateMs)
      .slice(0, 6)
  );

  volume = computed(() => {
    const now = new Date();
    const buckets: { label: string; start: number; end: number; value: number }[] = [];
    const sun = new Date(now); sun.setDate(now.getDate() - now.getDay()); sun.setHours(0, 0, 0, 0);
    for (let i = 7; i >= 0; i--) {
      const s = new Date(sun); s.setDate(sun.getDate() - i * 7);
      const e = new Date(s); e.setDate(s.getDate() + 7);
      buckets.push({ label: s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), start: s.getTime(), end: e.getTime(), value: 0 });
    }
    for (const m of this.mergedForCount()) {
      if (isNaN(m.dateMs)) continue;
      const b = buckets.find((x) => m.dateMs >= x.start && m.dateMs < x.end);
      if (b) b.value++;
    }
    const max = Math.max(1, ...buckets.map((b) => b.value));
    return buckets.map((b) => ({ ...b, pct: Math.round((b.value / max) * 100) }));
  });

  ngOnInit() {
    this.api.listMeetings('all').subscribe({
      next: (m) => { this.meetings.set(m); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.api.listTasks(false).subscribe({ next: (t) => this.openTasks.set(t.length) });
    if (this.cal.wasConnected()) this.syncGoogle();
  }

  private syncGoogle() {
    const now = new Date();
    const min = new Date(now); min.setDate(min.getDate() - 90);
    const max = new Date(now); max.setFullYear(max.getFullYear() + 1);
    this.cal.listEvents(min.toISOString(), max.toISOString(), false)
      .then((events) => this.zone.run(() => {
        if (!events) return;
        this.gItems.set(events.map((e) => ({
          id: null,
          title: e.title,
          dateMs: e.startISO ? Date.parse(e.startISO) : NaN,
          dateISO: e.startISO,
          words: 0,
          hasSummary: false,
          gid: e.id,
        } as any)));
      }))
      .catch(() => {});
  }
}
