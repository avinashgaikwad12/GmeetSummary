import { Component, inject, signal, computed, effect, OnInit, NgZone } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, Meeting } from '../api.service';
import { GoogleCalendarService } from '../google-calendar.service';

type Stage = 'summarized' | 'transcribed' | 'upcoming' | 'completed' | 'cancelled';
type Tab = 'review' | 'upcoming' | 'summarized' | 'all';
type Source = 'all' | 'cadence' | 'google';
type Preset = 'any' | 'today' | '7d' | '30d' | 'quarter' | 'custom';
type Form = { title: string; meeting_date: string; attendees: string; notes: string; status: Meeting['status'] };

interface Row {
  key: string;
  id: number | null;
  title: string;
  dateISO: string | null;
  dateMs: number;
  durationMin: number | null;
  stage: Stage;
  participants: string[];
  source: 'cadence' | 'google';
  htmlLink: string | null;
  meetLink: string | null;
  hasSummary: boolean;
  hasTranscript: boolean;
  needsReview: boolean;
  m: Meeting | null;
}

const STAGE_LABEL: Record<Stage, string> = {
  summarized: 'Summarized', transcribed: 'Transcribed', upcoming: 'Upcoming', completed: 'Completed', cancelled: 'Cancelled',
};
const VIEW_KEY = 'mh_meetings_view';

