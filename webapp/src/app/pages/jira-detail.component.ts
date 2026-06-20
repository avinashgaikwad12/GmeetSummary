import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, JiraDetail, JiraMeeting } from '../api.service';

interface MapNode { id: number; x: number; y: number; label: string; title: string; status: string; }

@Component({
  selector: 'app-jira-detail',
  imports: [DatePipe, FormsModule, RouterLink],
  styles: [`
    .jira-head { display:flex; align-items:flex-start; gap:1rem; flex-wrap:wrap; }
    .keychip { font-family:ui-monospace,Menlo,Consolas,monospace; font-weight:800; font-size:1rem; background:var(--accent-weak);
      color:var(--accent); padding:.25rem .6rem; border-radius:8px; letter-spacing:.02em; }
    .keychip a { color:inherit; }
    .titleedit { border:1px solid transparent; background:transparent; font-size:1.35rem; font-weight:700; color:var(--navy);
      border-radius:6px; padding:.1rem .3rem; min-width:220px; }
    .titleedit:hover { border-color:var(--line-2); }
    .titleedit:focus { border-color:var(--accent); background:var(--surface); }

    .mapwrap { background:var(--surface); border:1px solid var(--line); border-radius:var(--r-lg); padding:.6rem; margin-bottom:1.2rem; overflow-x:auto; }
    .mapwrap svg { display:block; width:100%; height:auto; min-width:520px; }
    .mm-edge { stroke:var(--line-2); stroke-width:1.5; }
    .mm-center { fill:var(--navy); }
    .mm-node { cursor:pointer; transition:fill .12s; }
    .mm-node.upcoming { fill:var(--accent); }
    .mm-node.completed { fill:var(--ok); }
    .mm-node.cancelled { fill:var(--danger); }
    .mm-node:hover { fill:var(--accent-700); }
    .mm-label { font-size:9px; fill:var(--text-dim); font-weight:600; }
    .mm-center-txt { fill:#fff; font-weight:800; font-size:12px; }

    .timeline { position:relative; margin-left:.4rem; padding-left:1.4rem; border-left:2px solid var(--line); }
    .tl-item { position:relative; padding-bottom:1.3rem; }
    .tl-item::before { content:''; position:absolute; left:-1.85rem; top:.25rem; width:11px; height:11px; border-radius:50%;
      background:var(--surface); border:2px solid var(--accent); }
    .tl-date { font-size:.74rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-mute); }
    .tl-title { font-weight:700; margin:.1rem 0 .3rem; }
    .tl-title a:hover { color:var(--accent); text-decoration:underline; }
    .tl-concl { font-size:.9rem; line-height:1.55; white-space:pre-wrap; color:var(--text); }
    .tl-actions { display:flex; gap:.4rem; margin-top:.4rem; }
  `],
  template: `
    <div class="page-head">
      <div style="min-width:0">
        <div class="eyebrow"><a routerLink="/jira" class="linkbtn">← All tickets</a></div>
        @if (data(); as d) {
          <div class="jira-head">
            <span class="keychip">
              @if (d.base_url) { <a [href]="d.base_url + d.jira_key" target="_blank" rel="noopener">{{ d.jira_key }} ↗</a> }
              @else { {{ d.jira_key }} }
            </span>
            <input class="titleedit" [ngModel]="titleDraft()" (ngModelChange)="titleDraft.set($event)"
                   (blur)="saveTitle()" (keyup.enter)="saveTitle()" placeholder="Add a title…" />
          </div>
          <div class="muted" style="margin-top:.4rem">
            {{ d.meetings.length }} meeting{{ d.meetings.length === 1 ? '' : 's' }}
            @if (range()) { · {{ range() }} }
          </div>
        } @else if (loading()) {
          <div class="skel" style="height:30px;width:280px"></div>
        } @else { <h1 class="takeaway">Ticket not found</h1> }
      </div>
    </div>

    @if (error()) { <p class="error-banner">{{ error() }}</p> }

    @if (data(); as d) {
      <!-- Mind map: ticket at the centre, meetings around it -->
      @if (nodes().length) {
        <div class="mapwrap">
          <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" aria-label="Meeting mind map">
            @for (n of nodes(); track n.id) {
              <line class="mm-edge" [attr.x1]="W/2" [attr.y1]="H/2" [attr.x2]="n.x" [attr.y2]="n.y"></line>
            }
            <circle class="mm-center" [attr.cx]="W/2" [attr.cy]="H/2" r="44"></circle>
            <text class="mm-center-txt" [attr.x]="W/2" [attr.y]="H/2 + 4" text-anchor="middle">{{ d.jira_key }}</text>
            @for (n of nodes(); track n.id) {
              <g (click)="go(n.id)">
                <circle class="mm-node {{ n.status }}" [attr.cx]="n.x" [attr.cy]="n.y" r="22">
                  <title>{{ n.title }}</title>
                </circle>
                <text class="mm-label" [attr.x]="n.x" [attr.y]="n.y + 36" text-anchor="middle">{{ n.label }}</text>
              </g>
            }
          </svg>
        </div>
      }

      <div class="split">
        <!-- Journey timeline -->
        <section class="panel">
          <div class="panel-head"><h2>Discussion journey</h2></div>
          <div class="timeline">
            @for (m of d.meetings; track m.id) {
              <div class="tl-item">
                <div class="tl-date">{{ m.meeting_date ? (m.meeting_date | date:'MMM d, y') : 'No date' }} · <span class="status {{ m.status }}">{{ m.status }}</span></div>
                <div class="tl-title"><a [routerLink]="['/meetings', m.id]">{{ m.title }}</a></div>
                @if (editing() === m.id) {
                  <textarea rows="4" [ngModel]="draft()" (ngModelChange)="draft.set($event)"></textarea>
                  <div class="tl-actions">
                    <button class="btn btn-sm btn-primary" (click)="saveConclusion(m)" [disabled]="busyId() === m.id">Save</button>
                    <button class="btn btn-sm btn-ghost" (click)="editing.set(null)">Cancel</button>
                  </div>
                } @else {
                  <div class="tl-concl">{{ m.conclusion || 'No conclusion captured for this ticket in this meeting yet.' }}</div>
                  <div class="tl-actions">
                    <button class="btn btn-sm btn-ghost" (click)="edit(m)">Edit</button>
                    <button class="btn btn-sm btn-ghost" (click)="regen(m)" [disabled]="busyId() === m.id" [title]="m.has_summary ? 'Re-extract from the meeting summary' : 'No summary yet'">
                      {{ busyId() === m.id ? '…' : '↻ Re-extract' }}
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        </section>

        <!-- Overall journey synthesis -->
        <section class="panel">
          <div class="panel-head">
            <h2>Where it stands</h2>
            <button class="btn btn-sm" (click)="synthesize()" [disabled]="synth()">
              {{ synth() ? '…' : (d.journey_summary ? '↻ Rebuild' : '✦ Synthesize') }}
            </button>
          </div>
          @if (synth()) {
            <div class="empty"><div class="spinner" style="margin:0 auto .6rem"></div>Synthesizing the journey across {{ d.meetings.length }} meetings…</div>
          } @else if (d.journey_summary) {
            @for (sec of journeySections(); track sec.title) {
              <div class="sum-section">
                @if (sec.title) { <h4>{{ sec.title }}</h4> }
                <div class="body">{{ sec.body }}</div>
              </div>
            }
            @if (d.journey_built_at) { <div class="dim" style="font-size:.75rem; margin-top:.5rem">Built {{ d.journey_built_at | date:'MMM d, y • h:mm a' }}</div> }
          } @else {
            <div class="empty">
              <span class="em">✦</span>
              <div class="et">No journey summary yet</div>
              <div>Synthesize a cross-meeting read of where this ticket stands, key decisions, and next steps.</div>
            </div>
          }
        </section>
      </div>
    }
  `,
})
export class JiraDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly W = 560;
  readonly H = 360;

  key = '';
  data = signal<JiraDetail | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  titleDraft = signal('');
  editing = signal<number | null>(null);
  draft = signal('');
  busyId = signal<number | null>(null);
  synth = signal(false);

  range = computed(() => {
    const d = this.data(); if (!d) return '';
    const dates = d.meetings.map((m) => m.meeting_date).filter(Boolean) as string[];
    if (!dates.length) return '';
    const ms = dates.map((x) => Date.parse(x)).sort((a, b) => a - b);
    const fmt = (n: number) => new Date(n).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    const a = fmt(ms[0]), b = fmt(ms[ms.length - 1]);
    return a === b ? a : `${a} – ${b}`;
  });

  nodes = computed<MapNode[]>(() => {
    const d = this.data(); if (!d) return [];
    const ms = d.meetings;
    const n = ms.length;
    const r = Math.min(this.W, this.H) / 2 - 60;
    return ms.map((m, i) => {
      const ang = (i / Math.max(n, 1)) * 2 * Math.PI - Math.PI / 2;
      return {
        id: m.id, x: this.W / 2 + r * Math.cos(ang), y: this.H / 2 + r * Math.sin(ang),
        label: m.meeting_date ? new Date(m.meeting_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—',
        title: m.title, status: m.status,
      };
    });
  });

  journeySections = computed(() => {
    const md = this.data()?.journey_summary ?? '';
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

  ngOnInit() {
    this.key = (this.route.snapshot.paramMap.get('key') ?? '').toUpperCase();
    this.load();
  }

  private load() {
    this.loading.set(true);
    this.api.getJira(this.key).subscribe({
      next: (d) => { this.data.set(d); this.titleDraft.set(d.title ?? ''); this.loading.set(false); },
      error: (e) => { this.error.set(e?.error?.error ?? 'Could not load this ticket.'); this.loading.set(false); },
    });
  }

  go(id: number) { this.router.navigate(['/meetings', id]); }

  saveTitle() {
    const t = this.titleDraft().trim();
    const d = this.data(); if (!d || t === (d.title ?? '')) return;
    this.api.setJiraTitle(this.key, t).subscribe({ next: () => this.data.set({ ...d, title: t || null }) });
  }

  edit(m: JiraMeeting) { this.editing.set(m.id); this.draft.set(m.conclusion ?? ''); }

  saveConclusion(m: JiraMeeting) {
    this.busyId.set(m.id);
    this.api.updateMeetingJira(m.id, this.key, this.draft()).subscribe({
      next: (r) => { this.patchMeeting(m.id, r.conclusion); this.editing.set(null); this.busyId.set(null); },
      error: () => { this.busyId.set(null); },
    });
  }

  regen(m: JiraMeeting) {
    this.busyId.set(m.id); this.error.set(null);
    this.api.extractMeetingJira(m.id, this.key).subscribe({
      next: (r) => { this.patchMeeting(m.id, r.conclusion); this.busyId.set(null); },
      error: (e) => { this.error.set(e?.error?.error ?? 'Could not re-extract.'); this.busyId.set(null); },
    });
  }

  synthesize() {
    this.synth.set(true); this.error.set(null);
    this.api.synthesizeJira(this.key).subscribe({
      next: (r) => { const d = this.data(); if (d) this.data.set({ ...d, journey_summary: r.journey_summary, journey_built_at: r.journey_built_at }); this.synth.set(false); },
      error: (e) => { this.error.set(e?.error?.error ?? 'Could not synthesize the journey.'); this.synth.set(false); },
    });
  }

  private patchMeeting(id: number, conclusion: string | null) {
    const d = this.data(); if (!d) return;
    this.data.set({ ...d, meetings: d.meetings.map((x) => (x.id === id ? { ...x, conclusion } : x)) });
  }
}
