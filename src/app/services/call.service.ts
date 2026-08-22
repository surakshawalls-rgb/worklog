import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CallSignal, CallState, IncomingCall, CallMediaType } from '../core/models/call.model';
import { RealtimeChannel } from '@supabase/supabase-js';

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const RING_TIMEOUT_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class CallService {
  private readonly supabase = inject(SupabaseService);

  readonly callState     = signal<CallState>('idle');
  readonly incomingCall  = signal<IncomingCall | null>(null);
  readonly mediaType     = signal<CallMediaType>('audio');
  readonly isMuted       = signal(false);
  readonly isCameraOff   = signal(false);
  readonly callDuration  = signal(0);
  readonly remoteStream  = signal<MediaStream | null>(null);
  readonly localPreview  = signal<MediaStream | null>(null);
  readonly activeConvId  = signal<number | null>(null);
  readonly activePeerName = signal<string>('');

  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private sessionChannel: RealtimeChannel | null = null;
  private ringChannel: RealtimeChannel | null = null;
  private durationTimer: ReturnType<typeof setInterval> | null = null;
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];

  // ── Global ring listener — called once after login ─────────────────────────
  subscribeGlobal(userId: number): void {
    if (this.ringChannel) return;
    this.ringChannel = this.supabase.client
      .channel(`call-ring:${userId}`)
      .on('broadcast', { event: 'ring' }, ({ payload }: { payload: CallSignal }) => {
        if (this.callState() !== 'idle') return;
        this.incomingCall.set({
          conversationId: payload.conversationId!,
          callerId:        payload.callerId!,
          callerName:      payload.callerName!,
          mediaType:       payload.mediaType ?? 'audio',
        });
        this.callState.set('ringing');
      })
      .subscribe();
  }

  setMediaType(mediaType: CallMediaType): void {
    this.mediaType.set(mediaType);
    this.isCameraOff.set(false);
  }

  unsubscribeGlobal(): void {
    if (this.ringChannel) {
      this.supabase.client.removeChannel(this.ringChannel);
      this.ringChannel = null;
    }
  }

  // ── Caller: initiate a call ────────────────────────────────────────────────
  async startCall(
    conversationId: number,
    callerId: number,
    callerName: string,
    calleeId: number,
    calleeName: string,
    mediaType: CallMediaType,
  ): Promise<void> {
    if (this.callState() !== 'idle') return;
    this.setMediaType(mediaType);
    this.callState.set('calling');
    this.activeConvId.set(conversationId);
    this.activePeerName.set(calleeName);

    // Subscribe to session signaling channel
    this.sessionChannel = this.supabase.client
      .channel(`call:${conversationId}`)
      .on('broadcast', { event: 'signal' }, ({ payload }: { payload: CallSignal }) => {
        void this.handleSignal(payload, 'caller', callerId);
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        // Deliver ring to callee via their personal channel
        const ringCh = this.supabase.client.channel(`call-ring:${calleeId}`);
        ringCh.subscribe(async (s) => {
          if (s !== 'SUBSCRIBED') return;
          await ringCh.send({
            type: 'broadcast', event: 'ring',
            payload: {
              type: 'ring', callerId, callerName, calleeId, conversationId, mediaType,
            } satisfies CallSignal,
          });
          setTimeout(() => this.supabase.client.removeChannel(ringCh), 4000);
        });
      });

    // Auto-cancel if no answer within timeout
    this.ringTimer = setTimeout(() => {
      if (this.callState() === 'calling') this.teardown();
    }, RING_TIMEOUT_MS);
  }

  // ── Called from app root when callee taps Accept (before navigating) ───────
  prepareAccept(): void {
    if (this.ringTimer) { clearTimeout(this.ringTimer); this.ringTimer = null; }
    this.incomingCall.set(null);
  }

  // ── Callee: complete accept inside call screen ─────────────────────────────
  async acceptCall(currentUserId: number): Promise<void> {
    if (this.callState() !== 'connected') this.callState.set('connected');
    this.startDurationTimer();

    this.sessionChannel = this.supabase.client
      .channel(`call:${this.activeConvId()!}`)
      .on('broadcast', { event: 'signal' }, ({ payload }: { payload: CallSignal }) => {
        void this.handleSignal(payload, 'callee', currentUserId);
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        await this.sessionChannel!.send({
          type: 'broadcast', event: 'signal',
          payload: { type: 'accept' } satisfies CallSignal,
        });
      });
  }

  // ── Callee: reject without opening call screen ─────────────────────────────
  async rejectCall(): Promise<void> {
    const incoming = this.incomingCall();
    if (!incoming) return;
    const ch = this.supabase.client.channel(`call:${incoming.conversationId}`);
    ch.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      await ch.send({ type: 'broadcast', event: 'signal', payload: { type: 'reject' } satisfies CallSignal });
      setTimeout(() => this.supabase.client.removeChannel(ch), 1000);
    });
    this.incomingCall.set(null);
    this.mediaType.set('audio');
    this.callState.set('idle');
  }

  // ── End active call ────────────────────────────────────────────────────────
  async endCall(): Promise<void> {
    await this.sessionChannel?.send({ type: 'broadcast', event: 'signal', payload: { type: 'end' } satisfies CallSignal });
    this.teardown();
  }

  toggleMute(): void {
    if (!this.localStream) return;
    const nowMuted = !this.isMuted();
    this.localStream.getAudioTracks().forEach(t => (t.enabled = !nowMuted));
    this.isMuted.set(nowMuted);
  }

  toggleCamera(): void {
    if (this.mediaType() !== 'video' || !this.localStream) return;
    const track = this.localStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    this.isCameraOff.set(!track.enabled);
  }

  // ── Internal signal handler ────────────────────────────────────────────────
  private async handleSignal(signal: CallSignal, role: 'caller' | 'callee', _uid: number): Promise<void> {
    switch (signal.type) {
      case 'accept':
        if (role === 'caller') await this.createAndSendOffer();
        break;
      case 'offer':
        if (role === 'callee') await this.handleOffer(signal.sdp!);
        break;
      case 'answer':
        if (role === 'caller') await this.handleAnswer(signal.sdp!);
        break;
      case 'ice-candidate':
        if (signal.candidate) await this.addIce(signal.candidate);
        break;
      case 'reject':
      case 'end':
        this.teardown();
        break;
    }
  }

  private async createAndSendOffer(): Promise<void> {
    if (this.ringTimer) { clearTimeout(this.ringTimer); this.ringTimer = null; }
    await this.setupLocalStream();
    this.pc = this.buildPc();
    this.localStream!.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!));
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.mediaType() === 'video',
    });
    await this.pc.setLocalDescription(offer);
    await this.sessionChannel?.send({
      type: 'broadcast', event: 'signal',
      payload: { type: 'offer', sdp: offer.sdp } satisfies CallSignal,
    });
    this.callState.set('connected');
    this.startDurationTimer();
  }

  private async handleOffer(sdp: string): Promise<void> {
    await this.setupLocalStream();
    this.pc = this.buildPc();
    this.localStream!.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!));
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    for (const c of this.pendingIce) await this.pc.addIceCandidate(c);
    this.pendingIce = [];
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.sessionChannel?.send({
      type: 'broadcast', event: 'signal',
      payload: { type: 'answer', sdp: answer.sdp } satisfies CallSignal,
    });
  }

  private async handleAnswer(sdp: string): Promise<void> {
    await this.pc?.setRemoteDescription({ type: 'answer', sdp });
    for (const c of this.pendingIce) await this.pc!.addIceCandidate(c);
    this.pendingIce = [];
  }

  private async addIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.pc?.remoteDescription) {
      await this.pc.addIceCandidate(candidate);
    } else {
      this.pendingIce.push(candidate);
    }
  }

  private buildPc(): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      void this.sessionChannel?.send({
        type: 'broadcast', event: 'signal',
        payload: { type: 'ice-candidate', candidate: candidate.toJSON() } satisfies CallSignal,
      });
    };
    pc.ontrack = (e) => this.remoteStream.set(e.streams[0] ?? null);
    return pc;
  }

  private async setupLocalStream(): Promise<void> {
    if (this.localStream) return;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: this.mediaType() === 'video',
    });
    this.localPreview.set(this.localStream);
  }

  private startDurationTimer(): void {
    this.callDuration.set(0);
    this.durationTimer = setInterval(() => this.callDuration.update(s => s + 1), 1000);
  }

  teardown(): void {
    if (this.ringTimer)    { clearTimeout(this.ringTimer);    this.ringTimer    = null; }
    if (this.durationTimer) { clearInterval(this.durationTimer); this.durationTimer = null; }
    this.pc?.close(); this.pc = null;
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.localPreview.set(null);
    if (this.sessionChannel) {
      this.supabase.client.removeChannel(this.sessionChannel);
      this.sessionChannel = null;
    }
    this.remoteStream.set(null);
    this.pendingIce = [];
    this.isMuted.set(false);
    this.isCameraOff.set(false);
    this.callDuration.set(0);
    this.activeConvId.set(null);
    this.activePeerName.set('');
    this.mediaType.set('audio');
    this.callState.set('ended');
    setTimeout(() => this.callState.set('idle'), 1500);
  }
}
