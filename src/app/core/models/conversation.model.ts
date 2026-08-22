export interface Conversation {
  conversationId: number;
  otherUserId: number;
  otherUsername: string;
  otherDisplayName: string;
  lastMessage: string | null;       // still encrypted from DB; decrypted in service
  lastMessageAt: string | null;
  unreadCount: number;
  friendshipStatus: 'pending' | 'accepted' | 'declined' | 'blocked' | null;
}
