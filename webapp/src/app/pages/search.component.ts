import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Meeting } from '../api.service';

interface Hit { id: number; title: string; dateISO: string | null; where: string; snippetHtml: string; }

@Component({
  selector: 'app-search',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <div class="eyebrow">Search</div>
        <h1 class="takeaway">{{ headline() }}</h1>
      </div>
    </div>

    <div class="filters">
      <input class="search-inp" style="min-width:340px" type="search" autofocus
             placeholder="⌕ Search transcripts and summaries…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
    </div>

    @if (loading()) {
      <div class="table-wrap" style="padding:1rem">@for (i of [1,2,3]; track i) { <div class="skel skel-line" style="height:48px;margin:.5rem 0"></div> }</div>
    } @else if (!q().trim()) {
      <div class="empty"><span class="em">⌕</span><div class="et">Search your meeting record</div><div>Find any decision, action item, or phrase across transcripts and summaries.</div></div>
    } @else if (hits().length === 0) {
      <div class="empty"><span class="em">∅</span><div class="et">No matches for “{{ q() }}”</div><div>Try a different term, or check the meeting has been summarized.</div></div>
    } @else {
      <div class="rows">
        @for (h of hits(); track h.id + h.where) {
          <a class="rowitem" [routerLink]="['/meetings', h.id]" style="cursor:pointer">
            <div class="ri-main">
              <div class="ri-title">{{ h.title }} <span class="chip" style="margin-left:.4rem">{{ h.where }}</span></div>
              <div class="ri-sub" [innerHTML]="h.snippetHtml"></div>
            </div>
            <div class="dim" style="white-space:nowrap">{{ h.dateISO ? (h.dateISO | date:'MMM d, y') : '' }}</div>
          </a>
        }
      </div>
      <p class="dim" style="margin-top:.6rem; font-size:.78rem">{{ hits().length }} results</p>
    }
  `,
})
export class SearchComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  q = signal('');
  private meetings = signal<Meeting[]>([]);
  loading = signal(true);

  headline = computed(() => this.q().trim() ? `Results for “${this.q().trim()}”` : 'Search transcripts & summaries');

  hits = computed<Hit[]>(() => {
    const query = this.q().trim().toLowerCase();
    if (!query) return [];
    const out: Hit[] = [];
    for (const m of this.meetings()) {
      const fields: { where: string; text: string }[] = [
        { where: 'Title', text: m.title },
        { where: 'Summary', text: m.summary ?? '' },
        { where: 'Transcript', text: m.transcript ?? '' },
        { where: 'Notes', text: m.notes ?? '' },
      ];
      for (const f of fields) {
        const idx = f.text.toLowerCase().indexOf(query);
        if (idx >= 0) {
          out.push({ id: m.id, title: m.title, dateISO: m.meeting_date, where: f.where, snippetHtml: this.snippet(f.text, idx, query.length) });
          break; // one hit per meeting (best field)
        }
      }
    }
    return out;
  });

  ngOnInit() {
    this.route.queryParamMap.subscribe((p) => { const v = p.get('q'); if (v !== null) this.q.set(v); });
    this.api.listMeetings('all').subscribe({
      next: (m) => { this.meetings.set(m); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  private snippet(text: string, idx: number, len: number): string {
    const start = Math.max(0, idx - 60);
    const slice = text.slice(start, idx + len + 100);
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
    const before = (start > 0 ? '…' : '') + esc(slice.slice(0, idx - start));
    const match = esc(slice.slice(idx - start, idx - start + len));
    const after = esc(slice.slice(idx - start + len)) + (idx + len + 100 < text.length ? '…' : '');
    return `${before}<mark>${match}</mark>${after}`;
  }
}
