import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
    { path: 'login', loadComponent: () => import('./components/login/login').then(m => m.Login) },
    { path: 'mapa', loadComponent: () => import('./components/map/map').then(m => m.Map), canActivate: [authGuard] },
    { path: 'usuarios', loadComponent: () => import('./components/users/users').then(m => m.Users), canActivate: [authGuard] },
    { path: 'usuarios/nuevo', loadComponent: () => import('./components/add-user/add-user').then(m => m.AddUser), canActivate: [authGuard] },
    { path: 'usuarios/editar/:id', loadComponent: () => import('./components/add-user/add-user').then(m => m.AddUser), canActivate: [authGuard] },
    { path: 'historial', loadComponent: () => import('./components/historial/historial').then(m => m.Historial), canActivate: [authGuard] },
    { path: 'cambiar-contrasena', loadComponent: () => import('./components/change-password/change-password').then(m => m.ChangePassword), canActivate: [authGuard] },
    { path: '', redirectTo: 'login', pathMatch: 'full' },
    { path: '**', redirectTo: 'login' },
];