@Component({
  selector: 'app-meetings',
  imports: [DatePipe, FormsModule],
  styles: [`
    .mtabs { display:flex; gap:.15rem; border-bottom:1px solid var(--line); margin-bottom:1rem; flex-wrap:wrap; }
    .mtabs button { border:none; background:transparent; color:var(--text-dim); font-weight:600; font-size:.9rem;
      padding:.6rem .85rem; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; display:inline-flex; align-items:center; gap:.45rem; }
    .mtabs button:hover { color:var(--text); }
    .mtabs button.active { color:var(--accent); border-bottom-color:var(--accent); }
    .mtabs .cnt { font-size:.7rem; font-weight:700; background:var(--panel); color:var(--text-dim); border-radius:999px; padding:.05rem .4rem; min-width:18px; text-align:center; }
    .mtabs button.active .cnt { background:var(--accent-weak); color:var(--accent); }
    .mtabs button.hot:not(.active) .cnt { background:var(--warn-bg); color:var(--warn); }

    tr.grp-head td { background:var(--bg); font-size:.68rem; font-weight:700; letter-spacing:.08em;
      text-transform:uppercase; color:var(--text-mute); padding:.5rem 1rem; cursor:default; }
    tr.grp-head:hover td { background:var(--bg); }

    .qa { display:flex; gap:.35rem; justify-content:flex-end; align-items:center; white-space:nowrap; }

    .bulkbar { position:sticky; bottom:12px; z-index:20; margin-top:.8rem; display:flex; align-items:center; gap:.6rem;
      background:var(--navy); color:#fff; border-radius:12px; padding:.55rem .9rem; box-shadow:var(--shadow-lg); }
    .bulkbar .bcount { font-weight:700; font-size:.85rem; }
    .bulkbar .btn { background:rgba(255,255,255,.12); border-color:transparent; color:#fff; }
    .bulkbar .btn:hover { background:rgba(255,255,255,.22); }
    .bulkbar .btn:disabled { opacity:.45; }
    .bulkbar .btn-danger { color:#ffd4d4; background:rgba(255,80,80,.15); }

    @media (max-width:560px) {
      table.mtable, table.mtable tbody, table.mtable tr, table.mtable td { display:block; width:100%; }
      table.mtable tr { border:1px solid var(--line); border-radius:12px; margin:.55rem; padding:.3rem 0; }
      table.mtable td { border:none !important; padding:.25rem .9rem; }
      table.mtable tr.grp-head { border:none; background:transparent; margin:.5rem .55rem -.2rem; padding:0; }
      .qa { justify-content:flex-start; flex-wrap:wrap; padding-top:.4rem; }
    }
  `],
  template: `
    <div class="page-head">
      <div>
        <div class="eyebrow">Meeting library</div>
        <h1 class="takeaway">{{ headline() }}</h1>
      </div>
      <div class="row" style="flex-wrap:wrap; justify-content:flex-end">
        @if (connected()) {
          <span class="chip"><span class="dot" style="color:var(--ok)"></span> Google connected</span>
          <button class="btn btn-sm btn-ghost" (click)="connect()" [disabled]="gLoading()" title="Refresh">{{ gLoading() ? '…' : '↻' }}</button>
        } @else {
          <button class="btn btn-sm" (click)="connect()" [disabled]="gLoading()">{{ gLoading() ? 'Connecting…' : 'Connect Google' }}</button>
        }
        <button class="btn btn-primary" (click)="openCreate()">+ New meeting</button>
      </div>
    </div>

    <div class="mtabs">
      <button [class.active]="tab()==='review'" [class.hot]="counts().review>0" (click)="tab.set('review')">To review <span class="cnt">{{ counts().review }}</span></button>
      <button [class.active]="tab()==='upcoming'" (click)="tab.set('upcoming')">Upcoming <span class="cnt">{{ counts().upcoming }}</span></button>
      <button [class.active]="tab()==='summarized'" (click)="tab.set('summarized')">Summarized <span class="cnt">{{ counts().summarized }}</span></button>
      <button [class.active]="tab()==='all'" (click)="tab.set('all')">All <span class="cnt">{{ counts().all }}</span></button>
    </div>

    <div class="filters">
      <input class="search-inp" type="search" placeholder="⌕ Search title or participant…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <select [ngModel]="source()" (ngModelChange)="source.set($event)" title="Source">
        <option value="all">All sources</option>
        <option value="cadence">Cadence</option>
        <option value="google">Calendar</option>
      </select>
      <select [ngModel]="datePreset()" (ngModelChange)="datePreset.set($event)" title="Date range">
        <option value="any">Any time</option>
        <option value="today">Today</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="quarter">This quarter</option>
        <option value="custom">Custom…</option>
      </select>
      @if (datePreset()==='custom') {
        <input type="date" [ngModel]="fromD()" (ngModelChange)="fromD.set($event)" title="From date" />
        <input type="date" [ngModel]="toD()" (ngModelChange)="toD.set($event)" title="To date" />
      }
      @if (q() || source()!=='all' || datePreset()!=='any') {
        <button class="linkbtn" (click)="clearFilters()">Clear</button>
      }
    </div>

    @if (msg()) { <div class="note" style="margin-bottom:1rem">{{ msg() }}</div> }
    @if (error()) { <p class="error-banner">{{ error() }}</p> }
    @if (gError()) { <p class="error-banner">{{ gError() }}</p> }

    @if (loading()) {
      <div class="table-wrap" style="padding:1rem">
        @for (i of [1,2,3,4,5]; track i) { <div class="skel skel-line" style="height:34px;margin:.5rem 0"></div> }
      </div>
    } @else if (rows().length === 0) {
      <div class="table-wrap"><div class="empty">
        <span class="em">{{ tab()==='review' ? '✓' : '▢' }}</span>
        <div class="et">{{ emptyTitle() }}</div>
        <div>{{ emptyHint() }}</div>
      </div></div>
    } @else {
      <div class="table-wrap">
        <table class="data mtable">
          <thead>
            <tr>
              <th style="width:34px"><input type="checkbox" style="width:auto" [checked]="allSelected()" (change)="toggleAll()" title="Select all on screen" /></th>
              <th class="sortable" (click)="sortBy('title')">Meeting <span class="arr">{{ arr('title') }}</span></th>
              <th class="sortable" (click)="sortBy('date')">When <span class="arr">{{ arr('date') }}</span></th>
              <th>Participants</th>
              <th class="sortable" (click)="sortBy('stage')">Status <span class="arr">{{ arr('stage') }}</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (g of grouped(); track g.label) {
              @if (g.label) { <tr class="grp-head"><td colspan="6">{{ g.label }}</td></tr> }
              @for (r of g.rows; track r.key) {
                <tr (click)="open(r)">
                  <td (click)="$event.stopPropagation()" style="width:34px">
                    @if (r.id) { <input type="checkbox" style="width:auto" [checked]="selected().has(r.id)" (change)="togglePick(r.id)" /> }
                  </td>
                  <td>
                    <div class="cell-title">{{ r.title }}</div>
                    <div class="cell-sub">{{ r.source === 'google' ? 'Google Calendar' : 'Cadence' }}</div>
                  </td>
                  <td>
                    {{ r.dateISO ? (r.dateISO | date:'MMM d, y • h:mm a') : '—' }}
                    @if (r.durationMin) { <span class="dim">· {{ r.durationMin }}m</span> }
                  </td>
                  <td>
                    @if (r.participants.length) {
                      <span class="avatars">
                        @for (p of r.participants.slice(0,3); track p) { <span class="av">{{ initials(p) }}</span> }
                        @if (r.participants.length > 3) { <span class="av more">+{{ r.participants.length - 3 }}</span> }
                      </span>
                    } @else { <span class="dim">—</span> }
                  </td>
                  <td><span class="status {{ r.stage }}">{{ label(r.stage) }}</span></td>
                  <td class="qa" (click)="$event.stopPropagation()">
                    @if (r.source === 'google') {
                      @if (r.htmlLink) { <a class="btn btn-sm btn-ghost" [href]="r.htmlLink" target="_blank">Open ↗</a> }
                    } @else {
                      @if (r.stage === 'upcoming' && r.meetLink) {
                        <a class="btn btn-sm btn-primary" [href]="r.meetLink" target="_blank">Join</a>
                      } @else if (r.needsReview) {
                        <button class="btn btn-sm btn-primary" (click)="reviewRow(r)" [disabled]="busyRow(r.id!)">
                          {{ busyRow(r.id!) ? '…' : (r.hasTranscript ? 'Summarize' : 'Pull transcript') }}
                        </button>
                      }
                      <button class="btn btn-sm btn-ghost" (click)="open(r)">Open</button>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
      <p class="dim" style="margin-top:.6rem; font-size:.78rem">{{ rows().length }} shown · transcripts &amp; summaries open inside each meeting.</p>
    }

    @if (selected().size > 0) {
      <div class="bulkbar">
        <span class="bcount">{{ selected().size }} selected</span>
        <button class="btn btn-sm" (click)="combine()" [disabled]="selected().size < 2 || combining()" title="Synthesize one summary across the selected meetings">{{ combining() ? '…' : 'Combine summary' }}</button>
        <button class="btn btn-sm" (click)="exportBulk()">Export</button>
        <button class="btn btn-sm btn-danger" (click)="deleteBulk()" [disabled]="deleting()">{{ deleting() ? '…' : 'Delete' }}</button>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-ghost" (click)="clearSel()" style="color:#fff">Clear</button>
      </div>
    }

    <!-- New meeting dialog -->
    @if (modalOpen()) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>New meeting</h2>
          <label class="field"><span>Title *</span><input [(ngModel)]="form.title" placeholder="Weekly leadership review" /></label>
          <div class="two">
            <label class="field"><span>Date &amp; time</span><input type="datetime-local" [(ngModel)]="form.meeting_date" /></label>
            <label class="field"><span>Status</span>
              <select [(ngModel)]="form.status"><option value="upcoming">Upcoming</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
            </label>
          </div>
          <label class="field"><span>Participants (emails, comma separated)</span><input [(ngModel)]="form.attendees" placeholder="alice@co.com, bob@co.com" /></label>
          <label class="field"><span>Agenda / notes</span><textarea rows="3" [(ngModel)]="form.notes" placeholder="Agenda or context…"></textarea></label>
          <label class="checkrow"><input type="checkbox" [(ngModel)]="syncCal" /><span>Create an auto-transcribing Google Meet &amp; email invites</span></label>
          @if (formError()) { <p class="error-banner">{{ formError() }}</p> }
          <div class="row" style="margin-top:.5rem"><span class="spacer"></span>
            <button class="btn btn-ghost" (click)="close()">Cancel</button>
            <button class="btn btn-primary" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Create meeting' }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Combined summary dialog -->
    @if (combinedOpen()) {
      <div class="modal-backdrop" (click)="combinedOpen.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>Combined summary · {{ selected().size }} meetings</h2>
          @if (combining()) { <div class="empty"><div class="spinner" style="margin:0 auto .6rem"></div>Synthesizing across meetings…</div> }
          @else { <div class="sum-section"><div class="body">{{ combinedText() }}</div></div> }
          <div class="row" style="margin-top:.7rem"><span class="spacer"></span><button class="btn btn-ghost" (click)="combinedOpen.set(false)">Close</button></div>
        </div>
      </div>
    }
  `,
})
export class MeetingsComponent implements OnInit {
  private api = inject(ApiService);
  private cal = inject(GoogleCalendarService);
  private zone = inject(NgZone);
  private router = inject(Router);

