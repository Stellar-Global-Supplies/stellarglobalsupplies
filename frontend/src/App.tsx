import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Bot,
  Upload,
  BarChart3,
  Menu,
  X,
  Bell,
  Globe,
  Megaphone,
  Wifi,
  WifiOff,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import type { LucideIcon } from 'lucide-react';
import { useNavStore, useNotificationStore } from '@/store';
import type { NavSection } from '@/types';
import { supabase } from '@/lib/supabase';
import Dashboard from '@/components/Dashboard';
import WebTrafficDashboard from '@/components/WebTrafficDashboard';
import MetaMarketingDashboard from '@/components/MetaMarketingDashboard';
import AgentPanel from '@/components/AgentPanel';
import DataIngestion from '@/components/DataIngestion';
import Analytics from '@/components/Analytics';
import AuthPage from '@/components/AuthPage';

// ────────────────────────────────────────────────────────────────────────────
// Nav item config
// ────────────────────────────────────────────────────────────────────────────
const NAV_ITEMS: { section: NavSection; label: string; Icon: LucideIcon }[] = [
  { section: 'dashboard', label: 'Dashboard',     Icon: LayoutDashboard },
  { section: 'agents',    label: 'AI Agents',     Icon: Bot              },
  { section: 'ingest',    label: 'Data Ingest',   Icon: Upload           },
  { section: 'analytics', label: 'Analytics',     Icon: BarChart3        },
  { section: 'web',       label: 'Web Traffic',   Icon: Globe            },
  { section: 'meta',      label: 'Meta Marketing', Icon: Megaphone        },
];

