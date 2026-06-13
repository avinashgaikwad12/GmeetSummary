import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';
import { Rsvp } from './api.service';

declare const google: any;

const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export interface CreatedEvent {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
  rsvp: Rsvp[];
}

/**
 * Talks to the Google Calendar API directly from the browser using an OAuth
 * access token obtained via Google Identity Services. We use fetch() (not
 * Angular HttpClient) so our API auth interceptor never touches Google calls.
 */
@Injectable({ providedIn: 'root' })
export class GoogleCalendarService {
  private tokenClient: any = null;
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private pending?: { resolve: (t: string) => void; reject: (e: any) => void };

  private ensureClient(): void {
    if (this.tokenClient || typeof google === 'undefined' || !google.accounts?.oauth2) return;
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: environment.googleClientId,
      scope: CAL_SCOPE,
      callback: (resp: any) => {
        if (resp.error) {
          this.pending?.reject(resp);
        } else {
          this.accessToken = resp.access_token;
          this.tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000 - 60000;
          this.pending?.resolve(resp.access_token);
        }
        this.pending = undefined;
      },
    });
  }

  /** Returns a valid calendar access token, prompting the user if needed. */
  private getToken(): Promise<string> {
    this.ensureClient();
    if (!this.tokenClient) {
      return Promise.reject(new Error('Google Identity Services not loaded yet.'));
    }
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return Promise.resolve(this.accessToken);
    }
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      // Empty prompt tries silent; Google shows consent the first time automatically.
      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  static parseEmails(text: string | null | undefined): string[] {
    if (!text) return [];
    return Array.from(
      new Set(
        text
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
      )
    );
  }

  /** Create a calendar event (with Meet link) and invite attendees. */
  async createEvent(opts: {
    title: string;
    description?: string | null;
    startISO: string;
    durationMins?: number;
    attendees: string[];
  }): Promise<CreatedEvent> {
    const token = await this.getToken();
    const start = new Date(opts.startISO);
    const end = new Date(start.getTime() + (opts.durationMins ?? 60) * 60000);
    const body = {
      summary: opts.title,
      description: opts.description ?? '',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: opts.attendees.map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: 'mh-' + Math.random().toString(36).slice(2),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    const res = await fetch(`${CAL_BASE}?sendUpdates=all&conferenceDataVersion=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Calendar API ${res.status}: ${await res.text()}`);
    const ev = await res.json();
    return {
      eventId: ev.id,
      meetLink: ev.hangoutLink ?? null,
      htmlLink: ev.htmlLink ?? null,
      rsvp: (ev.attendees ?? []).map((a: any) => ({ email: a.email, status: a.responseStatus })),
    };
  }

  /** Re-fetch an event and return current attendee RSVP statuses. */
  async getRsvps(eventId: string): Promise<Rsvp[]> {
    const token = await this.getToken();
    const res = await fetch(`${CAL_BASE}/${encodeURIComponent(eventId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Calendar API ${res.status}: ${await res.text()}`);
    const ev = await res.json();
    return (ev.attendees ?? []).map((a: any) => ({ email: a.email, status: a.responseStatus }));
  }
}
