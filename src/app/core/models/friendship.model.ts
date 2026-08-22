export interface FriendRequest {
  friendshipId: number;
  requesterId: number;
  username: string;
  displayName: string;
  createdAt: string;
}

export interface Contact {
  friendshipId: number;
  contactId: number;
  username: string;
  displayName: string;
  status: 'accepted' | 'pending';
}

export interface UserSearchResult {
  id: number;
  username: string;
  displayName: string;
  friendshipStatus: 'pending' | 'accepted' | 'declined' | 'blocked' | null;
  friendshipId: number | null;
}
