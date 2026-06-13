import { Routes } from '@angular/router';
import { authGuard, adminGuard } from './guards';
import { LayoutComponent } from './layout.component';
import { LoginComponent } from './pages/login.component';
import { DashboardComponent } from './pages/dashboard.component';
import { MeetingsComponent } from './pages/meetings.component';
import { TasksComponent } from './pages/tasks.component';
import { AdminComponent } from './pages/admin.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', component: DashboardComponent, title: 'Dashboard' },
      { path: 'meetings', component: MeetingsComponent, title: 'Meetings' },
      { path: 'tasks', component: TasksComponent, title: 'Action Items' },
      { path: 'admin', component: AdminComponent, canActivate: [adminGuard], title: 'Admin' },
    ],
  },
  { path: '**', redirectTo: '' },
];
