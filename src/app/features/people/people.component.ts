import { Component, OnInit, OnDestroy, inject, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { FriendshipService } from '../../services/friendship.service';
import { ConversationService } from '../../services/conversation.service';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chatbubbleEllipsesOutline, peopleOutline, personCircleOutline,
  searchOutline, checkmarkOutline, closeOutline, personAddOutline,
  banOutline, arrowBackOutline
} from 'ionicons/icons';

type Tab = 'search' | 'requests' | 'contacts';

@Component({
  selector: 'app-people',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonIcon, IonSpinner],
  templateUrl: './people.component.html',
  styleUrl: './people.component.scss',
})
export class PeopleComponent implements OnInit, OnDestroy {
  private readonly auth        = inject(AuthService);
  private readonly friendSvc   = inject(FriendshipService);
  private readonly convService = inject(ConversationService);
  private readonly router      = inject(Router);

  readonly currentUser    = computed(() => this.auth.getCurrentUser());
  readonly pendingCount   = this.friendSvc.pendingCount;
  readonly pendingRequests= this.friendSvc.pendingRequests;
  readonly contacts       = this.friendSvc.contacts;
  readonly searchResults  = this.friendSvc.searchResults;
  readonly isSearching    = this.friendSvc.isSearching;

  activeTab  = signal<Tab>('search');
  searchQuery= signal('');
  actionLoading = signal<number | null>(null); // tracks which user/friendship is in progress

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    addIcons({
      chatbubbleEllipsesOutline, peopleOutline, personCircleOutline,
      searchOutline, checkmarkOutline, closeOutline, personAddOutline,
      banOutline, arrowBackOutline
    });
  }

  async ngOnInit(): Promise<void> {
    const user = this.currentUser();
    if (!user) return;
    await Promise.all([
      this.friendSvc.loadPendingRequests(user.id),
      this.friendSvc.loadContacts(user.id),
    ]);
    this.friendSvc.subscribeToRequests(user.id);
  }

  ngOnDestroy(): void { this.friendSvc.unsubscribe(); }

  setTab(tab: Tab): void { this.activeTab.set(tab); }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.runSearch(), 350);
  }

  private async runSearch(): Promise<void> {
    const user = this.currentUser();
    if (!user) return;
    await this.friendSvc.searchUsers(this.searchQuery(), user.id);
  }

  async sendRequest(userId: number): Promise<void> {
    const user = this.currentUser();
    if (!user) return;
    this.actionLoading.set(userId);
    await this.friendSvc.sendFriendRequest(user.id, userId);
    // Refresh search to update button state
    await this.friendSvc.searchUsers(this.searchQuery(), user.id);
    this.actionLoading.set(null);
  }

  async acceptRequest(friendshipId: number): Promise<void> {
    const user = this.currentUser();
    if (!user) return;
    this.actionLoading.set(friendshipId);
    await this.friendSvc.respondToRequest(friendshipId, user.id, 'accepted');
    await this.friendSvc.loadContacts(user.id);
    this.actionLoading.set(null);
  }

  async declineRequest(friendshipId: number): Promise<void> {
    const user = this.currentUser();
    if (!user) return;
    this.actionLoading.set(friendshipId);
    await this.friendSvc.respondToRequest(friendshipId, user.id, 'declined');
    this.actionLoading.set(null);
  }

  async openChat(otherUserId: number, displayName: string): Promise<void> {
    const user = this.currentUser();
    if (!user) return;
    const convId = await this.convService.getOrCreateConversation(user.id, otherUserId);
    if (convId) {
      this.router.navigate(['/chat', convId], { state: { otherDisplayName: displayName, otherUserId } });
    }
  }

  initials(name: string): string { return name.charAt(0).toUpperCase(); }
}
