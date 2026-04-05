import { create } from 'zustand';

interface UserState {
  role: string;
  userId: number;
  setRole: (role: string) => void;
  setUserId: (id: number) => void;
}

export const useUserStore = create<UserState>((set) => ({
  role: 'initiator',
  userId: 1, // Default mock user ID
  setRole: (role) => set({ role }),
  setUserId: (userId) => set({ userId }),
}));
