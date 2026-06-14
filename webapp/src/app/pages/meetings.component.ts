import { Component, inject, signal, computed, OnInit, NgZone } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, Meeting } from '../api.service';
import { GoogleCalendarService } from '../google-calendar.service';

type Stage = 'summarized' | 'transcribed' | 'upcoming' | 'completed' | 'cancelled';
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
  hasSummary: boolean;
}

const STAGE_LABEL: Record<Stage, string> = {
  summarized: 'Summarized', transcribed: 'Transcribed', upcoming: 'Upcoming', completed: 'Completed', cancelled: 'Cancelled',
};

@Component({
  selector: 'app-meetings',
  imports: [DatePipe, FormsModule],
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
        @if (selected().size > 1) {
          <button class="btn btn-sm" (click)="combine()" [disabled]="combining()">{{ combining() ? '…' : 'Combine ' + selected().size }}</button>
        }
        <button class="btn btn-primary" (click)="openCreate()">+ New meeting</button>
      </div>
    </div>

    <div class="filters">
      <input class="search-inp" type="search" placeholder="⌕ Search title or participant…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <div class="seg">
        @for (s of statusFilters; track s) {
          <button [class.active]="statusF()===s" (click)="statusF.set(s)">{{ s }}</button>
        }
      </div>
      <input type="date" [ngModel]="fromD()" (ngModelChange)="fromD.set($event)" title="From date" />
      <input type="date" [ngModel]="toD()" (ngModelChange)="toD.set($event)" title="To date" />
      @if (q() || statusF()!=='all' || fromD() || toD()) {
        <button class="linkbtn" (click)="clearFilters()">Clear</button>
      }
    </div>

    @if (error()) { <p class="error-banner">{{ error() }}</p> }
    @if (gError()) { <p class="error-banner">{{ gError() }}</p> }

    @if (loading()) {
      <div class="table-wrap" style="padding:1rem">
        @for (i of [1,2,3,4,5]; track i) { <div class="skel skel-line" style="height:34px;margin:.5rem 0"></div> }
      </div>
    } @else if (rows().length === 0) {
      <div class="table-wrap"><div class="empty">
        <span class="em">▢</span>
        <div class="et">{{ q() || statusF()!=='all' ? 'No meetings match your filters' : 'No meetings yet' }}</div>
        <div>Create a meeting@if (!connected()) {, or connect Google Calendar} to get started.</div>
      </div></div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th class="sortable" (click)="sortBy('title')">Meeting <span class="arr">{{ arr('title') }}</span></th>
              <th class="sortable" (click)="sortBy('date')">Date &amp; time <span class="arr">{{ arr('date') }}</span></th>
              <th>Duration</th>
              <th>Participants</th>
              <th class="sortable" (click)="sortBy('stage')">Status <span class="arr">{{ arr('stage') }}</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.key) {
              <tr (click)="open(r)">
                <td>
                  <div class="cell-title">{{ r.title }}</div>
                  <div class="cell-sub">{{ r.source === 'google' ? 'Google Calendar' : 'Cadence' }}</div>
                </td>
                <td>{{ r.dateISO ? (r.dateISO | date:'MMM d, y • h:mm a') : '—' }}</td>
                <td>{{ r.durationMin ? r.durationMin + ' min' : '—' }}</td>
                <td>
                  @if (r.participants.length) {
                    <span class="avatars">
                      @for (p of r.participants.slice(0,3); track p) { <span class="av">{{ initials(p) }}</span> }
                      @if (r.participants.length > 3) { <span class="av more">+{{ r.participants.length - 3 }}</span> }
                    </span>
                  } @else { <span class="dim">—</span> }
                </td>
                <td><span class="status {{ r.stage }}">{{ label(r.stage) }}</span></td>
                <td (click)="$event.stopPropagation()" style="text-align:right; white-space:nowrap">
                  @if (r.hasSummary) {
                    <input type="checkbox" style="width:auto" title="Select for combined summary"
                           [checked]="selected().has(r.id!)" (change)="togglePick(r.id!)" />
                  }
                  @if (r.id) { <button class="btn btn-sm btn-ghost" (click)="open(r)">Open</button> }
                  @else if (r.htmlLink) { <a class="btn btn-sm btn-ghost" [href]="r.htmlLink" target="_blank">Google ↗</a> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="dim" style="margin-top:.6rem; font-size:.78rem">{{ rows().length }} meetings · transcripts &amp; summaries open inside each meeting.</p>
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
  connected = signal(false);
  gLoading = signal(false);
  gError = signal<string | null>(null);

  q = signal('');
  statusFilters = ['all', 'upcoming', 'completed', 'summarized', 'cancelled'] as const;
  statusF = signal<(typeof this.statusFilters)[number]>('all');
  fromD = signal('');
  toD = signal('');
  sort = signal<{ key: 'title' | 'date' | 'stage'; dir: 1 | -1 }>({ key: 'date', dir: -1 });

  selected = signal<Set<number>>(new Set());
  combinedOpen = signal(false);
  combining = signal(false);
  combinedText = signal('');

  modalOpen = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  syncCal = true;
  form: Form = this.blank();

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
      const stage: Stage = m.summary ? 'summarized' : m.transcript ? 'transcribed'
        : m.status === 'cancelled' ? 'cancelled' : !isNaN(ms) && ms > now ? 'upcoming' : 'completed';
      return {
        key: 'm' + m.id, id: m.id, title: m.title, dateISO: m.meeting_date, dateMs: ms,
        durationMin: null, stage, participants: GoogleCalendarService.parseEmails(m.attendees),
        source: 'cadence' as const, htmlLink: null, hasSummary: !!m.summary,
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
        source: 'google', htmlLink: e.htmlLink ?? null, hasSummary: false,
      });
    }
    return rows;
  });

  rows = computed<Row[]>(() => {
    const query = this.q().trim().toLowerCase();
    const sf = this.statusF();
    const from = this.fromD() ? Date.parse(this.fromD()) : null;
    const to = this.toD() ? Date.parse(this.toD()) + 86400000 : null;
    let out = this.all().filter((r) => {
      if (query && !(r.title.toLowerCase().includes(query) || r.participants.join(' ').toLowerCase().includes(query))) return false;
      if (sf !== 'all') {
        if (sf === 'completed' && !(r.stage === 'completed' || r.stage === 'transcribed')) return false;
        if (sf !== 'completed' && r.stage !== sf) return false;
      }
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

  headline = computed(() => {
    if (this.loading()) return 'Browse and filter every meeting';
    const summ = this.all().filter((r) => r.hasSummary).length;
    return `${this.all().length} meetings · ${summ} summarized`;
  });

  arr(key: string) { const s = this.sort(); return s.key === key ? (s.dir === 1 ? '▲' : '▼') : ''; }
  sortBy(key: 'title' | 'date' | 'stage') {
    const s = this.sort();
    this.sort.set({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : (key === 'date' ? -1 : 1) });
  }
  setStatus(s: (typeof this.statusFilters)[number]) { this.statusF.set(s); }
  clearFilters() { this.q.set(''); this.statusF.set('all'); this.fromD.set(''); this.toD.set(''); }

  open(r: Row) {
    if (r.id) this.router.navigate(['/meetings', r.id]);
    else if (r.htmlLink) window.open(r.htmlLink, '_blank');
  }

  togglePick(id: number) {
    this.selected.update((set) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  combine() {
    const ids = [...this.selected()];
    if (ids.length < 2) return;
    this.combinedOpen.set(true); this.combining.set(true); this.combinedText.set('');
    this.api.combinedSummary(ids).subscribe({
      next: ({ summary }) => { this.combining.set(false); this.combinedText.set(summary); },
      error: (e) => { this.combining.set(false); this.combinedText.set(e?.error?.error ?? 'Could not build the combined summary.'); },
    });
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

  private meetErr(e: any): string {
    const s = JSON.stringify(e?.message ?? e?.error ?? e ?? '').toLowerCase();
    if (s.includes('not_connected') || s.includes('denied') || s.includes('closed') || s.includes('popup'))
      return 'Google permission wasn’t granted. Click again and choose Allow.';
    if (s.includes('403') || s.includes('permission') || s.includes('disabled'))
      return 'Google access failed — check the Meet/Calendar APIs are enabled and scopes are consented.';
    return 'Couldn’t reach Google. Please try again.';
  }
}
