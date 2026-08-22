export type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended';
export type CallMediaType = 'audio' | 'video';

export interface IncomingCall {
  conversationId: number;
  callerId: number;
  callerName: string;
  mediaType: CallMediaType;
}

export interface CallSignal {
  type: 'ring' | 'accept' | 'offer' | 'answer' | 'ice-candidate' | 'reject' | 'end';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  callerId?: number;
  callerName?: string;
  calleeId?: number;
  conversationId?: number;
  mediaType?: CallMediaType;
}
