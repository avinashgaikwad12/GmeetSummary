import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

export interface Rsvp {
  email: string;
  status: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

export interface Meeting {
  id: number;
  title: string;
  meeting_date: string | null;
  attendees: string | null;
  meet_link: string | null;
  notes: string | null;
  summary: string | null;
  transcript?: string | null;
  status: 'upcoming' | 'completed' | 'cancelled';
  google_event_id?: string | null;
  rsvp?: Rsvp[] | null;
  created_at: string;
}

export interface MeetingSession {
  id: number;
  conference_record: string;
  started_at: string | null;
  ended_at: string | null;
  transcript: string | null;
  summary: string | null;
  created_at: string;
}

export interface Task {
  id: number;
  title: string;
  done: boolean;
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  meeting_id: number | null;
  meeting_title?: string | null;
  created_at: string;
}

export interface Stats {
  meetings: { total: number; upcoming: number; completed: number };
  tasks: { open: number; done: number };
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  // ---- Meetings ----
  listMeetings(status = 'all', q = ''): Observable<Meeting[]> {
    let params = new HttpParams().set('status', status);
    if (q) params = params.set('q', q);
    return this.http.get<Meeting[]>(`${this.base}/api/meetings`, { params });
  }
  createMeeting(body: Partial<Meeting>): Observable<Meeting> {
    return this.http.post<Meeting>(`${this.base}/api/meetings`, body);
  }
  updateMeeting(id: number, body: Partial<Meeting>): Observable<Meeting> {
    return this.http.patch<Meeting>(`${this.base}/api/meetings/${id}`, body);
  }
  deleteMeeting(id: number): Observable<unknown> {
    return this.http.delete(`${this.base}/api/meetings/${id}`);
  }
  /** Send a transcript to the server, which summarizes it with Claude. */
  summarizeMeeting(id: number, transcript: string): Observable<Meeting> {
    return this.http.post<Meeting>(`${this.base}/api/meetings/${id}/summarize`, { transcript });
  }
  /** Per-occurrence sessions: one row per Meet conference for a meeting. */
  listSessions(id: number): Observable<MeetingSession[]> {
    return this.http.get<MeetingSession[]>(`${this.base}/api/meetings/${id}/sessions`);
  }
  addSession(
    id: number,
    body: { conference_record: string; started_at?: string | null; ended_at?: string | null; transcript: string }
  ): Observable<MeetingSession> {
    return this.http.post<MeetingSession>(`${this.base}/api/meetings/${id}/sessions`, body);
  }
  /** One consolidated summary across several meetings. */
  combinedSummary(meetingIds: number[]): Observable<{ summary: string }> {
    return this.http.post<{ summary: string }>(`${this.base}/api/meetings/combined-summary`, {
      meeting_ids: meetingIds,
    });
  }

  // ---- Tasks ----
  listTasks(done?: boolean): Observable<Task[]> {
    let params = new HttpParams();
    if (done !== undefined) params = params.set('done', String(done));
    return this.http.get<Task[]>(`${this.base}/api/tasks`, { params });
  }
  createTask(body: Partial<Task>): Observable<Task> {
    return this.http.post<Task>(`${this.base}/api/tasks`, body);
  }
  updateTask(id: number, body: Partial<Task>): Observable<Task> {
    return this.http.patch<Task>(`${this.base}/api/tasks/${id}`, body);
  }
  deleteTask(id: number): Observable<unknown> {
    return this.http.delete(`${this.base}/api/tasks/${id}`);
  }

  // ---- Stats ----
  stats(): Observable<Stats> {
    return this.http.get<Stats>(`${this.base}/api/stats`);
  }
}
