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
  Sparkles,
  Package,
  FileText,
  Cloud,
  CheckSquare,
  Activity,
  Zap,
  Shield,
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
import InventoryDashboard from '@/components/InventoryDashboard';
import SalesPurchaseTable from '@/components/SalesPurchaseTable';
import AuthPage from '@/components/AuthPage';
import AwsCostDashboard from '@/components/AwsCostDashboard';
import ApiMonitoringDashboard from '@/components/ApiMonitoringDashboard';
import TasksPage from '@/pages/tasks/TasksPage';

interface NavItem {
  section: NavSection;
  label: string;
  Icon: LucideIcon;
  badge?: string;
}

const CEO_ITEMS: NavItem[] = [
  { section: 'dashboard',  label: 'Command Center',    Icon: LayoutDashboard, badge: 'LIVE' },
  { section: 'agents',     label: 'AI Agents',         Icon: Bot              },
  { section: 'ingest',     label: 'Data Ingest',       Icon: Upload           },
  { section: 'inventory',  label: 'Inventory',         Icon: Package          },
  { section: 'analytics',  label: 'Analytics',         Icon: BarChart3        },
  { section: 'registers',  label: 'Sales & Purchase',  Icon: FileText         },
  { section: 'meta',       label: 'Meta Marketing',    Icon: Megaphone        },
  { section: 'tasks',      label: 'Tasks',             Icon: CheckSquare      },
];

const CTO_ITEMS: NavItem[] = [
  { section: 'monitoring', label: 'API Monitoring',    Icon: Activity         },
  { section: 'cloud',      label: 'Cloud Costs',       Icon: Cloud            },
  { section: 'web',        label: 'Web Traffic',       Icon: Globe            },
];

