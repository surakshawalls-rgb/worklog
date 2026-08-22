import { Message } from '../models/message.model';

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

export interface RawMessageRow {
  id: number;
  sender_id: number;
  message: string;
  created_at: string;
  users: {
    display_name: string | null;
    username: string;
  } | null;
}
