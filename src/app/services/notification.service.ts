import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  async initialize(_userId: number): Promise<void> { return; }
  requestPermission(): Promise<void> { return Promise.resolve(); }
  show(_title: string, _body: string, _route?: string): void { return; }
  newMessage(_name: string, _message: string, _conversationId: number): void { return; }
  friendRequest(_name: string): void { return; }
}
