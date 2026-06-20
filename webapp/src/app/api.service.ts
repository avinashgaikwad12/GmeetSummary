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
  jira_keys?: string[];
  created_at: string;
}

export interface JiraSummary {
  jira_key: string;
  meeting_count: number;
  with_conclusion: number;
  first_discussed: string | null;
  last_discussed: string | null;
  title: string | null;
  has_journey: boolean;
  journey_built_at: string | null;
}

export interface JiraMeeting {
  id: number;
  title: string;
  meeting_date: string | null;
  meet_link: string | null;
  status: Meeting['status'];
  has_summary: boolean;
  conclusion: string | null;
}

export interface JiraDetail {
  jira_key: string;
  title: string | null;
  journey_summary: string | null;
  journey_built_at: string | null;
  base_url: string | null;
  meetings: JiraMeeting[];
}

export interface MeetingJira {
  jira_key: string;
  conclusion: string | null;
}

export interface JiraMapData {
  jiras: { jira_key: string; meeting_count: number; title: string | null }[];
  meetings: { id: number; title: string; meeting_date: string | null }[];
  edges: { meeting_id: number; jira_key: string }[];
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

  // ---- Jira tracking ----
  listJiras(): Observable<JiraSummary[]> {
    return this.http.get<JiraSummary[]>(`${this.base}/api/jiras`);
  }
  getJira(key: string): Observable<JiraDetail> {
    return this.http.get<JiraDetail>(`${this.base}/api/jiras/${encodeURIComponent(key)}`);
  }
  jiraMap(): Observable<JiraMapData> {
    return this.http.get<JiraMapData>(`${this.base}/api/jira-map`);
  }
  setJiraTitle(key: string, title: string): Observable<{ jira_key: string; title: string | null }> {
    return this.http.patch<{ jira_key: string; title: string | null }>(`${this.base}/api/jiras/${encodeURIComponent(key)}`, { title });
  }
  synthesizeJira(key: string): Observable<{ journey_summary: string; journey_built_at: string }> {
    return this.http.post<{ journey_summary: string; journey_built_at: string }>(`${this.base}/api/jiras/${encodeURIComponent(key)}/synthesize`, {});
  }
  listMeetingJiras(meetingId: number): Observable<MeetingJira[]> {
    return this.http.get<MeetingJira[]>(`${this.base}/api/meetings/${meetingId}/jiras`);
  }
  linkJira(meetingId: number, jiraKey: string): Observable<MeetingJira> {
    return this.http.post<MeetingJira>(`${this.base}/api/meetings/${meetingId}/jiras`, { jira_key: jiraKey });
  }
  updateMeetingJira(meetingId: number, key: string, conclusion: string): Observable<MeetingJira> {
    return this.http.patch<MeetingJira>(`${this.base}/api/meetings/${meetingId}/jiras/${encodeURIComponent(key)}`, { conclusion });
  }
  extractMeetingJira(meetingId: number, key: string): Observable<MeetingJira> {
    return this.http.post<MeetingJira>(`${this.base}/api/meetings/${meetingId}/jiras/${encodeURIComponent(key)}/extract`, {});
  }
  unlinkJira(meetingId: number, key: string): Observable<unknown> {
    return this.http.delete(`${this.base}/api/meetings/${meetingId}/jiras/${encodeURIComponent(key)}`);
  }

  // ---- Settings ----
  getSettings(): Observable<{ jira_base_url: string | null }> {
    return this.http.get<{ jira_base_url: string | null }>(`${this.base}/api/settings`);
  }
  saveSettings(body: { jira_base_url: string }): Observable<{ jira_base_url: string | null }> {
    return this.http.patch<{ jira_base_url: string | null }>(`${this.base}/api/settings`, body);
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