  private dbMeetings = signal<Meeting[]>([]);
  private gEvents = signal<any[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  msg = signal<string | null>(null);
  connected = signal(false);
  gLoading = signal(false);
  gError = signal<string | null>(null);

  // ---- View state (restored from localStorage, persisted on change) ----
  private saved = this.readView();
  tab = signal<Tab>(this.saved.tab ?? 'review');
  q = signal(this.saved.q ?? '');
  source = signal<Source>(this.saved.source ?? 'all');
  datePreset = signal<Preset>(this.saved.datePreset ?? 'any');
  fromD = signal(this.saved.fromD ?? '');
  toD = signal(this.saved.toD ?? '');
  sort = signal<{ key: 'title' | 'date' | 'stage'; dir: 1 | -1 }>(this.saved.sort ?? { key: 'date', dir: -1 });

  selected = signal<Set<number>>(new Set());
  private rowBusy = signal<Set<number>>(new Set());
  combinedOpen = signal(false);
  combining = signal(false);
  combinedText = signal('');
  deleting = signal(false);

  modalOpen = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  syncCal = true;
  form: Form = this.blank();

  constructor() {
    // Persist the view whenever any control changes.
    effect(() => {
      const v = { tab: this.tab(), q: this.q(), source: this.source(), datePreset: this.datePreset(), fromD: this.fromD(), toD: this.toD(), sort: this.sort() };
      try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* ignore */ }
    });
  }

