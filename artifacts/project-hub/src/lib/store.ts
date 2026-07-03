import { create } from 'zustand';

interface UserState {
  role: string;
  userId: number;
  isSuperAdmin: boolean;
  setRole: (role: string) => void;
  setUserId: (id: number) => void;
  setIsSuperAdmin: (v: boolean) => void;
}

export const useUserStore = create<UserState>((set) => ({
  role: 'initiator',
  userId: 1, // Default mock user ID
  isSuperAdmin: false,
  setRole: (role) => set({ role }),
  setUserId: (userId) => set({ userId }),
  setIsSuperAdmin: (isSuperAdmin) => set({ isSuperAdmin }),
}));
