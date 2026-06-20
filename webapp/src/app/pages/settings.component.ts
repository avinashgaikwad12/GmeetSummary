import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../auth.service';
import { GoogleCalendarService } from '../google-calendar.service';
import { ApiService } from '../api.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div><div class="eyebrow">Settings</div><h1 class="takeaway">Your workspace &amp; integrations</h1></div>
    </div>

    <div class="split">
      <div style="display:flex; flex-direction:column; gap:1.2rem">
        <!-- Account -->
        <section class="panel">
          <div class="panel-head"><h2>Account</h2></div>
          <div class="row" style="gap:.9rem">
            @if (user()?.picture) { <img [src]="user()!.picture" referrerpolicy="no-referrer" alt="" style="width:48px;height:48px;border-radius:50%" /> }
            @else { <span class="av" style="width:48px;height:48px;font-size:1rem">{{ (user()?.name || user()?.email || '?')[0] }}</span> }
            <div>
              <div style="font-weight:700">{{ user()?.name || '—' }}</div>
              <div class="muted" style="font-size:.85rem">{{ user()?.email }}</div>
              @if (user()?.isAdmin) { <span class="status reviewed" style="margin-top:.3rem; display:inline-block">Admin</span> }
            </div>
            <span class="spacer"></span>
            <button class="btn btn-sm btn-danger" (click)="logout()">Log out</button>
          </div>
        </section>

        <!-- Integration -->
        <section class="panel">
          <div class="panel-head"><h2>Google Calendar &amp; Meet</h2></div>
          <p class="muted" style="font-size:.88rem; margin-bottom:.8rem">
            Cadence creates auto-transcribing Meet links and reads transcripts after each call.
          </p>
          <div class="row">
            @if (connected()) { <span class="status done">Connected</span> }
            @else if (wasConnected()) { <span class="status open">Reconnect needed</span> }
            @else { <span class="status none">Not connected</span> }
            <span class="spacer"></span>
            <button class="btn btn-sm" (click)="reconnect()" [disabled]="busy()">{{ busy() ? '…' : (connected() ? 'Refresh access' : 'Connect') }}</button>
          </div>
          @if (gMsg()) { <p class="note" style="margin-top:.7rem">{{ gMsg() }}</p> }
        </section>

        <!-- Jira -->
        <section class="panel">
          <div class="panel-head"><h2>Jira</h2></div>
          <p class="muted" style="font-size:.88rem; margin-bottom:.8rem">
            Set your Jira base URL and every ticket key (e.g. PROJ-123) becomes a clickable deep link. Leave blank to keep keys as plain text.
          </p>
          <label class="field">
            <span>Jira base URL</span>
            <input [ngModel]="jiraUrl()" (ngModelChange)="jiraUrl.set($event)"
                   placeholder="https://your-company.atlassian.net/browse/" />
          </label>
          <div class="row">
            <span class="spacer"></span>
            <button class="btn btn-sm btn-primary" (click)="saveJira()" [disabled]="jiraBusy()">{{ jiraBusy() ? '…' : 'Save' }}</button>
          </div>
          @if (jiraMsg()) { <p class="note" style="margin-top:.7rem">{{ jiraMsg() }}</p> }
        </section>
      </div>

      <div style="display:flex; flex-direction:column; gap:1.2rem">
        <!-- Appearance -->
        <section class="panel">
          <div class="panel-head"><h2>Appearance</h2></div>
          <div class="row"><span>Theme</span><span class="spacer"></span>
            <button class="btn btn-sm" (click)="auth.toggleTheme()">{{ auth.theme()==='light' ? '☾ Switch to dark' : '☀ Switch to light' }}</button>
          </div>
        </section>

        <!-- About -->
        <section class="panel">
          <div class="panel-head"><h2>About</h2></div>
          <div class="rows" style="font-size:.88rem">
            <div class="rowitem"><div class="ri-main">Summaries</div><div class="dim">Google Gemini (free tier)</div></div>
            <div class="rowitem"><div class="ri-main">Transcripts</div><div class="dim">Google Meet API</div></div>
            <div class="rowitem"><div class="ri-main">App</div><div class="dim">Cadence · Meeting Intelligence</div></div>
          </div>
        </section>
      </div>
    </div>
  `,
})
export class SettingsComponent implements OnInit {
  auth = inject(AuthService);
  private cal = inject(GoogleCalendarService);
  private api = inject(ApiService);
  private router = inject(Router);
  user = this.auth.user;

  connected = signal(this.cal.isConnected());
  busy = signal(false);
  gMsg = signal<string | null>(null);

  jiraUrl = signal('');
  jiraBusy = signal(false);
  jiraMsg = signal<string | null>(null);

  ngOnInit() {
    this.api.getSettings().subscribe({ next: (s) => this.jiraUrl.set(s.jira_base_url ?? '') });
  }

  saveJira() {
    this.jiraBusy.set(true); this.jiraMsg.set(null);
    this.api.saveSettings({ jira_base_url: this.jiraUrl().trim() }).subscribe({
      next: (s) => { this.jiraUrl.set(s.jira_base_url ?? ''); this.jiraBusy.set(false); this.jiraMsg.set('Saved.'); },
      error: (e) => { this.jiraBusy.set(false); this.jiraMsg.set(e?.error?.error ?? 'Could not save.'); },
    });
  }

  wasConnected() { return this.cal.wasConnected(); }

  reconnect() {
    this.busy.set(true); this.gMsg.set(null);
    this.cal.requestAccess()
      .then(() => { this.busy.set(false); this.connected.set(true); this.gMsg.set('Google access granted.'); })
      .catch(() => { this.busy.set(false); this.gMsg.set('Access wasn’t granted — please try again and choose Allow.'); });
  }

  logout() { this.auth.logout(); this.router.navigate(['/login']); }
}
