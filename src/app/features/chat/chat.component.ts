import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef,
  inject, signal, computed, PLATFORM_ID
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { ConversationService } from '../../services/conversation.service';
import { Message, ReplyTo } from '../../core/models/message.model';
import { CallMediaType } from '../../core/models/call.model';
import { formatTime } from '../../core/utils/date.util';

// Common emojis grouped for the picker
const EMOJI_LIST = [
  '😀','😂','🥹','😊','😍','🤩','😎','🥳','🤔','😅',
  '😭','🤣','😤','😱','😴','🤗','🫡','🤫','😏','😒',
  '👍','👎','👋','🤝','✌️','🤞','👏','🙏','💪','🫶',
  '❤️','🧡','💛','💚','💙','💜','🖤','💕','💯','🔥',
  '🎉','✅','⭐','🎁','🎊','💡','🎵','🎂','🏆','🚀',
  '😺','🐶','🦊','🐼','🦁','🐸','🦋','🌹','🌊','🍕',
];

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('messageListRef') private messageListRef!: ElementRef<HTMLDivElement>;
  @ViewChild('messageInput')   private messageInputRef!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('imageInput')     private imageInputRef!: ElementRef<HTMLInputElement>;

  readonly chatService = inject(ChatService);
  readonly authService = inject(AuthService);
  private readonly convService = inject(ConversationService);
  private readonly router     = inject(Router);
  private readonly route      = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);

  readonly currentUser     = computed(() => this.authService.getCurrentUser());
  readonly messages        = this.chatService.messages;
  readonly isLoading       = this.chatService.isLoading;
  readonly error           = this.chatService.error;
  readonly uploadingImage  = this.chatService.uploadingImage;

  messageText      = signal('');
  conversationId   = signal<number | null>(null);
  otherDisplayName = signal<string>('Chat');
  otherUserId      = signal<number | null>(null);
  showEmojiPicker  = signal(false);
  replyingTo       = signal<Message | null>(null);
  activeContextId  = signal<number | null>(null);

  readonly emojis = EMOJI_LIST;
  readonly QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) { this.router.navigate(['/chats']); return; }
    this.conversationId.set(id);

    const state = history.state as { otherDisplayName?: string; otherUserId?: number } | undefined;
    if (state?.otherDisplayName) this.otherDisplayName.set(state.otherDisplayName);
    if (state?.otherUserId)     this.otherUserId.set(state.otherUserId);

    const user = this.currentUser();
    if (!user) return;

    // Recover peer metadata when chat is opened directly (e.g., returning from call screen).
    void this.ensureConversationContext(user.id, id);

    this.chatService.registerScrollCallback(() => this.scrollToBottom());
    this.chatService.loadMessages(id).then(() => this.focusInput());
    this.chatService.subscribeRealtime(id, user.id);
  }

  ngOnDestroy(): void { this.chatService.unsubscribeRealtime(); }

  startVoiceCall(): void {
    this.startCall('audio');
  }

  startVideoCall(): void {
    this.startCall('video');
  }

  private startCall(mediaType: CallMediaType): void {
    const user = this.currentUser();
    const convId = this.conversationId();
    const otherId = this.otherUserId();
    if (!user || !convId || !otherId) return;
    this.router.navigate(['/call', convId], {
      state: {
        role: 'caller',
        calleeId:   otherId,
        calleeName: this.otherDisplayName(),
        mediaType,
      },
    });
  }

  isOwnMessage(senderId: number): boolean { return this.currentUser()?.id === senderId; }
  formatTime(ts: string): string { return formatTime(ts); }

  toggleEmojiPicker(): void { this.showEmojiPicker.update(v => !v); }
  closeEmojiPicker(): void  { this.showEmojiPicker.set(false); }

  appendEmoji(emoji: string): void {
    this.messageText.update(t => t + emoji);
    this.showEmojiPicker.set(false);
    this.focusInput();
  }

  // ── Reply ──────────────────────────────────────────────────
  setReply(msg: Message, event: Event): void {
    event.stopPropagation();
    this.replyingTo.set(msg);
    this.activeContextId.set(null);
    this.focusInput();
  }

  clearReply(): void { this.replyingTo.set(null); }

  // ── Reaction context menu ──────────────────────────────────
  toggleContext(msgId: number, event: Event): void {
    event.stopPropagation();
    this.showEmojiPicker.set(false);
    this.activeContextId.update(id => id === msgId ? null : msgId);
  }

  closeContext(): void { this.activeContextId.set(null); }

  async pickReaction(msg: Message, emoji: string, event: Event): Promise<void> {
    event.stopPropagation();
    const user = this.currentUser();
    if (!user) return;
    this.activeContextId.set(null);
    await this.chatService.toggleReaction(msg.id, user.id, emoji);
  }

  hasMyReaction(msg: Message, emoji: string): boolean {
    const user = this.currentUser();
    if (!user) return false;
    return msg.reactions?.find(r => r.emoji === emoji)?.userIds.includes(user.id) ?? false;
  }

  triggerImagePicker(): void {
    this.imageInputRef?.nativeElement?.click();
  }

  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    input.value = ''; // reset so same file can be selected again

    const convId = this.conversationId();
    const user   = this.currentUser();
    if (!convId || !user) return;

    await this.chatService.sendImageMessage(convId, user.id, file);
    this.scrollToBottom();
  }

  async onSend(): Promise<void> {
    const text   = this.messageText().trim();
    const convId = this.conversationId();
    const user   = this.currentUser();
    const reply  = this.replyingTo();
    if (!text || !convId || !user) return;

    const replyTo: ReplyTo | undefined = reply
      ? { id: reply.id, text: reply.messageType === 'image' ? '[Image]' : reply.message, senderName: reply.senderName }
      : undefined;

    this.messageText.set('');
    this.replyingTo.set(null);
    this.chatService.messages.update(msgs => [
      ...msgs,
      { id: Date.now(), senderId: user.id, message: text, messageType: 'text', createdAt: new Date().toISOString(), senderName: user.displayName, replyTo, reactions: [] }
    ]);
    this.scrollToBottom();
    await this.chatService.sendMessage(convId, user.id, text, replyTo);
    this.focusInput();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.onSend(); }
  }

  openImage(url: string): void {
    window.open(url, '_blank');
  }

  private async ensureConversationContext(userId: number, conversationId: number): Promise<void> {
    if (this.otherUserId()) return;
    await this.convService.loadConversations(userId);
    const conv = this.convService.conversations().find(c => c.conversationId === conversationId);
    if (!conv) return;
    this.otherUserId.set(conv.otherUserId);
    this.otherDisplayName.set(conv.otherDisplayName);
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      const el = this.messageListRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private focusInput(): void {
    setTimeout(() => this.messageInputRef?.nativeElement?.focus(), 50);
  }

  goBack(): void {
  this.router.navigate(['/']);
}
}