// ─── Notification Toasts ─────────────────────────────────────────────────────
function NotificationToasts() {
  const { notifications, dismiss } = useNotificationStore();
  if (notifications.length === 0) return null;

  const colorMap = {
    success: 'border-emerald-400/30 bg-emerald-950/80 shadow-emerald-900/40',
    error:   'border-red-400/30 bg-red-950/80 shadow-red-900/40',
    warning: 'border-amber-400/30 bg-amber-950/80 shadow-amber-900/40',
    info:    'border-cyan-400/30 bg-cyan-950/80 shadow-cyan-900/40',
  };
  const dotMap = {
    success: 'bg-emerald-400',
    error:   'bg-red-400',
    warning: 'bg-amber-400',
    info:    'bg-cyan-400',
  };

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`
            pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border
            backdrop-blur-2xl shadow-2xl animate-slide-up
            ${colorMap[n.type]}
          `}
        >
          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotMap[n.type]}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-100 truncate">{n.title}</p>
            <p className="text-xs text-slate-300 mt-0.5 line-clamp-2">{n.message}</p>
          </div>
          <button onClick={() => dismiss(n.id)} className="shrink-0 text-slate-500 hover:text-slate-200 transition-colors p-0.5" aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({ session }: { session: Session | null }) {
  const { activeSection, setSection, sidebarOpen, toggleSidebar } = useNavStore();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-md z-20 lg:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          app-sidebar fixed top-0 left-0 h-full z-30 flex flex-col
          transition-all duration-300 ease-in-out
          ${sidebarOpen ? 'w-sidebar' : 'w-sidebar-sm'}
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo Header */}
        <div className="flex items-center gap-3 px-4 h-[64px] border-b shrink-0" style={{ borderColor: 'rgba(0,185,142,0.12)' }}>
          <div className="sidebar-logo-ring">
            <Sparkles size={16} style={{ color: '#00B98E', position: 'relative', zIndex: 1 }} />
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <p className="text-sm font-extrabold tracking-tight" style={{ color: '#e2fdf6', letterSpacing: '-0.01em' }}>
                SGS AgentVerse
              </p>
              <p className="text-2xs font-mono" style={{ color: 'rgba(0,185,142,0.55)' }}>{timeStr}</p>
            </div>
          )}
          {sidebarOpen && (
            <button onClick={toggleSidebar} className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-slate-200 lg:hidden transition-colors">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Status bar */}
        {sidebarOpen && (
          <div className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,185,142,0.08)', background: 'rgba(0,185,142,0.03)' }}>
            <div className="flex items-center justify-between">
              <span className="live-badge">System Live</span>
              <div className="flex items-center gap-1.5">
                <Zap size={10} style={{ color: '#00B98E' }} />
                <span className="text-2xs font-mono" style={{ color: 'rgba(0,185,142,0.60)' }}>v2.0</span>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 overflow-y-auto scrollbar-hide space-y-0.5">
          <div className={`nav-section-label ${!sidebarOpen ? 'text-center' : ''}`}>
            {sidebarOpen ? 'CEO Suite' : '—'}
          </div>
          {CEO_ITEMS.map(({ section, label, Icon, badge }) => {
            const isActive = activeSection === section;
            return (
              <button
                key={section}
                onClick={() => { setSection(section); if (window.innerWidth < 1024) toggleSidebar(); }}
                className={`nav-item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                title={!sidebarOpen ? label : undefined}
              >
                <Icon size={17} className={`nav-icon shrink-0 transition-colors ${isActive ? '' : 'text-slate-500'}`} />
                {sidebarOpen && (
                  <>
                    <span className="text-sm font-medium truncate flex-1 text-left">{label}</span>
                    {badge && (
                      <span className="text-2xs font-black px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,185,142,0.18)', color: '#00B98E', letterSpacing: '0.05em' }}>
                        {badge}
                      </span>
                    )}
                    {isActive && <ChevronRight size={13} style={{ color: '#00B98E', flexShrink: 0 }} />}
                  </>
                )}
                <div className="nav-indicator" />
                {!sidebarOpen && (
                  <span className="absolute left-full ml-3 px-3 py-1.5 text-xs font-semibold rounded-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50"
                    style={{ background: 'rgba(4,14,28,0.96)', border: '1px solid rgba(0,185,142,0.25)', color: '#e2fdf6', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                    {label}
                  </span>
                )}
              </button>
            );
          })}

          <div className={`nav-section-label mt-4 ${!sidebarOpen ? 'text-center' : ''}`}>
            {sidebarOpen ? 'CTO Suite' : '—'}
          </div>
          {CTO_ITEMS.map(({ section, label, Icon }) => {
            const isActive = activeSection === section;
            return (
              <button
                key={section}
                onClick={() => { setSection(section); if (window.innerWidth < 1024) toggleSidebar(); }}
                className={`nav-item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                title={!sidebarOpen ? label : undefined}
              >
                <Icon size={17} className={`nav-icon shrink-0 transition-colors ${isActive ? '' : 'text-slate-500'}`} />
                {sidebarOpen && (
                  <>
                    <span className="text-sm font-medium truncate flex-1 text-left">{label}</span>
                    {isActive && <ChevronRight size={13} style={{ color: '#00B98E', flexShrink: 0 }} />}
                  </>
                )}
                <div className="nav-indicator" />
                {!sidebarOpen && (
                  <span className="absolute left-full ml-3 px-3 py-1.5 text-xs font-semibold rounded-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50"
                    style={{ background: 'rgba(4,14,28,0.96)', border: '1px solid rgba(0,185,142,0.25)', color: '#e2fdf6', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                    {label}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer User */}
        <div className="px-2 pb-4 border-t pt-3 shrink-0" style={{ borderColor: 'rgba(0,185,142,0.10)' }}>
          {sidebarOpen ? (
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(0,185,142,0.05)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-black text-slate-950"
                style={{ background: 'linear-gradient(135deg, #00B98E, #00E5FF)' }}>
                {getInitials(session?.user?.email)}
              </div>
              <div className="overflow-hidden flex-1">
                <p className="text-xs font-bold text-slate-200 truncate">{getDisplayName(session?.user)}</p>
                <p className="text-2xs text-slate-500 truncate">{session?.user?.email ?? ''}</p>
              </div>
              <Shield size={12} style={{ color: 'rgba(0,185,142,0.50)', flexShrink: 0 }} />
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-slate-950"
                style={{ background: 'linear-gradient(135deg, #00B98E, #00E5FF)' }}>
                {getInitials(session?.user?.email)}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/** Derive initials from the user's email (first letter of name before @ and last letter of domain) */
function getInitials(email?: string | null): string {
  if (!email) return '??';
  const name = email.split('@')[0];
  if (!name) return '??';
  // Use first letter and last letter of the name part
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Derive a display name from the user's session metadata or email */
function getDisplayName(user: import('@supabase/supabase-js').User | undefined): string {
  if (!user) return 'User';
  // Try full_name from user_metadata first
  const fullName = user.user_metadata?.full_name;
  if (fullName && typeof fullName === 'string') return fullName;
  // Try name
  const name = user.user_metadata?.name;
  if (name && typeof name === 'string') return name;
  // Fall back to email prefix
  const emailName = user.email?.split('@')[0];
  if (emailName) {
    // Convert snake_case/dot_case to Title Case
    return emailName
      .split(/[._-]/)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
  }
  return 'User';
}

// ─── Header ──────────────────────────────────────────────────────────────────
function Header() {
  const { activeSection, sidebarOpen, toggleSidebar } = useNavStore();
  const { notifications } = useNotificationStore();
  const unread = notifications.length;

  const allItems = [...CEO_ITEMS, ...CTO_ITEMS];
  const activeItem = allItems.find((n) => n.section === activeSection);
  const sectionLabel = activeItem?.label ?? '';

  return (
    <header
      className={`
        app-header fixed top-0 right-0 z-10
        flex items-center gap-4 px-4 md:px-6
        transition-all duration-300
        ${sidebarOpen ? 'left-sidebar' : 'left-sidebar-sm'}
        max-lg:left-0
      `}
    >
      <button
        onClick={toggleSidebar}
        className="p-2 rounded-xl transition-all duration-200"
        style={{ color: 'rgba(0,185,142,0.70)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,185,142,0.10)'; (e.currentTarget as HTMLButtonElement).style.color = '#00B98E'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(0,185,142,0.70)'; }}
        aria-label="Toggle sidebar"
      >
        <Menu size={18} />
      </button>

      <div className="flex items-center gap-2 flex-1">
        <span className="text-2xs font-mono text-slate-600">SGS</span>
        <ChevronRight size={10} className="text-slate-700" />
        <h1 className="text-sm font-bold text-slate-200">{sectionLabel}</h1>
      </div>

      <div className="flex items-center gap-2">
        <OnlineStatus />
        <div className="hidden sm:block w-px h-5 bg-white/8" />
        <button
          className="relative p-2 rounded-xl text-slate-500 hover:text-slate-200 transition-colors"
          aria-label={`${unread} notifications`}
        >
          <Bell size={17} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 rounded-full text-2xs text-slate-950 flex items-center justify-center font-black"
              style={{ background: 'linear-gradient(135deg, #00B98E, #00E5FF)' }}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
        <button
          onClick={() => supabase.auth.signOut()}
          className="p-2 rounded-xl text-slate-500 hover:text-red-400 transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}

function OnlineStatus() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online',  on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  return online ? (
    <div className="hidden sm:flex items-center gap-1.5 header-pill">
      <Wifi size={10} /><span>Online</span>
    </div>
  ) : (
    <div className="hidden sm:flex items-center gap-1.5 header-pill" style={{ borderColor: 'rgba(245,158,11,0.30)', background: 'rgba(245,158,11,0.08)', color: 'rgba(245,158,11,0.90)' }}>
      <WifiOff size={10} /><span>Offline</span>
    </div>
  );
}

// ─── PWA Banner ───────────────────────────────────────────────────────────────
function PWAUpdateBanner() {
  const push = useNotificationStore((s) => s.push);
  useEffect(() => {
    const handleUpdate  = () => push({ type: 'info',    title: 'Update available',   message: 'A new version is ready. Refresh to update.' });
    const handleOffline = () => push({ type: 'success', title: 'Ready for offline', message: 'App is fully cached and works without internet.' });
    window.addEventListener('pwa:update-available', handleUpdate);
    window.addEventListener('pwa:offline-ready',    handleOffline);
    return () => { window.removeEventListener('pwa:update-available', handleUpdate); window.removeEventListener('pwa:offline-ready', handleOffline); };
  }, [push]);
  return null;
}

// ─── Main Content ─────────────────────────────────────────────────────────────
function MainContent({ session }: { session: Session | null }) {
  const { activeSection, sidebarOpen, toggleSidebar } = useNavStore();

  const content = (() => {
    switch (activeSection) {
      case 'dashboard':  return <Dashboard />;
      case 'agents':     return <AgentPanel session={session} />;
      case 'ingest':     return <DataIngestion />;
      case 'inventory':  return <InventoryDashboard />;
      case 'analytics':  return <Analytics />;
      case 'registers':  return <SalesPurchaseTable />;
      case 'web':        return <WebTrafficDashboard />;
      case 'meta':       return <MetaMarketingDashboard />;
      case 'cloud':      return <AwsCostDashboard />;
      case 'monitoring': return <ApiMonitoringDashboard />;
      case 'tasks':      return <TasksPage />;
      default:           return <Dashboard />;
    }
  })();

  return (
    <main
      className={`
        app-main agentverse-shell
        transition-all duration-300
        ${sidebarOpen ? 'lg:pl-sidebar' : 'lg:pl-sidebar-sm'}
      `}
    >
      <div className="p-4 md:p-6 animate-fade-in">
        <div className="mx-auto w-full">{content}</div>
      </div>
      <button
        onClick={toggleSidebar}
        className="mobile-orbit-menu fixed z-40 lg:hidden rounded-2xl shadow-2xl flex items-center justify-center border border-white/10"
        style={{ width: '52px', height: '52px' }}
        aria-label="Open navigation"
      >
        <Menu size={20} className="text-slate-950" />
      </button>
    </main>
  );
}

// ─── Ambient Orbs ────────────────────────────────────────────────────────────
function AmbientOrbs() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      <div className="absolute rounded-full animate-orb"
        style={{ width: '600px', height: '600px', top: '-150px', left: '-100px', background: 'radial-gradient(ellipse, rgba(0,185,142,0.18) 0%, transparent 70%)', filter: 'blur(1px)' }} />
      <div className="absolute rounded-full animate-orb"
        style={{ width: '500px', height: '500px', top: '30%', right: '-120px', background: 'radial-gradient(ellipse, rgba(0,229,255,0.10) 0%, transparent 70%)', filter: 'blur(1px)', animationDelay: '4s' }} />
      <div className="absolute rounded-full animate-orb"
        style={{ width: '550px', height: '550px', bottom: '-100px', left: '35%', background: 'radial-gradient(ellipse, rgba(124,58,237,0.10) 0%, transparent 70%)', filter: 'blur(1px)', animationDelay: '8s' }} />
    </div>
  );
}

// ─── Floating Particles ───────────────────────────────────────────────────────
function FloatingParticles() {
  const particles = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    left: `${(i * 5.5 + 3) % 100}%`,
    top:  `${(i * 7.3 + 5) % 100}%`,
    delay: `${(i * 0.7) % 6}s`,
    duration: `${18 + (i % 5) * 3}s`,
    color: i % 3 === 0 ? 'rgba(0,185,142,0.55)' : i % 3 === 1 ? 'rgba(0,229,255,0.45)' : 'rgba(167,139,250,0.40)',
    size: i % 2 === 0 ? '4px' : '2px',
  }));

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      {particles.map((p) => (
        <div key={p.id} className="absolute rounded-full animate-float"
          style={{ left: p.left, top: p.top, width: p.size, height: p.size, background: p.color, animationDelay: p.delay, animationDuration: p.duration, boxShadow: `0 0 6px ${p.color}` }} />
      ))}
    </div>
  );
}

// ─── Loading Screen ───────────────────────────────────────────────────────────
function LoadingScreen() {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 450);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="agentverse-shell min-h-screen flex items-center justify-center relative overflow-hidden">
      <AmbientOrbs />
      <FloatingParticles />
      <div className="relative z-10 text-center space-y-6">
        <div className="relative mx-auto w-20 h-20">
          <div className="absolute inset-0 rounded-full border-2 border-transparent animate-spin-slow"
            style={{ borderTopColor: '#00B98E', borderRightColor: 'rgba(0,185,142,0.20)' }} />
          <div className="absolute inset-3 rounded-full border border-transparent"
            style={{ borderBottomColor: '#00E5FF', animation: 'spin 2s linear infinite reverse' }} />
          <div className="absolute inset-6 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,185,142,0.15)', border: '1px solid rgba(0,185,142,0.40)' }}>
            <Sparkles size={14} style={{ color: '#00B98E' }} />
          </div>
        </div>
        <div>
          <p className="text-lg font-black tracking-tight gradient-text-green mb-1">SGS AgentVerse</p>
          <p className="text-sm text-slate-500 font-mono">Initialising secure workspace{dots}</p>
        </div>
        <div className="w-48 mx-auto h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,185,142,0.12)' }}>
          <div className="h-full rounded-full animate-fill-bar" style={{ background: 'linear-gradient(90deg, #00B98E, #00E5FF)' }} />
        </div>
      </div>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────
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

  if (!authReady) return <LoadingScreen />;
  if (!session)   return <AuthPage />;

  return (
    <div className="relative min-h-screen text-slate-100 overflow-hidden" style={{ background: '#020617' }}>
      <AmbientOrbs />
      <FloatingParticles />
      <PWAUpdateBanner />
      <Sidebar session={session} />
      <Header />
      <MainContent session={session} />
      <NotificationToasts />
    </div>
  );
}