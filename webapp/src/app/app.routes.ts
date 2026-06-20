import { Routes } from '@angular/router';
import { authGuard, adminGuard } from './guards';
import { LayoutComponent } from './layout.component';
import { LoginComponent } from './pages/login.component';
import { DashboardComponent } from './pages/dashboard.component';
import { MeetingsComponent } from './pages/meetings.component';
import { MeetingDetailComponent } from './pages/meeting-detail.component';
import { CalendarComponent } from './pages/calendar.component';
import { TasksComponent } from './pages/tasks.component';
import { JiraListComponent } from './pages/jira-list.component';
import { JiraDetailComponent } from './pages/jira-detail.component';
import { SearchComponent } from './pages/search.component';
import { SettingsComponent } from './pages/settings.component';
import { AdminComponent } from './pages/admin.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', component: DashboardComponent, title: 'Dashboard · Cadence' },
      { path: 'meetings', component: MeetingsComponent, title: 'Meetings · Cadence' },
      { path: 'meetings/:id', component: MeetingDetailComponent, title: 'Meeting · Cadence' },
      { path: 'calendar', component: CalendarComponent, title: 'Calendar · Cadence' },
      { path: 'tasks', component: TasksComponent, title: 'Action items · Cadence' },
      { path: 'jira', component: JiraListComponent, title: 'Jira tracker · Cadence' },
      { path: 'jira/:key', component: JiraDetailComponent, title: 'Ticket · Cadence' },
      { path: 'search', component: SearchComponent, title: 'Search · Cadence' },
      { path: 'settings', component: SettingsComponent, title: 'Settings · Cadence' },
      { path: 'admin', component: AdminComponent, canActivate: [adminGuard], title: 'Admin · Cadence' },
    ],
  },
  { path: '**', redirectTo: '' },
];
