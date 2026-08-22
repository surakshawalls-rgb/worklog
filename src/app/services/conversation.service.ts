import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CryptoService } from './crypto.service';
import { NotificationService } from './notification.service';
import { Conversation } from '../core/models/conversation.model';
import { RealtimeChannel } from '@supabase/supabase-js';

@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly supabase       = inject(SupabaseService);
  private readonly crypto          = inject(CryptoService);
  private readonly notifications   = inject(NotificationService);

  readonly conversations = signal<Conversation[]>([]);
  readonly isLoading     = signal<boolean>(false);

  private channel: RealtimeChannel | null = null;

  async loadConversations(userId: number): Promise<void> {
    this.isLoading.set(true);
    const { data } = await this.supabase.client.rpc('get_conversations', { p_user_id: userId });
    const rows = (data ?? []) as Array<Record<string, unknown>>;

    const mapped: Conversation[] = await Promise.all(
      rows.map(async r => ({
        conversationId:    r['conversation_id']    as number,
        otherUserId:       r['other_user_id']      as number,
        otherUsername:     r['other_username']     as string,
        otherDisplayName:  r['other_display_name'] as string,
        lastMessage:       r['last_message']
          ? await this.crypto.decrypt(r['last_message'] as string)
          : null,
        lastMessageAt:     (r['last_message_at'] as string | null) ?? null,
        unreadCount:       Number(r['unread_count'] ?? 0),
        friendshipStatus:  (r['friendship_status'] as Conversation['friendshipStatus']) ?? null,
      }))
    );

    this.conversations.set(mapped);
    this.isLoading.set(false);
  }

  async getOrCreateConversation(userId: number, otherId: number): Promise<number | null> {
    const { data, error } = await this.supabase.client.rpc('get_or_create_conversation', {
      p_user_id:  userId,
      p_other_id: otherId,
    });
    if (error || data === null) return null;
    return data as number;
  }

  // Update the last message preview when a new message arrives
  updateLastMessage(conversationId: number, message: string, at: string): void {
    this.conversations.update(convs =>
      convs.map(c =>
        c.conversationId === conversationId
          ? { ...c, lastMessage: message, lastMessageAt: at, unreadCount: c.unreadCount + 1 }
          : c
      )
    );
  }

  clearUnread(conversationId: number): void {
    this.conversations.update(convs =>
      convs.map(c => c.conversationId === conversationId ? { ...c, unreadCount: 0 } : c)
    );
  }

  // Realtime: listen for new messages across all conversations to update previews
  subscribeToUpdates(userId: number, onNewMessage: (convId: number, msg: string, at: string) => void): void {
    if (!this.supabase.isBrowser) return;
    this.unsubscribe();

    this.channel = this.supabase.client
      .channel(`conversations:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const row = payload.new as { conversation_id: number; message: string; created_at: string; sender_id: number };
          if (row.sender_id === userId) return; // own message, already shown
          const decrypted = await this.crypto.decrypt(row.message);
          // Find the conversation; reload if it's a brand-new one not yet in the list
          let conv = this.conversations().find(c => c.conversationId === row.conversation_id);
          if (!conv) {
            await this.loadConversations(userId);
            conv = this.conversations().find(c => c.conversationId === row.conversation_id);
          }
          this.notifications.newMessage(conv?.otherDisplayName ?? 'Someone', decrypted, row.conversation_id);
          onNewMessage(row.conversation_id, decrypted, row.created_at);
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
