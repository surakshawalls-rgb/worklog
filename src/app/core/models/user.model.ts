export interface User {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  isActive: boolean;
  createdAt: string;
}
