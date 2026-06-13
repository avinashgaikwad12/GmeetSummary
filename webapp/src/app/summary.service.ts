import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

export interface Summary {
  id: number;
  title: string;
  transcript: string;
  summary: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class SummaryService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl; // set per-environment (local vs Render)

  list(): Observable<Summary[]> {
    return this.http.get<Summary[]>(`${this.baseUrl}/api/summaries`);
  }

  create(title: string, transcript: string): Observable<Summary> {
    return this.http.post<Summary>(`${this.baseUrl}/api/summaries`, { title, transcript });
  }
}