// ────────────────────────────────────────────────────────────────────────────
// Toast notification overlay
// ────────────────────────────────────────────────────────────────────────────
function NotificationToasts() {
  const { notifications, dismiss } = useNotificationStore();

  if (notifications.length === 0) return null;

  const colorMap = {
    success: 'border-emerald-500/50 bg-emerald-950/80',
    error:   'border-red-500/50 bg-red-950/80',
    warning: 'border-amber-500/50 bg-amber-950/80',
    info:    'border-indigo-500/50 bg-indigo-950/80',
  };

  const iconMap = {
    success: '✓',
    error:   '✕',
    warning: '⚠',
    info:    'ℹ',
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`
            pointer-events-auto flex items-start gap-3 p-4 rounded-xl border
            backdrop-blur-md shadow-2xl animate-slide-up
            ${colorMap[n.type]}
          `}
        >
          <span className="text-base font-bold mt-0.5 shrink-0">{iconMap[n.type]}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-100 truncate">{n.title}</p>
            <p className="text-xs text-slate-300 mt-0.5 line-clamp-2">{n.message}</p>
          </div>
          <button
            onClick={() => dismiss(n.id)}
            className="shrink-0 text-slate-400 hover:text-slate-200 transition-colors"
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sidebar
// ────────────────────────────────────────────────────────────────────────────
function Sidebar() {
  const { activeSection, setSection, sidebarOpen, toggleSidebar } = useNavStore();

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 lg:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 h-full z-30 flex flex-col
          bg-slate-900 border-r border-slate-800
          transition-all duration-300 ease-in-out
          ${sidebarOpen ? 'w-sidebar' : 'w-sidebar-sm'}
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo header */}
        <div className="flex items-center gap-3 px-4 h-header border-b border-slate-800 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 shadow-glow-indigo">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-slate-100 truncate">SGS Ops Center</p>
              <p className="text-2xs text-slate-500 truncate">Stellar Global Supplies</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto scrollbar-hide">
          {NAV_ITEMS.map(({ section, label, Icon }) => {
            const isActive = activeSection === section;
            return (
              <button
                key={section}
                onClick={() => {
                  setSection(section);
                  if (window.innerWidth < 1024) toggleSidebar();
                }}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                  transition-all duration-150 group relative
                  ${isActive
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }
                `}
                aria-current={isActive ? 'page' : undefined}
                title={!sidebarOpen ? label : undefined}
              >
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-indigo-400' : ''}`} />
                {sidebarOpen && (
                  <span className="text-sm font-medium truncate">{label}</span>
                )}
                {sidebarOpen && isActive && (
                  <ChevronRight size={14} className="ml-auto text-indigo-400" />
                )}
                {/* Tooltip for collapsed state */}
                {!sidebarOpen && (
                  <span className="
                    absolute left-full ml-2 px-2 py-1 text-xs bg-slate-700 text-slate-200
                    rounded-md whitespace-nowrap opacity-0 pointer-events-none
                    group-hover:opacity-100 transition-opacity z-50
                  ">
                    {label}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-2 pb-4 border-t border-slate-800 pt-3 shrink-0">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-slate-300">MG</span>
            </div>
            {sidebarOpen && (
              <div className="overflow-hidden">
                <p className="text-xs font-medium text-slate-300 truncate">Manager</p>
                <p className="text-2xs text-slate-500 truncate">Operations</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Top Header
// ────────────────────────────────────────────────────────────────────────────
function Header() {
  const { activeSection, sidebarOpen, toggleSidebar } = useNavStore();
  const { notifications } = useNotificationStore();
  const unread = notifications.length;

  const sectionLabel = NAV_ITEMS.find((n) => n.section === activeSection)?.label ?? '';

  return (
    <header
      className={`
        fixed top-0 right-0 z-10 h-header
        bg-slate-950/80 backdrop-blur-md border-b border-slate-800
        flex items-center gap-4 px-4 md:px-6
        transition-all duration-300
        ${sidebarOpen ? 'left-sidebar' : 'left-sidebar-sm'}
        max-lg:left-0
      `}
    >
      <button
        onClick={toggleSidebar}
        className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        aria-label="Toggle sidebar"
      >
        <Menu size={18} />
      </button>

      <div className="flex-1">
        <h1 className="text-sm font-semibold text-slate-200">{sectionLabel}</h1>
      </div>

      {/* Online / offline indicator */}
      <OnlineStatus />

      {/* Notifications bell */}
      <button
        className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        aria-label={`${unread} notifications`}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-indigo-500 rounded-full text-2xs text-white flex items-center justify-center font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <button
        onClick={() => supabase.auth.signOut()}
        className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut size={18} />
      </button>
    </header>
  );
}

function OnlineStatus() {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  return online ? (
    <div className="hidden sm:flex items-center gap-1.5 text-2xs text-emerald-400">
      <Wifi size={13} />
      <span>Online</span>
    </div>
  ) : (
    <div className="hidden sm:flex items-center gap-1.5 text-2xs text-amber-400">
      <WifiOff size={13} />
      <span>Offline</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PWA Update Banner
// ────────────────────────────────────────────────────────────────────────────
function PWAUpdateBanner() {
  const push = useNotificationStore((s) => s.push);

  useEffect(() => {
    const handleUpdateAvailable = () => {
      push({
        type: 'info',
        title: 'Update available',
        message: 'A new version is ready. Refresh to update.',
      });
    };
    const handleOfflineReady = () => {
      push({
        type: 'success',
        title: 'Ready for offline',
        message: 'App is fully cached and works without internet.',
      });
    };

    window.addEventListener('pwa:update-available', handleUpdateAvailable);
    window.addEventListener('pwa:offline-ready', handleOfflineReady);
    return () => {
      window.removeEventListener('pwa:update-available', handleUpdateAvailable);
      window.removeEventListener('pwa:offline-ready', handleOfflineReady);
    };
  }, [push]);

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Main content router
// ────────────────────────────────────────────────────────────────────────────
function MainContent() {
  const { activeSection, sidebarOpen } = useNavStore();

  const content = (() => {
    switch (activeSection) {
      case 'dashboard': return <Dashboard />;
      case 'agents':    return <AgentPanel />;
      case 'ingest':    return <DataIngestion />;
      case 'analytics': return <Analytics />;
      case 'web':       return <WebTrafficDashboard />;
      case 'meta':      return <MetaMarketingDashboard />;
      default:          return <Dashboard />;
    }
  })();

  return (
    <main
      className={`
        min-h-screen pt-header bg-slate-950
        transition-all duration-300
        ${sidebarOpen ? 'lg:pl-sidebar' : 'lg:pl-sidebar-sm'}
      `}
    >
      <div className="p-4 md:p-6 animate-fade-in">
        {content}
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// App root
// ────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-sm text-slate-400">
        Loading secure workspace...
      </div>
    );
  }

  if (!session) {
    return <AuthPage />;
  }

  return (
    <div className="relative min-h-screen bg-slate-950">
      {/* Subtle background grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-30"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='32' height='32' viewBox='0 0 32 32' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 .5H32M.5 0V32' stroke='%23334155' stroke-opacity='0.4'/%3E%3C/svg%3E\")" }}
        aria-hidden="true"
      />

      <PWAUpdateBanner />
      <Sidebar />
      <Header />
      <MainContent />
      <NotificationToasts />
    </div>
  );
}
