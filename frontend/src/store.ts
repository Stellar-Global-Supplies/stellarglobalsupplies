import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { AppNotification, NavSection } from '@/types';

// ────────────────────────────────────────────────────────────────────────────
// Notification store
// ────────────────────────────────────────────────────────────────────────────
interface NotificationState {
  notifications: AppNotification[];
  push: (n: Omit<AppNotification, 'id' | 'ts'>) => void;
  dismiss: (id: string) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],

  push(n) {
    const notification: AppNotification = { ...n, id: uuidv4(), ts: Date.now() };
    set((s) => ({ notifications: [notification, ...s.notifications].slice(0, 8) }));
    // Auto-dismiss non-error notifications after 5 s
    if (n.type !== 'error') {
      setTimeout(() => {
        set((s) => ({
          notifications: s.notifications.filter((x) => x.id !== notification.id),
        }));
      }, 5000);
    }
  },

  dismiss(id) {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },
}));

// ────────────────────────────────────────────────────────────────────────────
// Navigation store
// ────────────────────────────────────────────────────────────────────────────
interface NavState {
  activeSection: NavSection;
  setSection: (s: NavSection) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  activeSection: 'dashboard',
  setSection: (activeSection) => set({ activeSection }),
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));

// ────────────────────────────────────────────────────────────────────────────
// Theme store — dark/light mode
// ────────────────────────────────────────────────────────────────────────────
type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: (localStorage.getItem('theme') as Theme) || 'dark',
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
    // Apply theme to document
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  },
  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(newTheme);
  },
}));