import { Component, inject, signal, computed, OnInit, NgZone } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, Meeting, MeetingSession } from '../api.service';
import { GoogleCalendarService } from '../google-calendar.service';

interface Session { conference_record: string | null; ended_at: string | null; transcript: string | null; summary: string | null; }

@Component({
  selector: 'app-meeting-detail',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <div class="eyebrow"><a routerLink="/meetings" class="linkbtn">← Meeting library</a></div>
        @if (meeting()) {
          <h1 class="takeaway">{{ meeting()!.title }}</h1>
          <div class="muted" style="margin-top:.3rem">
            {{ meeting()!.meeting_date ? (meeting()!.meeting_date | date:'EEEE, MMM d, y • h:mm a') : 'No date' }}
            · <span class="status {{ stage() }}">{{ stageLabel() }}</span>
          </div>
        } @else if (loading()) {
          <div class="skel" style="height:30px;width:280px"></div>
        } @else { <h1 class="takeaway">Meeting not found</h1> }
      </div>
      @if (meeting()) {
        <div class="row" style="flex-wrap:wrap; justify-content:flex-end">
          @if (meeting()!.meet_link) { <a class="btn btn-sm btn-primary" [href]="meeting()!.meet_link!" target="_blank">Join Meet</a> }
          <button class="btn btn-sm" (click)="exportMd()" [disabled]="!active()">Export</button>
          <button class="btn btn-sm" (click)="share()">{{ shared() ? 'Copied ✓' : 'Share' }}</button>
        </div>
      }
    </div>

    @if (msg()) { <div class="note" style="margin-bottom:1rem">{{ msg() }}</div> }
    @if (error()) { <p class="error-banner">{{ error() }}</p> }

    @if (loading()) {
      <div class="split">
        <div class="panel"><div class="skel skel-line" style="height:300px"></div></div>
        <div class="panel"><div class="skel skel-line" style="height:300px"></div></div>
      </div>
    } @else if (meeting()) {

      @if (sessions().length === 0) {
        <div class="panel">
          <div class="empty">
            <span class="em">▤</span>
            <div class="et">No transcript yet</div>
            <div style="max-width:460px;margin:.3rem auto 0">
              Transcription auto-starts when someone joins a meeting created in Cadence. After the call ends (a few minutes), it appears here — or pull it now.
            </div>
            @if (meeting()!.meet_link) {
              <button class="btn btn-primary" style="margin-top:1rem" (click)="generate()" [disabled]="busy()">{{ busy() ? 'Fetching…' : '🪄 Transcript & summary' }}</button>
            } @else {
              <div class="dim" style="margin-top:1rem">This meeting has no Google Meet link.</div>
            }
          </div>
        </div>
      } @else {

        @if (sessions().length > 1) {
          <div class="filters">
            <span class="eyebrow" style="align-self:center">Session</span>
            <div class="seg">
              @for (s of sessions(); track $index) {
                <button [class.active]="idx()===$index" (click)="idx.set($index)">{{ (s.ended_at ? (s.ended_at | date:'MMM d, h:mm a') : 'Session ' + ($index+1)) }}</button>
              }
            </div>
            <span class="spacer"></span>
            <button class="btn btn-sm" (click)="generate()" [disabled]="busy()">{{ busy() ? '…' : '↻ Refresh' }}</button>
          </div>
        }

        <div class="split">
          <!-- Transcript -->
          <section class="panel">
            <div class="panel-head">
              <h2>Transcript</h2>
              <div class="search" style="position:relative; width:220px">
                <input type="search" placeholder="⌕ Search within…" [ngModel]="find()" (ngModelChange)="find.set($event)" style="height:32px" />
              </div>
            </div>
            @if (lines().length === 0) {
              <div class="empty"><span class="em">▦</span><div>Transcript is empty.</div></div>
            } @else {
              @for (l of lines(); track $index) {
                <div class="transcript-line">
                  <span class="who">{{ l.who }}</span>
                  <span [innerHTML]="hl(l.text)"></span>
                </div>
              }
            }
          </section>

          <!-- Summary -->
          <section class="panel">
            <div class="panel-head"><h2>Executive summary</h2>
              <button class="btn btn-sm btn-ghost" (click)="generate()" [disabled]="busy()" title="Regenerate">{{ busy() ? '…' : '↻' }}</button>
            </div>
            @if (sections().length === 0) {
              <div class="dim">No summary for this session.</div>
            } @else {
              @for (sec of sections(); track sec.title) {
                <div class="sum-section">
                  @if (sec.title) { <h4>{{ sec.title }}</h4> }
                  <div class="body">{{ sec.body }}</div>
                </div>
              }
            }
          </section>
        </div>
      }
    }
  `,
})
export class MeetingDetailComponent implements OnInit {
  private api = inject(ApiService);
  private cal = inject(GoogleCalendarService);
  private route = inject(ActivatedRoute);
  private zone = inject(NgZone);

  id = Number(this.route.snapshot.paramMap.get('id'));
  meeting = signal<Meeting | null>(null);
  private dbSessions = signal<MeetingSession[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  msg = signal<string | null>(null);
  busy = signal(false);
  shared = signal(false);
  idx = signal(0);
  find = signal('');

  // Sessions to display: real per-occurrence rows, or a synthetic one from the
  // meeting's mirrored latest summary/transcript (older single-summary meetings).
  sessions = computed<Session[]>(() => {
    const s = this.dbSessions();
    if (s.length) return s.map((x) => ({ conference_record: x.conference_record, ended_at: x.ended_at, transcript: x.transcript, summary: x.summary }));
    const m = this.meeting();
    if (m && (m.transcript || m.summary)) return [{ conference_record: null, ended_at: m.meeting_date, transcript: m.transcript ?? null, summary: m.summary ?? null }];
    return [];
  });
  active = computed<Session | null>(() => this.sessions()[Math.min(this.idx(), this.sessions().length - 1)] ?? null);

  lines = computed(() => {
    const t = this.active()?.transcript ?? '';
    return t.split('\n').filter((l) => l.trim()).map((l) => {
      const i = l.indexOf(':');
      if (i > 0 && i < 40) return { who: l.slice(0, i).trim(), text: l.slice(i + 1).trim() };
      return { who: '', text: l.trim() };
    });
  });

  sections = computed(() => {
    const md = this.active()?.summary ?? '';
    if (!md.trim()) return [];
    const out: { title: string; body: string }[] = [];
    let cur: { title: string; body: string } | null = null;
    for (const raw of md.split('\n')) {
      const h = raw.match(/^#{1,3}\s+(.*)/);
      if (h) { if (cur) out.push(cur); cur = { title: h[1].trim(), body: '' }; }
      else { if (!cur) cur = { title: '', body: '' }; cur.body += (cur.body ? '\n' : '') + raw; }
    }
    if (cur) out.push(cur);
    return out.map((s) => ({ title: s.title, body: s.body.trim() })).filter((s) => s.title || s.body);
  });

  stage = computed(() => {
    const m = this.meeting(); if (!m) return 'none';
    if (m.summary) return 'summarized'; if (m.transcript) return 'transcribed';
    return m.status;
  });
  stageLabel = computed(() => {
    const map: Record<string, string> = { summarized: 'Summarized', transcribed: 'Transcribed', upcoming: 'Upcoming', completed: 'Completed', cancelled: 'Cancelled', none: '—' };
    return map[this.stage()] ?? this.stage();
  });

  ngOnInit() {
    // No get-by-id endpoint; fetch the list and pick this meeting.
    this.api.listMeetings('all').subscribe({
      next: (list) => {
        const m = list.find((x) => x.id === this.id) ?? null;
        this.meeting.set(m); this.loading.set(false);
        if (m) this.refreshSessions();
      },
      error: () => { this.error.set('Could not load this meeting.'); this.loading.set(false); },
    });
  }

  private async refreshSessions() {
    try { this.dbSessions.set(await firstValueFrom(this.api.listSessions(this.id))); } catch { /* ignore */ }
  }

  hl(text: string): string {
    const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
    const q = this.find().trim();
    if (!q) return esc;
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return esc.replace(new RegExp(safe, 'gi'), (m) => `<mark>${m}</mark>`);
  }

  async generate() {
    const m = this.meeting(); if (!m?.meet_link) return;
    const code = GoogleCalendarService.meetingCode(m.meet_link);
    if (!code) { this.msg.set('This meeting has no valid Google Meet link.'); return; }
    this.busy.set(true); this.msg.set('Looking up Google Meet sessions…'); this.error.set(null);
    try {
      const confs = await this.cal.getMeetConferences(code, true);
      const existing = await firstValueFrom(this.api.listSessions(this.id));
      const have = new Set(existing.map((s) => s.conference_record));
      const fresh = confs.filter((c) => !have.has(c.record));
      let added = 0;
      for (const c of fresh) {
        this.zone.run(() => this.msg.set(`Summarizing session ${added + 1} of ${fresh.length}…`));
        const t = await this.cal.getTranscriptForRecord(c.record, false);
        if (!t) continue;
        await firstValueFrom(this.api.addSession(this.id, { conference_record: c.record, started_at: c.startTime, ended_at: c.endTime, transcript: t }));
        added++;
      }
      this.busy.set(false);
      if (added === 0 && existing.length === 0) this.msg.set('No transcript available yet — transcripts take a few minutes after a call ends. Try again shortly.');
      else this.msg.set(null);
      await this.refreshSessions();
      // refresh the meeting (mirrored latest summary)
      this.api.listMeetings('all').subscribe({ next: (l) => this.meeting.set(l.find((x) => x.id === this.id) ?? this.meeting()) });
    } catch (e: any) {
      this.busy.set(false);
      this.error.set(this.meetErr(e));
    }
  }

  exportMd() {
    const m = this.meeting(); const s = this.active(); if (!m || !s) return;
    const md = `# ${m.title}\n\n` +
      (m.meeting_date ? `**Date:** ${new Date(m.meeting_date).toLocaleString()}\n\n` : '') +
      `## Summary\n\n${s.summary ?? '(none)'}\n\n## Transcript\n\n${s.transcript ?? '(none)'}\n`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${m.title.replace(/[^\w]+/g, '-').toLowerCase()}.md`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  share() {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      this.shared.set(true); setTimeout(() => this.shared.set(false), 1800);
    }).catch(() => {});
  }

  private meetErr(e: any): string {
    const s = JSON.stringify(e?.message ?? e?.error ?? e ?? '').toLowerCase();
    if (s.includes('not_connected') || s.includes('denied') || s.includes('closed') || s.includes('popup'))
      return 'Google permission wasn’t granted. Click the button again and choose Allow.';
    if (s.includes('403') || s.includes('permission') || s.includes('disabled'))
      return 'Couldn’t read Google Meet — check the Meet API is enabled and the scopes are consented.';
    return 'Couldn’t fetch the transcript. Please try again.';
  }
}