  label(s: Stage) { return STAGE_LABEL[s]; }
  initials(p: string) {
    const base = (p.includes('@') ? p.split('@')[0] : p).replace(/[._-]+/g, ' ').trim();
    const parts = base.split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  }

  private all = computed<Row[]>(() => {
    const now = Date.now();
    const synced = new Set(this.dbMeetings().map((m) => m.google_event_id).filter(Boolean) as string[]);
    const rows: Row[] = this.dbMeetings().map((m) => {
      const ms = m.meeting_date ? Date.parse(m.meeting_date) : NaN;
      const hasTranscript = !!(m.transcript && m.transcript.trim());
      const stage: Stage = m.summary ? 'summarized' : hasTranscript ? 'transcribed'
        : m.status === 'cancelled' ? 'cancelled' : !isNaN(ms) && ms > now ? 'upcoming' : 'completed';
      const needsReview = !m.summary && stage !== 'cancelled' && stage !== 'upcoming' && (hasTranscript || !!m.meet_link);
      return {
        key: 'm' + m.id, id: m.id, title: m.title, dateISO: m.meeting_date, dateMs: ms,
        durationMin: null, stage, participants: GoogleCalendarService.parseEmails(m.attendees),
        source: 'cadence' as const, htmlLink: null, meetLink: m.meet_link ?? null,
        hasSummary: !!m.summary, hasTranscript, needsReview, m,
      };
    });
    for (const e of this.gEvents()) {
      if (synced.has(e.id)) continue;
      const ms = e.startISO ? Date.parse(e.startISO) : NaN;
      const stage: Stage = e.myStatus === 'declined' ? 'cancelled' : !isNaN(ms) && ms > now ? 'upcoming' : 'completed';
      const dur = e.startISO && e.endISO ? Math.round((Date.parse(e.endISO) - Date.parse(e.startISO)) / 60000) : null;
      rows.push({
        key: 'g' + e.id, id: null, title: e.title, dateISO: e.startISO, dateMs: ms,
        durationMin: dur && dur > 0 ? dur : null, stage, participants: e.attendees ?? [],
        source: 'google', htmlLink: e.htmlLink ?? null, meetLink: e.htmlLink ?? null,
        hasSummary: false, hasTranscript: false, needsReview: false, m: null,
      });
    }
    return rows;
  });

