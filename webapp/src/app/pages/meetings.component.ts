import { Component, inject, signal, OnInit, NgZone } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Meeting, Rsvp } from '../api.service';
import { GoogleCalendarService } from '../google-calendar.service';

type Form = {
  title: string; meeting_date: string; attendees: string;
  meet_link: string; notes: string; status: Meeting['status'];
};

const RSVP_LABEL: Record<string, string> = {
  accepted: 'Accepted', declined: 'Declined', tentative: 'Maybe', needsAction: 'Pending',
};

@Component({
  selector: 'app-meetings',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="page-head">
      <div><h1>Meetings</h1><p class="muted">Plan meetings, sync to Google Calendar & track RSVPs.</p></div>
      <button class="btn btn-primary" (click)="openCreate()">+ New meeting</button>
    </div>

    <div class="toolbar">
      <div class="tabs">
        @for (f of filters; track f) {
          <button class="tab" [class.active]="status()===f" (click)="setStatus(f)">{{ f }}</button>
        }
      </div>
      <input class="search" type="search" placeholder="🔍 Search meetings…"
             [(ngModel)]="q" (ngModelChange)="onSearch()" />
    </div>

    @if (error()) { <p class="error-banner">{{ error() }}</p> }

    @if (loading()) {
      <div class="empty">Loading…</div>
    } @else if (meetings().length === 0) {
      <div class="card card-pad empty"><span class="em">📅</span>No meetings here yet. Click <b>New meeting</b> to add one.</div>
    } @else {
      <div class="list">
        @for (m of meetings(); track m.id) {
          <div class="card card-pad mtg">
            <div class="mtg-main">
              <div class="row" style="align-items:flex-start; justify-content:flex-start; gap:.6rem">
                <h3>{{ m.title }}</h3>
                <span class="badge {{m.status}}">{{ m.status }}</span>
                @if (m.google_event_id) { <span class="synced">📆 On Google Calendar</span> }
              </div>
              <div class="meta">
                <span>🗓️ {{ m.meeting_date ? (m.meeting_date | date:'EEE, MMM d, y • h:mm a') : 'No date' }}</span>
                @if (m.attendees) { <span>👥 {{ m.attendees }}</span> }
              </div>
              @if (m.notes) { <p class="notes">{{ m.notes }}</p> }

              @if (m.rsvp && m.rsvp.length) {
                <div class="rsvps">
                  @for (r of m.rsvp; track r.email) {
                    <span class="rsvp {{r.status}}" [title]="r.email">{{ r.email }} · {{ label(r.status) }}</span>
                  }
                </div>
              }
              @if (syncMsg()[m.id]) { <div class="syncmsg">{{ syncMsg()[m.id] }}</div> }
            </div>
            <div class="mtg-actions">
              @if (m.meet_link) { <a class="btn btn-sm btn-primary" [href]="m.meet_link" target="_blank">Join</a> }
              @if (m.google_event_id) { <button class="btn btn-sm" (click)="syncRsvp(m)">↻ RSVPs</button> }
              <button class="btn btn-sm" (click)="openEdit(m)">Edit</button>
              <button class="btn btn-sm btn-danger" (click)="remove(m)">Delete</button>
            </div>
          </div>
        }
      </div>
    }

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
    .page-head { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; margin-bottom:1.2rem; }
    h1 { font-size:1.5rem; }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem; flex-wrap:wrap; }
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
    @media (max-width:700px){ .mtg{ flex-direction:column; } .mtg-actions{ max-width:none; } }
  `],
})
export class MeetingsComponent implements OnInit {
  private api = inject(ApiService);
  private cal = inject(GoogleCalendarService);
  private zone = inject(NgZone);

  filters: Array<'all' | Meeting['status']> = ['all', 'upcoming', 'completed', 'cancelled'];
  meetings = signal<Meeting[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  status = signal<'all' | Meeting['status']>('all');
  q = '';
  private searchTimer: any;

  modalOpen = signal(false);
  editingId = signal<number | null>(null);
  saving = signal(false);
  formError = signal<string | null>(null);
  syncCal = true;
  form: Form = this.blank();

  // Per-meeting status messages (e.g. calendar sync results).
  syncMsg = signal<Record<number, string>>({});

  ngOnInit() { this.load(); }

  label(s: string) { return RSVP_LABEL[s] ?? s; }
  private blank(): Form {
    return { title: '', meeting_date: '', attendees: '', meet_link: '', notes: '', status: 'upcoming' };
  }
  private setMsg(id: number, msg: string) {
    this.zone.run(() => this.syncMsg.update((m) => ({ ...m, [id]: msg })));
  }

  load() {
    this.loading.set(true);
    this.api.listMeetings(this.status(), this.q).subscribe({
      next: (m) => { this.meetings.set(m); this.loading.set(false); },
      error: () => { this.error.set('Could not load meetings.'); this.loading.set(false); },
    });
  }

  setStatus(s: 'all' | Meeting['status']) { this.status.set(s); this.load(); }
  onSearch() { clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.load(), 300); }

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

  save() {
    if (!this.form.title.trim()) { this.formError.set('Title is required.'); return; }
    this.saving.set(true);
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

    if (id) {
      this.api.updateMeeting(id, body).subscribe({
        next: () => { this.saving.set(false); this.modalOpen.set(false); this.load(); },
        error: () => { this.saving.set(false); this.formError.set('Could not save. Try again.'); },
      });
      return;
    }

    // Create flow (optionally sync to Google Calendar).
    this.api.createMeeting(body).subscribe({
      next: (created) => {
        const wantSync = this.syncCal && !!startISO;
        this.saving.set(false);
        this.modalOpen.set(false);
        if (!wantSync) { this.load(); return; }
        this.load();
        this.syncToCalendar(created, startISO);
      },
      error: () => { this.saving.set(false); this.formError.set('Could not create meeting.'); },
    });
  }

  private async syncToCalendar(m: Meeting, startISO: string) {
    this.setMsg(m.id, '📆 Creating Google Calendar event & sending invites…');
    try {
      const attendees = GoogleCalendarService.parseEmails(m.attendees);
      const ev = await this.cal.createEvent({
        title: m.title, description: m.notes, startISO, attendees,
      });
      this.api
        .updateMeeting(m.id, { google_event_id: ev.eventId, meet_link: ev.meetLink ?? undefined, rsvp: ev.rsvp })
        .subscribe({
          next: () => { this.setMsg(m.id, ''); this.load(); },
          error: () => this.setMsg(m.id, 'Saved meeting, but failed to store calendar details.'),
        });
    } catch (e: any) {
      this.setMsg(
        m.id,
        '⚠️ Meeting saved, but Google Calendar sync failed (' +
          (e?.message?.includes('403') || e?.error === 'access_denied'
            ? 'calendar permission denied or Calendar API not enabled'
            : 'please try the ↻ RSVPs button or check Calendar setup') +
          ').'
      );
    }
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
      next: () => this.meetings.update((l) => l.filter((x) => x.id !== m.id)),
      error: () => this.error.set('Could not delete meeting.'),
    });
  }

  private toInput(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
