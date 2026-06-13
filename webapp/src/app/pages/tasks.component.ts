import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Task } from '../api.service';

@Component({
  selector: 'app-tasks',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="page-head">
      <div><h1>Action Items</h1><p class="muted">Track follow-ups from your meetings.</p></div>
    </div>

    <!-- Quick add -->
    <div class="card card-pad addbar">
      <input class="grow" [(ngModel)]="newTitle" (keyup.enter)="add()" placeholder="Add a new action item…" />
      <select [(ngModel)]="newPriority" title="Priority">
        <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
      </select>
      <input type="date" [(ngModel)]="newDue" title="Due date" />
      <button class="btn btn-primary" (click)="add()" [disabled]="!newTitle.trim()">Add</button>
    </div>

    <div class="tabs">
      @for (f of filters; track f.key) {
        <button class="tab" [class.active]="filter()===f.key" (click)="setFilter(f.key)">{{ f.label }}</button>
      }
    </div>

    @if (error()) { <p class="error-banner">{{ error() }}</p> }

    @if (visible().length === 0) {
      <div class="card card-pad empty"><span class="em">🎯</span>No action items here.</div>
    } @else {
      <div class="list">
        @for (t of visible(); track t.id) {
          <div class="card card-pad task" [class.done]="t.done">
            <button class="check" [class.on]="t.done" (click)="toggle(t)" [attr.aria-label]="t.done?'Mark open':'Mark done'">
              {{ t.done ? '✓' : '' }}
            </button>
            <div class="t-main">
              <div class="t-title">{{ t.title }}</div>
              <div class="t-meta">
                <span class="badge {{t.priority}}">{{ t.priority }}</span>
                @if (t.due_date) { <span class="due" [class.overdue]="isOverdue(t)">📅 {{ t.due_date | date:'MMM d, y' }}</span> }
                @if (t.meeting_title) { <span class="muted">· {{ t.meeting_title }}</span> }
              </div>
            </div>
            <button class="btn btn-sm btn-danger" (click)="remove(t)">✕</button>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .page-head { margin-bottom:1.1rem; } h1 { font-size:1.5rem; }
    .addbar { display:flex; gap:.6rem; align-items:center; margin-bottom:1.1rem; flex-wrap:wrap; }
    .addbar .grow { flex:1; min-width:180px; }
    .addbar select, .addbar input[type=date] { width:auto; }
    .tabs { display:flex; gap:.3rem; background:var(--surface); border:1px solid var(--border); padding:.25rem; border-radius:12px; width:fit-content; margin-bottom:1rem; }
    .tab { border:none; background:transparent; color:var(--text-dim); font-weight:600; font-size:.85rem; padding:.4rem .9rem; border-radius:9px; cursor:pointer; }
    .tab.active { background:var(--brand-grad); color:#fff; }
    .list { display:flex; flex-direction:column; gap:.6rem; }
    .task { display:flex; align-items:center; gap:.9rem; }
    .task.done .t-title { text-decoration:line-through; color:var(--text-dim); }
    .check { width:26px; height:26px; flex-shrink:0; border-radius:50%; border:2px solid var(--border);
      background:var(--surface); cursor:pointer; font-weight:800; color:#fff; display:flex; align-items:center; justify-content:center; }
    .check.on { background:var(--green); border-color:var(--green); }
    .t-main { flex:1; min-width:0; }
    .t-title { font-weight:600; font-size:.95rem; }
    .t-meta { display:flex; align-items:center; gap:.5rem; margin-top:.3rem; font-size:.78rem; flex-wrap:wrap; }
    .due.overdue { color:var(--red); font-weight:700; }
  `],
})
export class TasksComponent implements OnInit {
  private api = inject(ApiService);

  filters = [
    { key: 'open', label: 'Open' },
    { key: 'done', label: 'Done' },
    { key: 'all', label: 'All' },
  ] as const;

  tasks = signal<Task[]>([]);
  filter = signal<'open' | 'done' | 'all'>('open');
  error = signal<string | null>(null);

  newTitle = '';
  newPriority: Task['priority'] = 'medium';
  newDue = '';

  visible = computed(() => {
    const f = this.filter();
    return this.tasks().filter((t) => f === 'all' || (f === 'done' ? t.done : !t.done));
  });

  ngOnInit() { this.load(); }

  load() {
    this.api.listTasks().subscribe({
      next: (t) => this.tasks.set(t),
      error: () => this.error.set('Could not load action items.'),
    });
  }

  setFilter(f: 'open' | 'done' | 'all') { this.filter.set(f); }

  add() {
    const title = this.newTitle.trim();
    if (!title) return;
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
    this.api.deleteTask(t.id).subscribe({
      next: () => this.tasks.update((l) => l.filter((x) => x.id !== t.id)),
    });
  }

  isOverdue(t: Task): boolean {
    return !t.done && !!t.due_date && new Date(t.due_date) < new Date(new Date().toDateString());
  }
}
