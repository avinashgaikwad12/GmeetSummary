import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Task } from '../api.service';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-tasks',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="page-head">
      <div>
        <div class="eyebrow">Action items</div>
        <h1 class="takeaway">{{ headline() }}</h1>
      </div>
    </div>

    <div class="card card-pad" style="display:flex; gap:.6rem; align-items:center; flex-wrap:wrap; margin-bottom:1.1rem">
      <input style="flex:1; min-width:200px" [(ngModel)]="newTitle" (keyup.enter)="add()" placeholder="Add an action item…" />
      <select style="width:auto" [(ngModel)]="newPriority" title="Priority"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      <input style="width:auto" type="date" [(ngModel)]="newDue" title="Due date" />
      <button class="btn btn-primary" (click)="add()" [disabled]="!newTitle.trim()">Add</button>
    </div>

    <div class="filters">
      <input class="search-inp" type="search" placeholder="⌕ Search action items…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <div class="seg">
        @for (f of statusFilters; track f) { <button [class.active]="statusF()===f" (click)="statusF.set(f)">{{ f }}</button> }
      </div>
    </div>

    @if (error()) { <p class="error-banner">{{ error() }}</p> }

    @if (loading()) {
      <div class="table-wrap" style="padding:1rem">@for (i of [1,2,3,4]; track i) { <div class="skel skel-line" style="height:34px;margin:.5rem 0"></div> }</div>
    } @else if (visible().length === 0) {
      <div class="table-wrap"><div class="empty"><span class="em">✔</span><div class="et">Nothing here</div><div>{{ q() || statusF()!=='all' ? 'No items match your filters.' : 'Add an action item or generate one from a meeting summary.' }}</div></div></div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th></th><th>Action item</th><th>Owner</th><th>Source meeting</th><th>Priority</th><th>Due date</th><th>Status</th><th></th></tr></thead>
          <tbody>
            @for (t of visible(); track t.id) {
              <tr>
                <td style="width:36px" (click)="toggle(t)">
                  <span class="check" [class.on]="t.done">{{ t.done ? '✓' : '' }}</span>
                </td>
                <td><div class="cell-title" [class.struck]="t.done">{{ t.title }}</div></td>
                <td>{{ owner() }}</td>
                <td>{{ t.meeting_title || '—' }}</td>
                <td><span class="badge {{ t.priority }}">{{ t.priority }}</span></td>
                <td [class.overdue]="isOverdue(t)">{{ t.due_date ? (t.due_date | date:'MMM d, y') : '—' }}</td>
                <td><span class="status {{ t.done ? 'done' : 'open' }}">{{ t.done ? 'Done' : 'Open' }}</span></td>
                <td style="text-align:right"><button class="btn btn-sm btn-danger" (click)="remove(t)">✕</button></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    .check { width:24px; height:24px; border-radius:50%; border:2px solid var(--line-2); background:var(--surface); cursor:pointer; font-weight:800; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:.8rem; }
    .check.on { background:var(--ok); border-color:var(--ok); }
    .struck { text-decoration:line-through; color:var(--text-mute); }
    td.overdue { color:var(--danger); font-weight:700; }
  `],
})
export class TasksComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  statusFilters = ['all', 'open', 'done'] as const;
  statusF = signal<(typeof this.statusFilters)[number]>('open');
  q = signal('');
  tasks = signal<Task[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  newTitle = ''; newPriority: Task['priority'] = 'medium'; newDue = '';

  owner = computed(() => this.auth.user()?.name || this.auth.user()?.email || 'You');
  headline = computed(() => {
    if (this.loading()) return 'Track follow-ups across every meeting';
    const open = this.tasks().filter((t) => !t.done).length;
    return open === 0 ? 'All action items are closed' : `${open} open action ${open === 1 ? 'item' : 'items'} across your meetings`;
  });

  visible = computed(() => {
    const f = this.statusF(); const query = this.q().trim().toLowerCase();
    return this.tasks().filter((t) => {
      if (f === 'open' && t.done) return false;
      if (f === 'done' && !t.done) return false;
      if (query && !(t.title.toLowerCase().includes(query) || (t.meeting_title ?? '').toLowerCase().includes(query))) return false;
      return true;
    });
  });

  ngOnInit() { this.load(); }
  load() {
    this.loading.set(true);
    this.api.listTasks().subscribe({
      next: (t) => { this.tasks.set(t); this.loading.set(false); },
      error: () => { this.error.set('Could not load action items.'); this.loading.set(false); },
    });
  }
  add() {
    const title = this.newTitle.trim(); if (!title) return;
    this.api.createTask({ title, priority: this.newPriority, due_date: this.newDue || undefined }).subscribe({
      next: (t) => { this.tasks.update((l) => [t, ...l]); this.newTitle = ''; this.newDue = ''; this.newPriority = 'medium'; },
      error: () => this.error.set('Could not add item.'),
    });
  }
  toggle(t: Task) {
    this.api.updateTask(t.id, { done: !t.done }).subscribe({
      next: (u) => this.tasks.update((l) => l.map((x) => (x.id === u.id ? { ...x, done: u.done } : x))),
    });
  }
  remove(t: Task) {
    this.api.deleteTask(t.id).subscribe({ next: () => this.tasks.update((l) => l.filter((x) => x.id !== t.id)) });
  }
  isOverdue(t: Task): boolean { return !t.done && !!t.due_date && new Date(t.due_date) < new Date(new Date().toDateString()); }
}
