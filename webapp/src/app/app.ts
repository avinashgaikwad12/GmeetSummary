import { Component, signal, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SummaryService, Summary } from './summary.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private service = inject(SummaryService);

  protected readonly summaries = signal<Summary[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected title = '';
  protected transcript = '';

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: (rows) => {
        this.summaries.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not reach the API. Is it running?');
        this.loading.set(false);
      },
    });
  }

  add(): void {
    if (!this.title.trim() || !this.transcript.trim()) {
      return;
    }
    this.service.create(this.title, this.transcript).subscribe({
      next: (created) => {
        this.summaries.update((rows) => [created, ...rows]);
        this.title = '';
        this.transcript = '';
      },
      error: () => this.error.set('Failed to save. Check the API and database.'),
    });
  }
}
