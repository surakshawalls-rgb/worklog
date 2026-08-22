import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, inject, effect, PLATFORM_ID
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { CallService } from '../../services/call.service';
import { AuthService } from '../../services/auth.service';
import { ChatService } from '../../services/chat.service';
import { CallMediaType } from '../../core/models/call.model';

@Component({
  selector: 'app-call',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './call.component.html',
  styleUrl: './call.component.scss',
})
export class CallComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('remoteAudio') private remoteAudio!: ElementRef<HTMLAudioElement>;
  @ViewChild('remoteVideo') private remoteVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('localVideo') private localVideo!: ElementRef<HTMLVideoElement>;

  private readonly callService = inject(CallService);
  private readonly authService = inject(AuthService);
  private readonly chatService = inject(ChatService);
  private readonly router      = inject(Router);
  private readonly route       = inject(ActivatedRoute);
  private readonly platformId  = inject(PLATFORM_ID);

  readonly callState    = this.callService.callState;
  readonly mediaType    = this.callService.mediaType;
  readonly isMuted      = this.callService.isMuted;
  readonly isCameraOff  = this.callService.isCameraOff;
  readonly peerName     = this.callService.activePeerName;
  readonly duration     = this.callService.callDuration;
  readonly remoteStream = this.callService.remoteStream;
  readonly localPreview = this.callService.localPreview;

  private conversationId = 0;
  private callInitiated = false;
  private viewReady = false;

  constructor() {
    // Navigate back when call fully ends
    effect(() => {
      if (this.callInitiated && this.callState() === 'idle') {
        void this.router.navigate(this.conversationId > 0 ? ['/chat', this.conversationId] : ['/chats']);
      }
    });

    // Wire remote audio element once stream arrives
    effect(() => {
      const stream = this.remoteStream();
      if (!stream || !this.viewReady) return;
      if (this.mediaType() === 'video' && this.remoteVideo?.nativeElement) {
        this.remoteVideo.nativeElement.srcObject = stream;
        void this.remoteVideo.nativeElement.play().catch(() => {});
      }
      if (this.remoteAudio?.nativeElement) {
        this.remoteAudio.nativeElement.srcObject = stream;
        void this.remoteAudio.nativeElement.play().catch(() => {});
      }
    });

    effect(() => {
      const stream = this.localPreview();
      if (!stream || !this.viewReady || this.mediaType() !== 'video' || !this.localVideo?.nativeElement) return;
      this.localVideo.nativeElement.srcObject = stream;
      void this.localVideo.nativeElement.play().catch(() => {});
    });

    effect(() => {
      if (this.localVideo?.nativeElement) {
        this.localVideo.nativeElement.style.opacity = this.isCameraOff() ? '0.35' : '1';
      }
    });
  }

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    const user = this.authService.getCurrentUser();
    const convId = Number(this.route.snapshot.paramMap.get('id'));
    if (!user || !convId) { this.router.navigate(['/chats']); return; }
    this.conversationId = convId;

    const state = history.state as {
      role: 'caller' | 'callee';
      calleeId?: number;
      calleeName?: string;
      callerName?: string;
      mediaType?: CallMediaType;
    } | undefined;

    const mediaType = state?.mediaType ?? 'audio';
    this.callService.setMediaType(mediaType);

    if (state?.role === 'caller' && state.calleeId) {
      await this.callService.startCall(
        convId,
        user.id,
        user.displayName,
        state.calleeId,
        state.calleeName ?? '',
        mediaType,
      );
    } else if (state?.role === 'callee') {
      this.callService.activeConvId.set(convId);
      if (state.callerName) this.callService.activePeerName.set(state.callerName);
      await this.callService.acceptCall(user.id);
    } else {
      this.router.navigate(['/chats']);
      return;
    }

    this.callInitiated = true;
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    // Apply stream that may have arrived before view was ready
    const stream = this.remoteStream();
    if (stream) {
      if (this.remoteAudio?.nativeElement) {
        this.remoteAudio.nativeElement.srcObject = stream;
        void this.remoteAudio.nativeElement.play().catch(() => {});
      }
      if (this.mediaType() === 'video' && this.remoteVideo?.nativeElement) {
        this.remoteVideo.nativeElement.srcObject = stream;
        void this.remoteVideo.nativeElement.play().catch(() => {});
      }
    }

    const local = this.localPreview();
    if (local && this.mediaType() === 'video' && this.localVideo?.nativeElement) {
      this.localVideo.nativeElement.srcObject = local;
      void this.localVideo.nativeElement.play().catch(() => {});
    }
  }

  ngOnDestroy(): void {
    const s = this.callState();
    if (s !== 'idle' && s !== 'ended') void this.callService.endCall();
  }

  toggleMute(): void { this.callService.toggleMute(); }

  toggleCamera(): void { this.callService.toggleCamera(); }

  async endCall(): Promise<void> {
    const user = this.authService.getCurrentUser();
    if (user && this.conversationId > 0) {
      await this.chatService.sendCallLog(this.conversationId, user.id, this.duration(), this.mediaType());
    }
    await this.callService.endCall();
    await this.router.navigate(this.conversationId > 0 ? ['/chat', this.conversationId] : ['/chats']);
  }

  formatDuration(secs: number): string {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  statusLabel(): string {
    switch (this.callState()) {
      case 'calling':   return 'Calling…';
      case 'ringing':   return 'Ringing…';
      case 'connected': return this.formatDuration(this.duration());
      case 'ended':     return 'Call ended';
      default:          return '';
    }
  }
}
