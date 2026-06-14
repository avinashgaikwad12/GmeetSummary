import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';
import { Rsvp } from './api.service';

declare const google: any;

// Calendar (create events, read RSVPs) + Meet (create auto-transcribing spaces,
// read past conference transcripts).
const CAL_SCOPE =
  'https://www.googleapis.com/auth/calendar.events ' +
  'https://www.googleapis.com/auth/meetings.space.created ' +
  'https://www.googleapis.com/auth/meetings.space.readonly';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MEET_BASE = 'https://meet.googleapis.com/v2';
// Remembers (across reloads) that the user granted access at least once, so we
// only attempt the silent on-load sync for returning users. First-time visitors
// see no popup until they actually click "Connect".
const HINT_KEY = 'gcal_connected';

export interface CreatedEvent {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
  rsvp: Rsvp[];
}

export interface GEvent {
  id: string;
  title: string;
  startISO: string | null;
  endISO: string | null;
  allDay: boolean;
  htmlLink: string | null;
  meetLink: string | null;
  description: string | null;
  attendees: string[];
  /** The current user's RSVP on this event (accepted/declined/tentative/needsAction). */
  myStatus: string | null;
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
      // Fires on success and on OAuth-level errors (e.g. access_denied).
      callback: (resp: any) => {
        if (resp && resp.access_token) {
          this.accessToken = resp.access_token;
          this.tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000 - 60000;
          this.setHint(true);
          this.settle(resp.access_token, null);
        } else {
          this.settle(null, resp ?? new Error('No access token returned'));
        }
      },
      // Fires for everything the callback doesn't: silent (prompt:'none')
      // failures, popup closed/blocked, etc. Without this the promise hangs.
      error_callback: (err: any) => this.settle(null, err ?? new Error('Authorization failed')),
    });
  }

  /** Resolve or reject the in-flight request exactly once, then clear it. */
  private settle(token: string | null, err: any): void {
    const p = this.pending;
    this.pending = undefined;
    if (!p) return;
    if (token) p.resolve(token);
    else p.reject(err);
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
    // Cancel any in-flight request (e.g. the silent on-load attempt) so this
    // user-initiated click wins and its popup isn't torn down by a collision.
    this.settle(null, new Error('superseded'));
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      // Default prompt: Google shows the consent popup the first time and
      // returns the token silently afterwards. (Must be called from a click.)
      this.tokenClient.requestAccessToken();
    });
  }

  /** Public: trigger consent / fetch a token now (call from a click handler). */
  requestAccess(): Promise<string> {
    return this.getToken();
  }

  /** Silent token: resolves null instead of prompting (safe to call on load). */
  private getTokenSilent(): Promise<string | null> {
    this.ensureClient();
    if (!this.tokenClient) return Promise.resolve(null);
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return Promise.resolve(this.accessToken);
    }
    if (this.pending) return Promise.resolve(null); // don't disturb an in-flight request
    return new Promise<string | null>((resolve) => {
      this.pending = { resolve: (t) => resolve(t), reject: () => resolve(null) };
      try {
        this.tokenClient.requestAccessToken({ prompt: 'none' });
      } catch {
        this.settle(null, new Error('silent token request failed'));
      }
    });
  }

  /** Whether we currently hold a usable calendar token (no prompt). */
  isConnected(): boolean {
    return !!this.accessToken && Date.now() < this.tokenExpiry;
  }

  /** True if the user has granted access before (persisted across reloads). */
  wasConnected(): boolean {
    try {
      return localStorage.getItem(HINT_KEY) === '1';
    } catch {
      return false;
    }
  }

  private setHint(on: boolean): void {
    try {
      if (on) localStorage.setItem(HINT_KEY, '1');
      else localStorage.removeItem(HINT_KEY);
    } catch {
      /* storage unavailable (private mode) — silent sync just won't persist */
    }
  }

  /**
   * List the user's primary-calendar events in a time range.
   * interactive=true shows the consent popup if needed (call from a click);
   * interactive=false stays silent and returns null if not connected.
   */
  async listEvents(
    timeMinISO: string,
    timeMaxISO: string,
    interactive: boolean
  ): Promise<GEvent[] | null> {
    const token = interactive ? await this.getToken() : await this.getTokenSilent();
    if (!token) return null;
    const url =
      `${CAL_BASE}?singleEvents=true&orderBy=startTime&maxResults=250` +
      `&timeMin=${encodeURIComponent(timeMinISO)}&timeMax=${encodeURIComponent(timeMaxISO)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Calendar API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return (data.items ?? [])
      .filter((e: any) => e.status !== 'cancelled')
      .map((e: any) => {
        const attendees = e.attendees ?? [];
        return {
          id: e.id,
          title: e.summary ?? '(no title)',
          startISO: e.start?.dateTime ?? e.start?.date ?? null,
          endISO: e.end?.dateTime ?? e.end?.date ?? null,
          allDay: !e.start?.dateTime,
          htmlLink: e.htmlLink ?? null,
          meetLink: e.hangoutLink ?? null,
          description: e.description ?? null,
          attendees: attendees.map((a: any) => a.email).filter(Boolean),
          myStatus: attendees.find((a: any) => a.self)?.responseStatus ?? null,
        };
      });
  }

  /** Pull the Meet code (e.g. "abc-defg-hij") out of a meet.google.com link. */
  static meetingCode(meetLink: string | null | undefined): string | null {
    if (!meetLink) return null;
    const m = meetLink.match(/meet\.google\.com\/([a-z0-9-]+)/i);
    return m ? m[1] : null;
  }

  /**
   * Fetch the transcript of the most recent conference for a Meet code via the
   * Google Meet REST API. Returns null when no transcript exists yet (e.g.
   * transcription wasn't turned on, or it's still processing). Throws on
   * auth/permission errors. interactive=true shows the consent popup if needed.
   */
  async getMeetTranscript(meetingCode: string, interactive: boolean): Promise<string | null> {
    const token = interactive ? await this.getToken() : await this.getTokenSilent();
    if (!token) throw new Error('not_connected');
    const headers = { Authorization: `Bearer ${token}` };
    const get = async (url: string) => {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Meet API ${res.status}: ${await res.text()}`);
      return res.json();
    };

    // 1. Resolve the space (the meeting code is accepted as the space id).
    const space = await get(`${MEET_BASE}/spaces/${encodeURIComponent(meetingCode)}`);

    // 2. Most recent conference record for that space. Only proceed once the
    //    conference has ENDED (endTime set) — otherwise the meeting is still
    //    running and the transcript would be partial.
    const recFilter = encodeURIComponent(`space.name="${space.name}"`);
    const records = (await get(`${MEET_BASE}/conferenceRecords?filter=${recFilter}`))
      .conferenceRecords ?? [];
    if (!records.length || !records[0].endTime) return null;
    const record: string = records[0].name; // already newest-first

    // 3. First transcript on that conference — only once it's finalized.
    const transcripts = (await get(`${MEET_BASE}/${record}/transcripts`)).transcripts ?? [];
    if (!transcripts.length) return null;
    if (transcripts[0].state && transcripts[0].state !== 'ENDED') return null;
    const transcript: string = transcripts[0].name;

    // 4. Map participant resource names → display names.
    const names = new Map<string, string>();
    try {
      for (const p of (await get(`${MEET_BASE}/${record}/participants`)).participants ?? []) {
        names.set(
          p.name,
          p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName ?? 'Participant'
        );
      }
    } catch { /* names are best-effort */ }

    // 5. Page through the transcript entries and stitch them into text.
    const lines: string[] = [];
    let pageToken = '';
    do {
      const url =
        `${MEET_BASE}/${transcript}/entries?pageSize=1000` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const data = await get(url);
      for (const e of data.transcriptEntries ?? []) {
        const who = names.get(e.participant) ?? 'Speaker';
        if (e.text) lines.push(`${who}: ${e.text}`);
      }
      pageToken = data.nextPageToken ?? '';
    } while (pageToken);

    return lines.length ? lines.join('\n') : null;
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

  /**
   * Create a Meet space whose transcription auto-starts when anyone joins, so a
   * transcript is always generated for meetings made through this app — no
   * manual "Transcribe" click. Returns null if the space can't be created (e.g.
   * the account lacks the transcription feature), so callers can fall back.
   */
  private async createMeetSpace(
    token: string
  ): Promise<{ meetingUri: string; meetingCode: string } | null> {
    try {
      const res = await fetch(`${MEET_BASE}/spaces`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            accessType: 'OPEN', // anyone with the link can join (invited or not)
            artifactConfig: {
              transcriptionConfig: { autoTranscriptionGeneration: 'ON' },
            },
          },
        }),
      });
      if (!res.ok) {
        console.warn('Meet space create failed:', res.status, await res.text());
        return null;
      }
      const s = await res.json();
      if (!s.meetingUri || !s.meetingCode) return null;
      return { meetingUri: s.meetingUri, meetingCode: s.meetingCode };
    } catch (e) {
      console.warn('Meet space create error:', e);
      return null;
    }
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

    // Prefer an auto-transcribing Meet space; fall back to a Calendar-minted
    // Meet link if the space API isn't available for this account.
    const space = await this.createMeetSpace(token);

    const body: any = {
      summary: opts.title,
      description:
        (opts.description ?? '') +
        (space ? `\n\nJoin Google Meet: ${space.meetingUri}` : ''),
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: opts.attendees.map((email) => ({ email })),
    };
    let url = `${CAL_BASE}?sendUpdates=all`;
    if (space) {
      body.location = space.meetingUri;
    } else {
      body.conferenceData = {
        createRequest: {
          requestId: 'mh-' + Math.random().toString(36).slice(2),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
      url += '&conferenceDataVersion=1';
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Calendar API ${res.status}: ${await res.text()}`);
    const ev = await res.json();
    return {
      eventId: ev.id,
      meetLink: space?.meetingUri ?? ev.hangoutLink ?? null,
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
