import { Component, OnInit, OnDestroy, inject, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { ConversationService } from '../../services/conversation.service';
import { FriendshipService } from '../../services/friendship.service';
import { NotificationService } from '../../services/notification.service';
import { formatTime } from '../../core/utils/date.util';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chatbubbleEllipsesOutline, peopleOutline, personCircleOutline, addOutline } from 'ionicons/icons';

@Component({
  selector: 'app-conversations',
  standalone: true,
  imports: [CommonModule, RouterLink, IonIcon],
  templateUrl: './conversations.component.html',
  styleUrl: './conversations.component.scss',
})
export class ConversationsComponent implements OnInit, OnDestroy {
  private readonly auth        = inject(AuthService);
  private readonly convService = inject(ConversationService);
  private readonly friendSvc   = inject(FriendshipService);
  private readonly router      = inject(Router);
  private readonly notifSvc    = inject(NotificationService);

  readonly currentUser   = computed(() => this.auth.getCurrentUser());
  readonly conversations = this.convService.conversations;
  readonly isLoading     = this.convService.isLoading;
  readonly pendingCount  = this.friendSvc.pendingCount;

  constructor() {
    addIcons({ chatbubbleEllipsesOutline, peopleOutline, personCircleOutline, addOutline });
  }

  async ngOnInit(): Promise<void> {
    const user = this.currentUser();
    if (!user) return;
    // Initialize push notifications (FCM on Android, Web Notification API on browser)
    await this.notifSvc.initialize(user.id);
    await this.convService.loadConversations(user.id);
    await this.friendSvc.loadPendingRequests(user.id);
    this.friendSvc.subscribeToRequests(user.id);
    this.convService.subscribeToUpdates(user.id, (convId, msg, at) => {
      this.convService.updateLastMessage(convId, msg, at);
    });
  }

  ngOnDestroy(): void {
    this.convService.unsubscribe();
    this.friendSvc.unsubscribe();
  }

  openChat(conversationId: number, otherDisplayName: string, otherUserId: number): void {
    this.convService.clearUnread(conversationId);
    this.router.navigate(['/chat', conversationId], {
      state: { otherDisplayName, otherUserId }
    });
  }

  formatTime(ts: string | null): string {
    if (!ts) return '';
    return formatTime(ts);
  }

  initials(name: string): string {
    return name.charAt(0).toUpperCase();
  }
}
