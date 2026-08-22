import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CryptoService } from './crypto.service';
import { Message, Reaction, ReplyTo } from '../core/models/message.model';
import { CallMediaType } from '../core/models/call.model';
import { RealtimeChannel } from '@supabase/supabase-js';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly cryptoService   = inject(CryptoService);

  readonly messages       = signal<Message[]>([]);
  readonly isLoading      = signal<boolean>(false);
  readonly error          = signal<string | null>(null);
  readonly uploadingImage = signal<boolean>(false);

  private realtimeChannel: RealtimeChannel | null = null;
  private scrollCallback: (() => void) | null = null;

  registerScrollCallback(fn: () => void): void { this.scrollCallback = fn; }

  /** Decrypt raw DB row and parse JSON message payloads (text, image, call, reply). */
  private async mapRaw(row: Record<string, unknown>): Promise<Message> {
    const u = row['users'] as { display_name: string | null; username: string } | null;
    const decrypted = await this.cryptoService.decrypt(row['message'] as string);

    let messageText = decrypted;
    let messageType: 'text' | 'image' | 'call' = 'text';
    let replyTo: ReplyTo | undefined;

    try {
      const parsed = JSON.parse(decrypted) as {
        type?: string;
        content?: string;
        replyTo?: ReplyTo;
        durationSec?: number;
        mediaType?: CallMediaType;
      };
      if (parsed.type === 'image' && parsed.content) {
        messageType = 'image';
        messageText = parsed.content;
      } else if (parsed.type === 'call') {
        messageType = 'call';
        const secs = Number(parsed.durationSec ?? 0);
        const mm = Math.floor(secs / 60).toString().padStart(2, '0');
        const ss = (secs % 60).toString().padStart(2, '0');
        const label = parsed.mediaType === 'video' ? 'Video call' : 'Voice call';
        messageText = secs > 0
          ? `${label} ended (${mm}:${ss})`
          : label;
      } else if (parsed.type === 'text' && parsed.content) {
        messageText = parsed.content;
      }
      if (parsed.replyTo) replyTo = parsed.replyTo;
    } catch { /* plain text */ }

    return {
      id:          row['id']         as number,
      senderId:    row['sender_id']  as number,
      message:     messageText,
      messageType,
      createdAt:   row['created_at'] as string,
      senderName:  u?.display_name ?? u?.username ?? 'Unknown',
      replyTo,
      reactions:   [],
    };
  }

  async loadMessages(conversationId: number): Promise<void> {
    if (!this.supabaseService.isBrowser) return;
    this.isLoading.set(true);
    this.error.set(null);
    this.messages.set([]);

    const { data, error } = await this.supabaseService.client
      .from('messages')
      .select('id, sender_id, message, created_at, users ( display_name, username )')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) { this.error.set('Failed to load messages.'); this.isLoading.set(false); return; }

    const mapped = await Promise.all(
      ((data ?? []) as unknown as Record<string, unknown>[]).map(r => this.mapRaw(r))
    );
    this.messages.set(mapped);
    this.isLoading.set(false);
    await this.loadReactions(mapped.map(m => m.id));
    this.scrollToBottom();
  }

  /** Load all reactions for the given message IDs and merge into messages. */
  private async loadReactions(messageIds: number[]): Promise<void> {
    if (messageIds.length === 0) return;
    const { data } = await this.supabaseService.client
      .from('message_reactions')
      .select('message_id, user_id, emoji')
      .in('message_id', messageIds);

    if (!data || data.length === 0) return;

    const map = new Map<number, Reaction[]>();
    for (const row of data as Array<{ message_id: number; user_id: number; emoji: string }>) {
      if (!map.has(row.message_id)) map.set(row.message_id, []);
      const arr = map.get(row.message_id)!;
      const existing = arr.find(r => r.emoji === row.emoji);
      if (existing) existing.userIds.push(row.user_id);
      else arr.push({ emoji: row.emoji, userIds: [row.user_id] });
    }

    this.messages.update(msgs => msgs.map(m => ({
      ...m, reactions: map.get(m.id) ?? m.reactions,
    })));
  }

  async sendMessage(conversationId: number, senderId: number, text: string, replyTo?: ReplyTo): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const payload = replyTo
      ? JSON.stringify({ type: 'text', content: trimmed, replyTo })
      : trimmed;
    const encrypted = await this.cryptoService.encrypt(payload);
    const { error } = await this.supabaseService.client.rpc('send_dm', {
      p_conversation_id: conversationId,
      p_sender_id:       senderId,
      p_message:         encrypted,
    });
    if (error) {
      console.error('[sendMessage]', error.message);
      this.error.set('Failed to send. Please try again.');
    }
  }

  /** Upload image to Supabase Storage then send as an encrypted image message. */
  async sendImageMessage(conversationId: number, senderId: number, file: File): Promise<void> {
    if (file.size > 5 * 1024 * 1024) {
      this.error.set('Image must be under 5 MB.'); return;
    }

    this.uploadingImage.set(true);
    const path = `${senderId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;

    const { data: uploadData, error: uploadError } = await this.supabaseService.client.storage
      .from('chat-attachments')
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError || !uploadData) {
      this.error.set('Image upload failed. Please try again.');
      this.uploadingImage.set(false); return;
    }

    const { data: urlData } = this.supabaseService.client.storage
      .from('chat-attachments')
      .getPublicUrl(uploadData.path);

    const payload  = JSON.stringify({ type: 'image', content: urlData.publicUrl });
    const encrypted = await this.cryptoService.encrypt(payload);

    const { error } = await this.supabaseService.client.rpc('send_dm', {
      p_conversation_id: conversationId,
      p_sender_id:       senderId,
      p_message:         encrypted,
    });

    this.uploadingImage.set(false);
    if (error) this.error.set('Failed to send image.');
  }

  async sendCallLog(
    conversationId: number,
    senderId: number,
    durationSec: number,
    mediaType: CallMediaType,
  ): Promise<void> {
    const payload = JSON.stringify({
      type: 'call',
      content: mediaType === 'video' ? 'Video call ended' : 'Voice call ended',
      durationSec: Math.max(0, Math.floor(durationSec)),
      mediaType,
    });
    const encrypted = await this.cryptoService.encrypt(payload);
    const { error } = await this.supabaseService.client.rpc('send_dm', {
      p_conversation_id: conversationId,
      p_sender_id:       senderId,
      p_message:         encrypted,
    });
    if (error) {
      console.error('[sendCallLog]', error.message);
      this.error.set('Failed to save call history.');
    }
  }

  /** Toggle emoji reaction on a message with optimistic UI update. */
  async toggleReaction(messageId: number, userId: number, emoji: string): Promise<void> {
    const msg = this.messages().find(m => m.id === messageId);
    if (!msg) return;

    const alreadyReacted = msg.reactions.find(r => r.emoji === emoji)?.userIds.includes(userId) ?? false;

    // Optimistic update
    this.messages.update(msgs => msgs.map(m => {
      if (m.id !== messageId) return m;
      if (alreadyReacted) {
        return { ...m, reactions: m.reactions
          .map(r => r.emoji === emoji ? { ...r, userIds: r.userIds.filter(id => id !== userId) } : r)
          .filter(r => r.userIds.length > 0) };
      } else {
        const existing = m.reactions.find(r => r.emoji === emoji);
        return { ...m, reactions: existing
          ? m.reactions.map(r => r.emoji === emoji ? { ...r, userIds: [...r.userIds, userId] } : r)
          : [...m.reactions, { emoji, userIds: [userId] }] };
      }
    }));

    const { error } = await this.supabaseService.client.rpc('toggle_reaction', {
      p_message_id: messageId, p_user_id: userId, p_emoji: emoji,
    });
    if (error) console.error('[toggleReaction]', error.message);
  }

  subscribeRealtime(conversationId: number, currentUserId: number): void {
    if (!this.supabaseService.isBrowser) return;
    this.unsubscribeRealtime();

    this.realtimeChannel = this.supabaseService.client
      .channel(`chat:conv:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        async (payload) => {
          const row = payload.new as Record<string, unknown>;
          if ((row['sender_id'] as number) === currentUserId) return;

          const { data } = await this.supabaseService.client
            .from('users').select('display_name, username').eq('id', row['sender_id']).single();

          const msg = await this.mapRaw({
            ...row,
            users: data as Record<string, unknown> | null,
          });

          this.messages.update(msgs => [...msgs, msg]);
          this.scrollToBottom();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const row = payload.new as { message_id: number; user_id: number; emoji: string };
          if (row.user_id === currentUserId) return; // already applied optimistically
          this.messages.update(msgs => msgs.map(m => {
            if (m.id !== row.message_id) return m;
            const existing = m.reactions.find(r => r.emoji === row.emoji);
            return { ...m, reactions: existing
              ? m.reactions.map(r => r.emoji === row.emoji ? { ...r, userIds: [...r.userIds, row.user_id] } : r)
              : [...m.reactions, { emoji: row.emoji, userIds: [row.user_id] }] };
          }));
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const row = payload.old as { message_id: number; user_id: number; emoji: string };
          if (row.user_id === currentUserId) return; // already applied optimistically
          this.messages.update(msgs => msgs.map(m => {
            if (m.id !== row.message_id) return m;
            return { ...m, reactions: m.reactions
              .map(r => r.emoji === row.emoji ? { ...r, userIds: r.userIds.filter(id => id !== row.user_id) } : r)
              .filter(r => r.userIds.length > 0) };
          }));
        }
      )
      .subscribe();
  }

  unsubscribeRealtime(): void {
    if (this.realtimeChannel) {
      this.supabaseService.client.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
  }

  scrollToBottom(): void { setTimeout(() => this.scrollCallback?.(), 50); }
}