  counts = computed(() => {
    const a = this.all();
    return {
      review: a.filter((r) => r.needsReview).length,
      upcoming: a.filter((r) => r.stage === 'upcoming').length,
      summarized: a.filter((r) => r.hasSummary).length,
      all: a.length,
    };
  });

  private range = computed<{ from: number | null; to: number | null }>(() => {
    const p = this.datePreset();
    if (p === 'any') return { from: null, to: null };
    if (p === 'custom') return { from: this.fromD() ? Date.parse(this.fromD()) : null, to: this.toD() ? Date.parse(this.toD()) + 86400000 : null };
    const sod = new Date(); sod.setHours(0, 0, 0, 0);
    const start = sod.getTime(), day = 86400000, end = Date.now() + day;
    if (p === 'today') return { from: start, to: start + day };
    if (p === '7d') return { from: start - 6 * day, to: end };
    if (p === '30d') return { from: start - 29 * day, to: end };
    if (p === 'quarter') return { from: start - 89 * day, to: end };
    return { from: null, to: null };
  });

  rows = computed<Row[]>(() => {
    const tab = this.tab(), query = this.q().trim().toLowerCase(), src = this.source();
    const { from, to } = this.range();
    let out = this.all().filter((r) => {
      if (tab === 'review' && !r.needsReview) return false;
      if (tab === 'upcoming' && r.stage !== 'upcoming') return false;
      if (tab === 'summarized' && !r.hasSummary) return false;
      if (src !== 'all' && r.source !== src) return false;
      if (query && !(r.title.toLowerCase().includes(query) || r.participants.join(' ').toLowerCase().includes(query))) return false;
      if (from !== null && (isNaN(r.dateMs) || r.dateMs < from)) return false;
      if (to !== null && (isNaN(r.dateMs) || r.dateMs >= to)) return false;
      return true;
    });
    const { key, dir } = this.sort();
    out = [...out].sort((a, b) => {
      let c = 0;
      if (key === 'title') c = a.title.localeCompare(b.title);
      else if (key === 'stage') c = a.stage.localeCompare(b.stage);
      else { const am = isNaN(a.dateMs) ? -Infinity : a.dateMs, bm = isNaN(b.dateMs) ? -Infinity : b.dateMs; c = am - bm; }
      return c * dir;
    });
    return out;
  });

  // Group consecutive rows by relative-date bucket (only when sorted by date).
  grouped = computed<{ label: string; rows: Row[] }[]>(() => {
    const rows = this.rows();
    if (this.sort().key !== 'date') return [{ label: '', rows }];
    const groups: { label: string; rows: Row[] }[] = [];
    for (const r of rows) {
      const label = this.bucket(r.dateMs);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.rows.push(r);
      else groups.push({ label, rows: [r] });
    }
    return groups;
  });

