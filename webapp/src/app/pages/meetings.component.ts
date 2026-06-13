import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Meeting } from '../api.service';

type Form = {
  title: string; meeting_date: string; attendees: string;
  meet_link: string; notes: string; status: Meeting['status'];
};

@Component({
  selector: 'app-meetings',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="page-head">
      <div><h1>Meetings</h1><p class="muted">Plan, track and review every Google Meet.</p></div>
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
              <div class="row" style="align-items:flex-start">
                <h3>{{ m.title }}</h3>
                <span class="badge {{m.status}}">{{ m.status }}</span>
              </div>
              <div class="meta">
                <span>🗓️ {{ m.meeting_date ? (m.meeting_date | date:'EEE, MMM d, y • h:mm a') : 'No date' }}</span>
                @if (m.attendees) { <span>👥 {{ m.attendees }}</span> }
              </div>
              @if (m.notes) { <p class="notes">{{ m.notes }}</p> }
            </div>
            <div class="mtg-actions">
              @if (m.meet_link) { <a class="btn btn-sm btn-primary" [href]="m.meet_link" target="_blank">Join</a> }
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
          <label class="field"><span>Attendees</span>
            <input [(ngModel)]="form.attendees" placeholder="Alice, Bob, Carol" /></label>
          <label class="field"><span>Google Meet link</span>
            <input [(ngModel)]="form.meet_link" placeholder="https://meet.google.com/…" /></label>
          <label class="field"><span>Notes / transcript</span>
            <textarea rows="4" [(ngModel)]="form.notes" placeholder="Agenda, notes or paste a transcript…"></textarea></label>
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
    .mtg { display:flex; align-items:center; gap:1rem; justify-content:space-between; }
    .mtg-main { min-width:0; }
    h3 { font-size:1.05rem; }
    .meta { display:flex; flex-wrap:wrap; gap:.9rem; color:var(--text-dim); font-size:.83rem; margin-top:.4rem; }
    .notes { margin:.6rem 0 0; font-size:.88rem; color:var(--text-dim); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .mtg-actions { display:flex; gap:.4rem; flex-shrink:0; }
    .two { display:grid; grid-template-columns:1fr 1fr; gap:.7rem; }
    @media (max-width:700px){ .mtg{ flex-direction:column; align-items:stretch } .mtg-actions{ justify-content:flex-end } }
  `],
})
export class MeetingsComponent implements OnInit {
  private api = inject(ApiService);

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
  form: Form = this.blank();

  ngOnInit() { this.load(); }

  private blank(): Form {
    return { title: '', meeting_date: '', attendees: '', meet_link: '', notes: '', status: 'upcoming' };
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

  openCreate() { this.editingId.set(null); this.form = this.blank(); this.formError.set(null); this.modalOpen.set(true); }
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
    const body: Partial<Meeting> = {
      title: this.form.title.trim(),
      meeting_date: this.form.meeting_date ? new Date(this.form.meeting_date).toISOString() : '',
      attendees: this.form.attendees,
      meet_link: this.form.meet_link,
      notes: this.form.notes,
      status: this.form.status,
    };
    const done = () => { this.saving.set(false); this.modalOpen.set(false); this.load(); };
    const fail = () => { this.saving.set(false); this.formError.set('Could not save. Try again.'); };
    const id = this.editingId();
    if (id) this.api.updateMeeting(id, body).subscribe({ next: done, error: fail });
    else this.api.createMeeting(body).subscribe({ next: done, error: fail });
  }

  remove(m: Meeting) {
    if (!confirm(`Delete "${m.title}"? This can't be undone.`)) return;
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
