import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService, JiraSummary, JiraMapData } from '../api.service';

interface JNode { key: string; x: number; y: number; label: string; count: number; }
interface MNode { id: number; x: number; y: number; label: string; }

@Component({
  selector: 'app-jira-list',
  imports: [DatePipe],
  styles: [`
    .keycell { font-family:ui-monospace,Menlo,Consolas,monospace; font-weight:800; color:var(--accent); }
    .mapwrap { background:var(--surface); border:1px solid var(--line); border-radius:var(--r-lg); padding:.6rem; margin-bottom:1.2rem; overflow:auto; max-height:560px; }
    .mapwrap svg { display:block; min-width:680px; }
    .mm-edge { stroke:var(--line-2); stroke-width:1.3; opacity:.6; }
    .mm-jira { fill:var(--navy); cursor:pointer; }
    .mm-jira:hover { fill:var(--accent); }
    .mm-meeting { fill:var(--accent); cursor:pointer; }
    .mm-meeting:hover { fill:var(--accent-700); }
    .mm-jira-txt { font-size:11px; font-weight:800; fill:var(--text); cursor:pointer; }
    .mm-meeting-txt { font-size:10px; fill:var(--text-dim); cursor:pointer; }
    .col-cap { font-size:.66rem; font-weight:700; letter-spacing:.12em; text-transform:uppercase; fill:var(--text-mute); }
    .toolbar { display:flex; align-items:center; gap:.6rem; margin-bottom:1rem; flex-wrap:wrap; }
  `],
  template: `
    <div class="page-head">
      <div>
        <div class="eyebrow">Jira tracker</div>
        <h1 class="takeaway">{{ headline() }}</h1>
      </div>
    </div>

    @if (error()) { <p class="error-banner">{{ error() }}</p> }

    @if (loading()) {
      <div class="table-wrap" style="padding:1rem">
        @for (i of [1,2,3,4]; track i) { <div class="skel skel-line" style="height:34px;margin:.5rem 0"></div> }
      </div>
    } @else if (jiras().length === 0) {
      <div class="table-wrap"><div class="empty">
        <span class="em">⌗</span>
        <div class="et">No tickets tracked yet</div>
        <div>Open a meeting and add a Jira ticket (e.g. PROJ-123) to start tracking its journey across meetings.</div>
      </div></div>
    } @else {
      <div class="toolbar">
        <button class="btn btn-sm" [class.btn-primary]="showMap()" (click)="showMap.set(!showMap())">
          {{ showMap() ? '▦ Hide mind map' : '▦ Mind map' }}
        </button>
        <span class="dim" style="font-size:.8rem">Click a ticket to open its full journey.</span>
      </div>

      @if (showMap() && map()) {
        <div class="mapwrap">
          <svg [attr.viewBox]="'0 0 ' + W + ' ' + mapH()" [attr.height]="mapH()" [attr.width]="W" role="img" aria-label="Jira ↔ meeting mind map">
            <text class="col-cap" [attr.x]="LEFT" y="22" text-anchor="middle">Tickets</text>
            <text class="col-cap" [attr.x]="RIGHT" y="22" text-anchor="middle">Meetings</text>
            @for (e of edges(); track e.k + '-' + e.id) {
              <line class="mm-edge" [attr.x1]="LEFT + 8" [attr.y1]="e.jy" [attr.x2]="RIGHT - 8" [attr.y2]="e.my"></line>
            }
            @for (j of jNodes(); track j.key) {
              <g (click)="openJira(j.key)">
                <circle class="mm-jira" [attr.cx]="LEFT" [attr.cy]="j.y" [attr.r]="6 + (j.count > 6 ? 6 : j.count)"></circle>
                <text class="mm-jira-txt" [attr.x]="LEFT - 14" [attr.y]="j.y + 4" text-anchor="end">{{ j.label }}</text>
              </g>
            }
            @for (m of mNodes(); track m.id) {
              <g (click)="openMeeting(m.id)">
                <circle class="mm-meeting" [attr.cx]="RIGHT" [attr.cy]="m.y" r="6"></circle>
                <text class="mm-meeting-txt" [attr.x]="RIGHT + 14" [attr.y]="m.y + 4" text-anchor="start">{{ m.label }}</text>
              </g>
            }
          </svg>
        </div>
      }

      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Title</th>
              <th>Meetings</th>
              <th>Conclusions</th>
              <th>Last discussed</th>
              <th>Journey</th>
            </tr>
          </thead>
          <tbody>
            @for (j of jiras(); track j.jira_key) {
              <tr (click)="openJira(j.jira_key)">
                <td class="keycell">{{ j.jira_key }}</td>
                <td>{{ j.title || '—' }}</td>
                <td>{{ j.meeting_count }}</td>
                <td>{{ j.with_conclusion }} / {{ j.meeting_count }}</td>
                <td>{{ j.last_discussed ? (j.last_discussed | date:'MMM d, y') : '—' }}</td>
                <td>
                  @if (j.has_journey) { <span class="status done">Synthesized</span> }
                  @else { <span class="status none">—</span> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class JiraListComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);

  readonly W = 720;
  readonly LEFT = 170;
  readonly RIGHT = 540;
  private readonly ROW = 40;
  private readonly PAD = 44;

  jiras = signal<JiraSummary[]>([]);
  map = signal<JiraMapData | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  showMap = signal(false);

  headline = computed(() => {
    const n = this.jiras().length;
    if (this.loading()) return 'Track every ticket across meetings';
    const total = this.jiras().reduce((s, j) => s + j.meeting_count, 0);
    return `${n} ticket${n === 1 ? '' : 's'} · ${total} meeting links`;
  });

  // Bipartite layout: tickets on the left, meetings on the right.
  jNodes = computed<JNode[]>(() => {
    const m = this.map(); if (!m) return [];
    const js = [...m.jiras].sort((a, b) => b.meeting_count - a.meeting_count);
    return js.map((j, i) => ({ key: j.jira_key, x: this.LEFT, y: this.PAD + i * this.ROW, label: j.jira_key, count: j.meeting_count }));
  });
  mNodes = computed<MNode[]>(() => {
    const m = this.map(); if (!m) return [];
    const ms = [...m.meetings].sort((a, b) => (Date.parse(b.meeting_date ?? '') || 0) - (Date.parse(a.meeting_date ?? '') || 0));
    return ms.map((x, i) => ({ id: x.id, x: this.RIGHT, y: this.PAD + i * this.ROW, label: this.trunc(x.title, 34) }));
  });
  edges = computed(() => {
    const m = this.map(); if (!m) return [];
    const jy = new Map(this.jNodes().map((n) => [n.key, n.y]));
    const my = new Map(this.mNodes().map((n) => [n.id, n.y]));
    return m.edges
      .filter((e) => jy.has(e.jira_key) && my.has(e.meeting_id))
      .map((e) => ({ k: e.jira_key, id: e.meeting_id, jy: jy.get(e.jira_key)!, my: my.get(e.meeting_id)! }));
  });
  mapH = computed(() => {
    const rows = Math.max(this.jNodes().length, this.mNodes().length);
    return Math.max(160, this.PAD + rows * this.ROW);
  });

  ngOnInit() {
    this.api.listJiras().subscribe({
      next: (j) => { this.jiras.set(j); this.loading.set(false); },
      error: () => { this.error.set('Could not load tickets.'); this.loading.set(false); },
    });
    this.api.jiraMap().subscribe({ next: (m) => this.map.set(m), error: () => {} });
  }

  openJira(key: string) { this.router.navigate(['/jira', key]); }
  openMeeting(id: number) { this.router.navigate(['/meetings', id]); }
  private trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
}
