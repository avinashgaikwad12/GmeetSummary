import { Component, inject, signal, computed, OnInit, NgZone } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Meeting, Rsvp } from '../api.service';
import { GoogleCalendarService, GEvent } from '../google-calendar.service';

type Form = {
  title: string; meeting_date: string; attendees: string;
  meet_link: string; notes: string; status: Meeting['status'];
};

type Status = 'upcoming' | 'completed' | 'cancelled';

/** Unified row: either a MeetHub DB meeting or a Google Calendar event. */
interface Row {
  key: string;
  title: string;
  dateISO: string | null;
  dateMs: number;          // for sorting; NaN when no date
  status: Status;
  attendees: string | null;
  notes: string | null;
  meetLink: string | null;
  htmlLink: string | null; // Google event page
  source: 'meethub' | 'google';
  onGoogle: boolean;       // shows the "On Google Calendar" badge
  meeting?: Meeting;       // present for source === 'meethub'
  rsvp?: Rsvp[] | null;
}

const RSVP_LABEL: Record<string, string> = {
  accepted: 'Accepted', declined: 'Declined', tentative: 'Maybe', needsAction: 'Pending',
};

@Component({
  selector: 'app-meetings',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="page-head">
      <div><h1>Meetings</h1><p class="muted">Your MeetHub meetings and Google Calendar events, together.</p></div>
      <div class="head-actions">
        @if (connected()) {
          <span class="synced">📆 Google Calendar</span>
          <button class="btn btn-sm" (click)="connect()" [disabled]="gLoading()" title="Refresh calendar">{{ gLoading() ? '…' : '↻' }}</button>
        } @else {
          <button class="btn btn-sm" (click)="connect()" [disabled]="gLoading()">{{ gLoading() ? 'Connecting…' : 'Connect Google Calendar' }}</button>
        }
        <button class="btn btn-primary" (click)="openCreate()">+ New meeting</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="tabs">
        @for (f of filters; track f) {
          <button class="tab" [class.active]="status()===f" (click)="setStatus(f)">{{ f }}</button>
        }
      </div>
      <input class="search" type="search" placeholder="🔍 Search meetings…"
             [ngModel]="q()" (ngModelChange)="q.set($event)" />
    </div>

    @if (error()) { <p class="error-banner">{{ error() }}</p> }
    @if (gError()) { <p class="error-banner">{{ gError() }}</p> }

    <div class="scroll">
    @if (loading()) {
      <div class="empty">Loading…</div>
    } @else if (rows().length === 0) {
      <div class="card card-pad empty"><span class="em">📅</span>Nothing here yet. Click <b>New meeting</b> to add one@if (!connected()) {, or <b>Connect Google Calendar</b> to pull in your events}.</div>
    } @else {
      <div class="list">
        @for (r of rows(); track r.key) {
          <div class="card card-pad mtg">
            <div class="mtg-main">
              <div class="row" style="align-items:flex-start; justify-content:flex-start; gap:.6rem">
                <h3>{{ r.title }}</h3>
                <span class="badge {{r.status}}">{{ r.status }}</span>
                @if (r.source === 'google') { <span class="gtag">📆 Google Calendar</span> }
                @else if (r.onGoogle) { <span class="synced">📆 On Google Calendar</span> }
              </div>
              <div class="meta">
                <span>🗓️ {{ r.dateISO ? (r.dateISO | date:'EEE, MMM d, y • h:mm a') : 'No date' }}</span>
                @if (r.attendees) { <span>👥 {{ r.attendees }}</span> }
              </div>
              @if (r.notes) { <p class="notes">{{ r.notes }}</p> }

              @if (r.rsvp && r.rsvp.length) {
                <div class="rsvps">
                  @for (rv of r.rsvp; track rv.email) {
                    <span class="rsvp {{rv.status}}" [title]="rv.email">{{ rv.email }} · {{ label(rv.status) }}</span>
                  }
                </div>
              }
              @if (r.meeting && syncMsg()[r.meeting.id]) { <div class="syncmsg">{{ syncMsg()[r.meeting.id] }}</div> }
            </div>
            <div class="mtg-actions">
              @if (r.meetLink) { <a class="btn btn-sm btn-primary" [href]="r.meetLink" target="_blank">Join</a> }
              @if (r.source === 'google') {
                @if (r.htmlLink) { <a class="btn btn-sm" [href]="r.htmlLink" target="_blank">Open</a> }
              } @else if (r.meeting) {
                @if (r.meeting.google_event_id) { <button class="btn btn-sm" (click)="syncRsvp(r.meeting)">↻ RSVPs</button> }
                <button class="btn btn-sm" (click)="openEdit(r.meeting)">Edit</button>
                <button class="btn btn-sm btn-danger" (click)="remove(r.meeting)">Delete</button>
              }
            </div>
          </div>
        }
      </div>
    }
    </div>

    <!-- Modal -->
    @if (modalOpen()) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>{{ editingId() ? 'Edit meeting' : 'New meeting' }}</h2>
          <label class="field"><span>Title *</span>
            <input [(ngModel)]="form.title" placeholder="Weekly standup" /></label>
          <div class="two">
            <label class="field"><span>Date & time</span>
              <input type="datetime-local" [(ngModel)]="form.meeting_date" /></label>
            <label class="field"><span>Status</span>
              <select [(ngModel)]="form.status">
                <option value="upcoming">Upcoming</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select></label>
          </div>
          <label class="field"><span>Attendees (emails, comma separated)</span>
            <input [(ngModel)]="form.attendees" placeholder="alice@gmail.com, bob@company.com" /></label>
          <label class="field"><span>Notes / transcript</span>
            <textarea rows="3" [(ngModel)]="form.notes" placeholder="Agenda, notes or paste a transcript…"></textarea></label>

          @if (!editingId()) {
            <label class="checkrow">
              <input type="checkbox" [(ngModel)]="syncCal" />
              <span>Add to my Google Calendar & email invites (auto-creates a Meet link)</span>
            </label>
          } @else {
            <label class="field"><span>Google Meet link</span>
              <input [(ngModel)]="form.meet_link" placeholder="https://meet.google.com/…" /></label>
          }

          @if (formError()) { <p class="error-banner">{{ formError() }}</p> }
          <div class="row" style="margin-top:.5rem">
            <span class="spacer"></span>
            <button class="btn btn-ghost" (click)="close()">Cancel</button>
            <button class="btn btn-primary" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : (editingId() ? 'Save changes' : 'Create meeting') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display:flex; flex-direction:column; height: calc(100vh - 105px); min-height: 420px; }
    .page-head { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; margin-bottom:1.2rem; flex-shrink:0; }
    .head-actions { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; justify-content:flex-end; }
    h1 { font-size:1.5rem; }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem; flex-wrap:wrap; flex-shrink:0; }
    .error-banner { flex-shrink:0; }
    .scroll { flex:1; min-height:0; overflow-y:auto; padding-right:.3rem; margin-right:-.3rem; }
    .tabs { display:flex; gap:.3rem; background:var(--surface); border:1px solid var(--border); padding:.25rem; border-radius:12px; }
    .tab { border:none; background:transparent; color:var(--text-dim); font-weight:600; font-size:.85rem;
      padding:.4rem .8rem; border-radius:9px; cursor:pointer; text-transform:capitalize; }
    .tab.active { background:var(--brand-grad); color:#fff; }
    .search { max-width:280px; }
    .list { display:flex; flex-direction:column; gap:.8rem; }
    .mtg { display:flex; align-items:flex-start; gap:1rem; justify-content:space-between; }
    .mtg-main { min-width:0; flex:1; }
    h3 { font-size:1.05rem; }
    .synced { font-size:.72rem; font-weight:700; color:var(--green); background:var(--green-bg); padding:.15rem .5rem; border-radius:999px; }
    .gtag { font-size:.72rem; font-weight:700; color:var(--brand); background:#ede9fe; padding:.15rem .5rem; border-radius:999px; }
    .meta { display:flex; flex-wrap:wrap; gap:.9rem; color:var(--text-dim); font-size:.83rem; margin-top:.4rem; }
    .notes { margin:.6rem 0 0; font-size:.88rem; color:var(--text-dim); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .rsvps { display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.7rem; }
    .rsvp { font-size:.72rem; font-weight:600; padding:.18rem .5rem; border-radius:999px; background:var(--surface-2); color:var(--text-dim); }
    .rsvp.accepted { background:var(--green-bg); color:var(--green); }
    .rsvp.declined { background:var(--red-bg); color:var(--red); }
    .rsvp.tentative { background:var(--amber-bg); color:var(--amber); }
    .syncmsg { margin-top:.5rem; font-size:.8rem; color:var(--text-dim); }
    .mtg-actions { display:flex; gap:.4rem; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end; max-width:230px; }
    .two { display:grid; grid-template-columns:1fr 1fr; gap:.7rem; }
    .checkrow { display:flex; align-items:flex-start; gap:.6rem; font-size:.85rem; margin:.3rem 0 .9rem; cursor:pointer; }
    .checkrow input { width:auto; margin-top:.15rem; }
    @media (max-width:700px){ :host{ height:auto; } .mtg{ flex-direction:column; } .mtg-actions{ max-width:none; } }
  `],
})
export class MeetingsComponent implements OnInit {
  private api = inject(ApiService);
  private cal = inject(GoogleCalendarService);
  private zone = inject(NgZone);

  filters: Array<'all' | Status> = ['all', 'upcoming', 'completed', 'cancelled'];
  private dbMeetings = signal<Meeting[]>([]);
  private gEvents = signal<GEvent[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  status = signal<'all' | Status>('all');
  q = signal('');

  connected = signal(false);
  gLoading = signal(false);
  gError = signal<string | null>(null);

  modalOpen = signal(false);
  editingId = signal<number | null>(null);
  saving = signal(false);
  formError = signal<string | null>(null);
  syncCal = true;
  form: Form = this.blank();

  // Per-meeting status messages (e.g. RSVP refresh results).
  syncMsg = signal<Record<number, string>>({});

  /** Merged + filtered list shown in the page. */
  rows = computed<Row[]>(() => {
    const now = Date.now();
    const dbs = this.dbMeetings();
    const synced = new Set(dbs.map((m) => m.google_event_id).filter(Boolean) as string[]);

    const rows: Row[] = dbs.map((m) => ({
      key: 'm' + m.id,
      title: m.title,
      dateISO: m.meeting_date,
      dateMs: m.meeting_date ? Date.parse(m.meeting_date) : NaN,
      status: m.status,
      attendees: m.attendees,
      notes: m.notes,
      meetLink: m.meet_link,
      htmlLink: null,
      source: 'meethub',
      onGoogle: !!m.google_event_id,
      meeting: m,
      rsvp: m.rsvp,
    }));

    for (const e of this.gEvents()) {
      if (synced.has(e.id)) continue; // already shown as a MeetHub meeting
      const ms = e.startISO ? Date.parse(e.startISO) : NaN;
      const status: Status =
        e.myStatus === 'declined' ? 'cancelled' : !isNaN(ms) && ms > now ? 'upcoming' : 'completed';
      rows.push({
        key: 'g' + e.id,
        title: e.title,
        dateISO: e.startISO,
        dateMs: ms,
        status,
        attendees: e.attendees.length ? e.attendees.join(', ') : null,
        notes: e.description,
        meetLink: e.meetLink,
        htmlLink: e.htmlLink,
        source: 'google',
        onGoogle: false,
      });
    }

    const st = this.status();
    const query = this.q().trim().toLowerCase();
    let out = st === 'all' ? rows : rows.filter((r) => r.status === st);
    if (query) {
      out = out.filter(
        (r) =>
          r.title.toLowerCase().includes(query) ||
          (r.attendees ?? '').toLowerCase().includes(query) ||
          (r.notes ?? '').toLowerCase().includes(query)
      );
    }

    // Chronological: upcoming/all earliest→latest; past lists most-recent first.
    const asc = st === 'upcoming' || st === 'all';
    out.sort((a, b) => {
      if (isNaN(a.dateMs) && isNaN(b.dateMs)) return 0;
      if (isNaN(a.dateMs)) return 1;
      if (isNaN(b.dateMs)) return -1;
      return asc ? a.dateMs - b.dateMs : b.dateMs - a.dateMs;
    });
    return out;
  });

  ngOnInit() {
    this.load();
    // Auto-connect: returning users sync silently; first-timers get Google's
    // own consent screen right away (no app "Connect" click needed).
    this.syncGoogle(!this.cal.wasConnected());
  }

  label(s: string) { return RSVP_LABEL[s] ?? s; }
  private blank(): Form {
    return { title: '', meeting_date: '', attendees: '', meet_link: '', notes: '', status: 'upcoming' };
  }
  private setMsg(id: number, msg: string) {
    this.zone.run(() => this.syncMsg.update((m) => ({ ...m, [id]: msg })));
  }

  load() {
    this.loading.set(true);
    // Always fetch every meeting; filtering by tab/search happens client-side so
    // it can be applied uniformly to Google events too.
    this.api.listMeetings('all').subscribe({
      next: (m) => { this.dbMeetings.set(m); this.loading.set(false); },
      error: () => { this.error.set('Could not load meetings.'); this.loading.set(false); },
    });
  }

  connect() { this.syncGoogle(true); }

  /** Pull Google Calendar events into the list (silent unless interactive). */
  private syncGoogle(interactive: boolean) {
    // A wide window: recent past (shown as completed) through the next year.
    const now = new Date();
    const min = new Date(now); min.setDate(min.getDate() - 90);
    const max = new Date(now); max.setFullYear(max.getFullYear() + 1);
    this.gLoading.set(true);
    this.gError.set(null);
    this.cal.listEvents(min.toISOString(), max.toISOString(), interactive)
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

  setStatus(s: 'all' | Status) { this.status.set(s); }

  openCreate() { this.editingId.set(null); this.form = this.blank(); this.syncCal = true; this.formError.set(null); this.modalOpen.set(true); }
  openEdit(m: Meeting) {
    this.editingId.set(m.id);
    this.form = {
      title: m.title,
      meeting_date: m.meeting_date ? this.toInput(m.meeting_date) : '',
      attendees: m.attendees ?? '',
      meet_link: m.meet_link ?? '',
      notes: m.notes ?? '',
      status: m.status,
    };
    this.formError.set(null);
    this.modalOpen.set(true);
  }
  close() { this.modalOpen.set(false); }

  async save() {
    if (!this.form.title.trim()) { this.formError.set('Title is required.'); return; }
    const startISO = this.form.meeting_date ? new Date(this.form.meeting_date).toISOString() : '';
    const body: Partial<Meeting> = {
      title: this.form.title.trim(),
      meeting_date: startISO,
      attendees: this.form.attendees,
      meet_link: this.form.meet_link,
      notes: this.form.notes,
      status: this.form.status,
    };
    const id = this.editingId();

    // Edit path — no calendar sync.
    if (id) {
      this.saving.set(true);
      this.api.updateMeeting(id, body).subscribe({
        next: () => { this.saving.set(false); this.modalOpen.set(false); this.load(); },
        error: () => { this.saving.set(false); this.formError.set('Could not save. Try again.'); },
      });
      return;
    }

    const wantSync = this.syncCal && !!startISO;
    if (this.syncCal && !startISO) {
      this.formError.set('Pick a date & time to add this to Google Calendar — or uncheck that option to just save it here.');
      return;
    }

    this.saving.set(true);
    this.formError.set(null);

    // Create the Google Calendar event FIRST, straight from this click, so the
    // permission popup isn't blocked. Only then save to our database.
    let ev = null as Awaited<ReturnType<GoogleCalendarService['createEvent']>> | null;
    if (wantSync) {
      try {
        const attendees = GoogleCalendarService.parseEmails(this.form.attendees);
        ev = await this.cal.createEvent({
          title: body.title!, description: body.notes ?? '', startISO, attendees,
        });
      } catch (e: any) {
        this.zone.run(() => { this.saving.set(false); this.formError.set(this.calErr(e)); });
        return;
      }
    }

    const eventRef = ev;
    this.zone.run(() => {
      this.api.createMeeting(body).subscribe({
        next: (created) => {
          if (!eventRef) {
            this.saving.set(false); this.modalOpen.set(false); this.load(); return;
          }
          this.api.updateMeeting(created.id, {
            google_event_id: eventRef.eventId,
            meet_link: eventRef.meetLink ?? undefined,
            rsvp: eventRef.rsvp,
          }).subscribe({
            next: () => { this.saving.set(false); this.modalOpen.set(false); this.load(); },
            error: () => { this.saving.set(false); this.modalOpen.set(false); this.load(); },
          });
        },
        error: () => { this.saving.set(false); this.formError.set('Could not save the meeting.'); },
      });
    });
  }

  private calErr(e: any): string {
    const s = JSON.stringify(e?.message ?? e?.error ?? e ?? '').toLowerCase();
    if (s.includes('403') || s.includes('permission') || s.includes('insufficient') || s.includes('disabled'))
      return 'Calendar sync failed — the Google Calendar API may not be enabled, or the scope isn’t added yet. Complete the 2 Google Cloud steps, then retry. (Uncheck the calendar option to save without syncing.)';
    if (s.includes('access_denied') || s.includes('closed') || s.includes('popup') || s.includes('denied'))
      return 'Calendar permission wasn’t granted (the window was closed or blocked). Click Connect again and choose Allow.';
    return 'Couldn’t reach Google Calendar. Retry, or uncheck the calendar option to save without syncing.';
  }

  async syncRsvp(m: Meeting) {
    if (!m.google_event_id) return;
    this.setMsg(m.id, 'Refreshing RSVPs…');
    try {
      const rsvp = await this.cal.getRsvps(m.google_event_id);
      this.api.updateMeeting(m.id, { rsvp }).subscribe({
        next: () => { this.setMsg(m.id, ''); this.load(); },
      });
    } catch {
      this.setMsg(m.id, '⚠️ Could not refresh RSVPs (calendar permission needed).');
    }
  }

  remove(m: Meeting) {
    if (!confirm(`Delete "${m.title}"? This removes it here (the Google Calendar event stays).`)) return;
    this.api.deleteMeeting(m.id).subscribe({
      next: () => this.dbMeetings.update((l) => l.filter((x) => x.id !== m.id)),
      error: () => this.error.set('Could not delete meeting.'),
    });
  }

  private toInput(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
