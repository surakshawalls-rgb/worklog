import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { NotificationService } from './notification.service';
import { FriendRequest, Contact, UserSearchResult } from '../core/models/friendship.model';
import { RealtimeChannel } from '@supabase/supabase-js';

@Injectable({ providedIn: 'root' })
export class FriendshipService {
  private readonly supabase      = inject(SupabaseService);
  private readonly notifications = inject(NotificationService);

  readonly pendingRequests = signal<FriendRequest[]>([]);
  readonly pendingCount    = signal<number>(0);
  readonly contacts        = signal<Contact[]>([]);
  readonly searchResults   = signal<UserSearchResult[]>([]);
  readonly isSearching     = signal<boolean>(false);

  private channel: RealtimeChannel | null = null;

  // ─── Load pending incoming requests ──────────────────────────────────────────
  async loadPendingRequests(userId: number): Promise<void> {
    const { data } = await this.supabase.client.rpc('get_pending_requests', { p_user_id: userId });
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const mapped: FriendRequest[] = rows.map(r => ({
      friendshipId: r['friendship_id'] as number,
      requesterId:  r['requester_id']  as number,
      username:     r['username']      as string,
      displayName:  r['display_name']  as string,
      createdAt:    r['created_at']    as string,
    }));
    this.pendingRequests.set(mapped);
    this.pendingCount.set(mapped.length);
  }

  // ─── Load accepted contacts ───────────────────────────────────────────────────
  async loadContacts(userId: number): Promise<void> {
    const { data } = await this.supabase.client.rpc('get_contacts', { p_user_id: userId });
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    this.contacts.set(rows.map(r => ({
      friendshipId: r['friendship_id'] as number,
      contactId:    r['contact_id']    as number,
      username:     r['username']      as string,
      displayName:  r['display_name']  as string,
      status:       'accepted',
    })));
  }

  // ─── Search users ─────────────────────────────────────────────────────────────
  async searchUsers(query: string, currentUserId: number): Promise<void> {
    if (!query.trim()) { this.searchResults.set([]); return; }
    this.isSearching.set(true);
    const { data } = await this.supabase.client.rpc('search_users', {
      p_query:           query.trim(),
      p_current_user_id: currentUserId,
    });
    this.isSearching.set(false);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    this.searchResults.set(rows.map(r => ({
      id:               r['id']               as number,
      username:         r['username']         as string,
      displayName:      r['display_name']     as string,
      friendshipStatus: (r['friendship_status'] as 'pending' | 'accepted' | 'declined' | 'blocked' | null) ?? null,
      friendshipId:     (r['friendship_id']   as number | null) ?? null,
    })));
  }

  // ─── Send friend request ──────────────────────────────────────────────────────
  async sendFriendRequest(requesterId: number, addresseeId: number): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase.client.rpc('send_friend_request', {
      p_requester_id: requesterId,
      p_addressee_id: addresseeId,
    });
    if (error) {
      if (error.message?.includes('ALREADY_EXISTS')) return { success: false, error: 'Request already sent.' };
      return { success: false, error: 'Could not send request.' };
    }
    return { success: true };
  }

  // ─── Accept / Decline / Block ─────────────────────────────────────────────────
  async respondToRequest(
    friendshipId: number,
    userId: number,
    action: 'accepted' | 'declined' | 'blocked'
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase.client.rpc('respond_to_request', {
      p_friendship_id: friendshipId,
      p_user_id:       userId,
      p_action:        action,
    });
    if (error) return { success: false, error: 'Could not update request.' };

    // Remove from pending list
    this.pendingRequests.update(reqs => reqs.filter(r => r.friendshipId !== friendshipId));
    this.pendingCount.update(n => Math.max(0, n - 1));
    return { success: true };
  }

  // ─── Realtime: incoming friend requests ───────────────────────────────────────
  subscribeToRequests(userId: number): void {
    if (!this.supabase.isBrowser) return;
    this.unsubscribe();

    this.channel = this.supabase.client
      .channel(`friendships:${userId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'friendships',
          filter: `addressee_id=eq.${userId}`,
        },
        async () => {
          // Reload pending requests to get full user details
          await this.loadPendingRequests(userId);
          // Notify if tab not focused
          const latest = this.pendingRequests()[0];
          if (latest) this.notifications.friendRequest(latest.displayName);
        }
      )
      .subscribe();
  }

  unsubscribe(): void {
    if (this.channel) {
      this.supabase.client.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