  private bucket(ms: number): string {
    if (isNaN(ms)) return 'No date';
    const sod = new Date(); sod.setHours(0, 0, 0, 0);
    const today = sod.getTime(), day = 86400000;
    if (ms >= today + day) {
      if (ms < today + 2 * day) return 'Tomorrow';
      if (ms < today + 7 * day) return 'This week';
      return 'Later';
    }
    if (ms >= today) return 'Today';
    if (ms >= today - day) return 'Yesterday';
    if (ms >= today - 7 * day) return 'Earlier this week';
    if (ms >= today - 30 * day) return 'This month';
    return 'Earlier';
  }

  headline = computed(() => {
    if (this.loading()) return 'Browse and filter every meeting';
    const c = this.counts();
    return `${c.all} meetings · ${c.review} to review · ${c.summarized} summarized`;
  });

  emptyTitle = computed(() => {
    if (this.q() || this.source() !== 'all' || this.datePreset() !== 'any') return 'No meetings match your filters';
    switch (this.tab()) {
      case 'review': return 'You’re all caught up';
      case 'upcoming': return 'Nothing on the calendar';
      case 'summarized': return 'No summaries yet';
      default: return 'No meetings yet';
    }
  });
  emptyHint = computed(() => {
    if (this.tab() === 'review') return 'Every past meeting has a summary. New transcripts show up here automatically.';
    if (!this.connected()) return 'Create a meeting, or connect Google Calendar to pull in your schedule.';
    return 'Create a meeting to get started.';
  });

  arr(key: string) { const s = this.sort(); return s.key === key ? (s.dir === 1 ? '▲' : '▼') : ''; }
  sortBy(key: 'title' | 'date' | 'stage') {
    const s = this.sort();
    this.sort.set({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : (key === 'date' ? -1 : 1) });
  }
  clearFilters() { this.q.set(''); this.source.set('all'); this.datePreset.set('any'); this.fromD.set(''); this.toD.set(''); }

  open(r: Row) {
    if (r.id) this.router.navigate(['/meetings', r.id]);
    else if (r.htmlLink) window.open(r.htmlLink, '_blank');
  }

