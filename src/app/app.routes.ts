import { Routes } from '@angular/router';

export const routes: Routes = [
	{ path: 'chats', loadComponent: () => import('./features/conversations/conversations.component').then(m => m.ConversationsComponent) },
	{ path: 'chat/:id', loadComponent: () => import('./features/chat/chat.component').then(m => m.ChatComponent) },
	{ path: 'people', loadComponent: () => import('./features/people/people.component').then(m => m.PeopleComponent) },
	{ path: 'profile', loadComponent: () => import('./features/profile/profile.component').then(m => m.ProfileComponent) },
	{ path: 'call/:id', loadComponent: () => import('./features/call/call.component').then(m => m.CallComponent) },
];
