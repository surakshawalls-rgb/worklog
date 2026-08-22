export interface ReplyTo {
  id: number;
  text: string;
  senderName: string;
}

export interface Reaction {
  emoji: string;
  userIds: number[];
}

export interface Message {
  id: number;
  senderId: number;
  message: string;          // text content OR image public URL
  messageType: 'text' | 'image' | 'call';
  createdAt: string;
  senderName: string;
  replyTo?: ReplyTo;
  reactions: Reaction[];
}