  // ---- Selection ----
  togglePick(id: number) {
    this.selected.update((set) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  private visibleIds = computed(() => this.rows().filter((r) => r.id != null).map((r) => r.id!));
  allSelected = computed(() => { const ids = this.visibleIds(); return ids.length > 0 && ids.every((id) => this.selected().has(id)); });
  toggleAll() {
    const ids = this.visibleIds();
    this.selected.update((set) => {
      const n = new Set(set);
      if (ids.every((id) => n.has(id))) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }
  clearSel() { this.selected.set(new Set()); }

  busyRow(id: number) { return this.rowBusy().has(id); }
  private setBusy(id: number, on: boolean) {
    this.rowBusy.update((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });
  }

  // ---- Inline "To review" action: summarize or pull the Meet transcript ----
  async reviewRow(r: Row) {
    if (!r.id || !r.m) return;
    const m = r.m, id = r.id;
    this.setBusy(id, true); this.msg.set(null); this.error.set(null);
    try {
      if (m.transcript && m.transcript.trim() && !m.summary) {
        await firstValueFrom(this.api.summarizeMeeting(id, m.transcript));
        this.zone.run(() => this.msg.set(`Summary generated for “${m.title}”.`));
      } else if (m.meet_link) {
        const code = GoogleCalendarService.meetingCode(m.meet_link);
        if (!code) { this.zone.run(() => this.msg.set('This meeting has no valid Google Meet link.')); return; }
        const confs = await this.cal.getMeetConferences(code, true);
        const existing = await firstValueFrom(this.api.listSessions(id));
        const have = new Set(existing.map((s) => s.conference_record));
        let added = 0;
        for (const c of confs.filter((c) => !have.has(c.record))) {
          const t = await this.cal.getTranscriptForRecord(c.record, false);
          if (!t) continue;
          await firstValueFrom(this.api.addSession(id, { conference_record: c.record, started_at: c.startTime, ended_at: c.endTime, transcript: t }));
          added++;
        }
        this.zone.run(() => this.msg.set(added
          ? `Pulled & summarized ${added} session(s) for “${m.title}”.`
          : 'No new transcript was available yet — try again a few minutes after the call ends.'));
      }
      this.zone.run(() => this.load());
    } catch (e: any) {
      this.zone.run(() => this.error.set(this.meetErr(e)));
    } finally {
      this.zone.run(() => this.setBusy(id, false));
    }
  }

  // ---- Bulk actions ----
  combine() {
    const ids = [...this.selected()];
    if (ids.length < 2) return;
    this.combinedOpen.set(true); this.combining.set(true); this.combinedText.set('');
    this.api.combinedSummary(ids).subscribe({
      next: ({ summary }) => { this.combining.set(false); this.combinedText.set(summary); },
      error: (e) => { this.combining.set(false); this.combinedText.set(e?.error?.error ?? 'Could not build the combined summary.'); },
    });
  }

  exportBulk() {
    const sel = this.rows().filter((r) => r.id && this.selected().has(r.id));
    if (!sel.length) return;
    const md = sel.map((r) =>
      `# ${r.title}\n\n` +
      (r.dateISO ? `**Date:** ${new Date(r.dateISO).toLocaleString()}\n\n` : '') +
      `**Status:** ${this.label(r.stage)}\n\n` +
      `## Summary\n\n${r.m?.summary?.trim() || '_(no summary yet)_'}\n`
    ).join('\n\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `meetings-export-${new Date().toISOString().slice(0, 10)}.md`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  async deleteBulk() {
    const ids = [...this.selected()];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} meeting${ids.length > 1 ? 's' : ''}? This can’t be undone.`)) return;
    this.deleting.set(true);
    try {
      await Promise.all(ids.map((id) => firstValueFrom(this.api.deleteMeeting(id)).catch(() => null)));
      this.msg.set(`Deleted ${ids.length} meeting${ids.length > 1 ? 's' : ''}.`);
      this.clearSel();
      this.load();
    } finally { this.deleting.set(false); }
  }

  ngOnInit() {
    this.load();
    this.syncGoogle(!this.cal.wasConnected());
  }

  load() {
    this.loading.set(true);
    this.api.listMeetings('all').subscribe({
      next: (m) => { this.dbMeetings.set(m); this.loading.set(false); this.autoSummarizePast(); },
      error: () => { this.error.set('Could not load meetings.'); this.loading.set(false); },
    });
  }

  connect() { this.syncGoogle(true); }
  private syncGoogle(interactive: boolean) {
    const now = new Date();
    const min = new Date(now); min.setDate(min.getDate() - 90);
    const max = new Date(now); max.setFullYear(max.getFullYear() + 1);
    this.gLoading.set(true); this.gError.set(null);
    this.cal.listEvents(min.toISOString(), max.toISOString(), interactive)
      .then((events) => this.zone.run(() => {
        this.gLoading.set(false);
        if (events === null) { this.connected.set(false); return; }
        this.connected.set(true); this.gEvents.set(events); this.autoSummarizePast();
      }))
      .catch((e) => this.zone.run(() => { this.gLoading.set(false); this.gError.set(this.meetErr(e)); }));
  }

  // ---- New meeting ----
  private blank(): Form { return { title: '', meeting_date: '', attendees: '', notes: '', status: 'upcoming' }; }
  openCreate() { this.form = this.blank(); this.syncCal = true; this.formError.set(null); this.modalOpen.set(true); }
  close() { this.modalOpen.set(false); }

  async save() {
    if (!this.form.title.trim()) { this.formError.set('Title is required.'); return; }
    const startISO = this.form.meeting_date ? new Date(this.form.meeting_date).toISOString() : '';
    const body: Partial<Meeting> = {
      title: this.form.title.trim(), meeting_date: startISO, attendees: this.form.attendees, notes: this.form.notes, status: this.form.status,
    };
    const wantSync = this.syncCal && !!startISO;
    if (this.syncCal && !startISO) { this.formError.set('Pick a date & time to create the Google Meet — or uncheck that option.'); return; }
    this.saving.set(true); this.formError.set(null);

    let ev = null as Awaited<ReturnType<GoogleCalendarService['createEvent']>> | null;
    if (wantSync) {
      try {
        const attendees = GoogleCalendarService.parseEmails(this.form.attendees);
        ev = await this.cal.createEvent({ title: body.title!, description: body.notes ?? '', startISO, attendees });
      } catch (e: any) { this.zone.run(() => { this.saving.set(false); this.formError.set(this.meetErr(e)); }); return; }
    }
    const eventRef = ev;
    this.zone.run(() => {
      this.api.createMeeting(body).subscribe({
        next: (created) => {
          if (!eventRef) { this.saving.set(false); this.modalOpen.set(false); this.load(); return; }
          this.api.updateMeeting(created.id, { google_event_id: eventRef.eventId, meet_link: eventRef.meetLink ?? undefined, rsvp: eventRef.rsvp }).subscribe({
            next: () => { this.saving.set(false); this.modalOpen.set(false); this.load(); },
            error: () => { this.saving.set(false); this.modalOpen.set(false); this.load(); },
          });
        },
        error: () => { this.saving.set(false); this.formError.set('Could not save the meeting.'); },
      });
    });
  }

  // ---- Background: summarize finished Meet conferences for our meetings ----
  private autoRunning = false;
  private async autoSummarizePast() {
    if (this.autoRunning || !this.cal.isConnected()) return;
    this.autoRunning = true;
    try {
      const now = Date.now(), horizon = now - 60 * 24 * 3600 * 1000;
      const candidates = this.dbMeetings()
        .filter((m) => !!m.google_event_id && !!m.meet_link && !!m.meeting_date && Date.parse(m.meeting_date) < now && Date.parse(m.meeting_date) > horizon)
        .slice(0, 8);
      let changed = false;
      for (const m of candidates) {
        if (!this.throttleOk(m.id)) continue;
        const code = GoogleCalendarService.meetingCode(m.meet_link);
        if (!code) continue;
        try {
          const confs = await this.cal.getMeetConferences(code, false);
          if (!confs.length) continue;
          const existing = await firstValueFrom(this.api.listSessions(m.id));
          const have = new Set(existing.map((s) => s.conference_record));
          for (const c of confs) {
            if (have.has(c.record)) continue;
            const t = await this.cal.getTranscriptForRecord(c.record, false);
            if (!t) continue;
            await firstValueFrom(this.api.addSession(m.id, { conference_record: c.record, started_at: c.startTime, ended_at: c.endTime, transcript: t }));
            changed = true;
          }
        } catch { /* ignore in background */ }
      }
      if (changed) this.zone.run(() => this.load());
    } finally { this.autoRunning = false; }
  }
  private throttleOk(id: number): boolean {
    try {
      const k = 'mh_sum_try:' + id, last = Number(localStorage.getItem(k) || 0);
      if (Date.now() - last < 5 * 60 * 1000) return false;
      localStorage.setItem(k, String(Date.now())); return true;
    } catch { return true; }
  }

  private readView(): Partial<{ tab: Tab; q: string; source: Source; datePreset: Preset; fromD: string; toD: string; sort: { key: 'title' | 'date' | 'stage'; dir: 1 | -1 } }> {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch { return {}; }
  }

  private meetErr(e: any): string {
    const s = JSON.stringify(e?.message ?? e?.error ?? e ?? '').toLowerCase();
    if (s.includes('wrong_account'))
      return 'The Google account you picked doesn’t match the account you’re signed in with. In the Google popup, choose the same account you logged into the app with.';
    if (s.includes('not_connected') || s.includes('denied') || s.includes('closed') || s.includes('popup'))
      return 'Google permission wasn’t granted. Click again and choose Allow.';
    if (s.includes('403') || s.includes('permission') || s.includes('disabled'))
      return 'Google access failed — check the Meet/Calendar APIs are enabled and scopes are consented.';
    return 'Couldn’t reach Google. Please try again.';
  }
}
