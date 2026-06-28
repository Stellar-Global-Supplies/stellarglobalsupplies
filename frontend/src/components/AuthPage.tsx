import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  LockKeyhole, Mail, Loader2, ArrowRight, Sparkles,
  ShieldCheck, Bot, Zap, Globe, BarChart3, Package,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

const FEATURES = [
  { Icon: Bot,      label: 'AI Agents',       desc: 'Multi-role intelligence agents' },
  { Icon: BarChart3,label: 'Live Analytics',   desc: 'Real-time business intelligence' },
  { Icon: Package,  label: 'Inventory OS',     desc: 'Full supply chain visibility'   },
  { Icon: Globe,    label: 'Meta Intelligence',desc: 'Social & web traffic insights'  },
];

export default function AuthPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (result.error) setError(result.error.message);
  };

  return (
    <main
      className="agentverse-shell min-h-screen text-slate-100 grid lg:grid-cols-[1.1fr_0.9fr] overflow-hidden"
      style={{ position: 'relative' }}
    >
      {/* ── Ambient orbs ─────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        <div className="absolute rounded-full"
          style={{
            width: '700px', height: '700px', top: '-200px', left: '-150px',
            background: 'radial-gradient(ellipse, rgba(0,185,142,0.22) 0%, transparent 70%)',
            animation: 'orb 16s ease-in-out infinite',
          }} />
        <div className="absolute rounded-full"
          style={{
            width: '500px', height: '500px', bottom: '-100px', right: '-100px',
            background: 'radial-gradient(ellipse, rgba(0,229,255,0.14) 0%, transparent 70%)',
            animation: 'orb 12s ease-in-out infinite reverse',
            animationDelay: '3s',
          }} />
        <div className="absolute rounded-full"
          style={{
            width: '400px', height: '400px', top: '40%', left: '40%',
            background: 'radial-gradient(ellipse, rgba(124,58,237,0.10) 0%, transparent 70%)',
            animation: 'orb 20s ease-in-out infinite',
            animationDelay: '6s',
          }} />
      </div>

      {/* Floating particles */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        {Array.from({ length: 22 }, (_, i) => (
          <div key={i} className="absolute rounded-full animate-float"
            style={{
              left: `${(i * 4.6 + 2) % 100}%`,
              top: `${(i * 6.8 + 5) % 100}%`,
              width: i % 2 === 0 ? '4px' : '2px',
              height: i % 2 === 0 ? '4px' : '2px',
              background: i % 3 === 0 ? 'rgba(0,185,142,0.60)' : i % 3 === 1 ? 'rgba(0,229,255,0.50)' : 'rgba(167,139,250,0.45)',
              boxShadow: '0 0 6px currentColor',
              animationDelay: `${(i * 0.55) % 7}s`,
              animationDuration: `${16 + (i % 6) * 2}s`,
            }} />
        ))}
      </div>

      {/* ══════════════════════════════
          LEFT — Hero panel
      ══════════════════════════════ */}
      <section className="hidden lg:flex relative z-10 flex-col justify-between p-12 border-r" style={{ borderColor: 'rgba(0,185,142,0.10)' }}>
        {/* Top logo */}
        <div className="flex items-center gap-4">
          <div className="sidebar-logo-ring" style={{ width: '48px', height: '48px', borderRadius: '14px' }}>
            <Sparkles size={20} style={{ color: '#00B98E', position: 'relative', zIndex: 1 }} />
          </div>
          <div>
            <p className="text-lg font-black tracking-tight" style={{ color: '#e2fdf6' }}>SGS AgentVerse</p>
            <p className="text-xs" style={{ color: 'rgba(0,185,142,0.55)' }}>Operations Intelligence OS · v2.0</p>
          </div>
        </div>

        {/* Hero text */}
        <div className="max-w-lg space-y-6">
          <div className="agent-chip w-fit">
            <Bot size={12} />
            Live AI Workspace · Stellar Global Supplies
          </div>
          <h1 className="text-5xl font-black leading-[1.08] tracking-tight" style={{ letterSpacing: '-0.025em' }}>
            Command your{' '}
            <span className="gradient-text">supply, sales</span>
            {' '}and marketing agents.
          </h1>
          <p className="text-base leading-relaxed" style={{ color: 'rgba(148,163,184,0.90)' }}>
            One secure cockpit for AI-powered insights, inventory control, Supabase analytics,
            and Meta performance intelligence. Built for Stellar's operations team in Pune.
          </p>

          {/* Feature grid */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            {FEATURES.map(({ Icon, label, desc }) => (
              <div key={label} className="agent-card p-4 group hover:border-emerald-400/25 transition-all">
                <div className="w-8 h-8 rounded-lg mb-3 flex items-center justify-center"
                  style={{ background: 'rgba(0,185,142,0.12)', border: '1px solid rgba(0,185,142,0.25)' }}>
                  <Icon size={15} style={{ color: '#00B98E' }} />
                </div>
                <p className="text-xs font-bold text-slate-200">{label}</p>
                <p className="text-2xs mt-0.5" style={{ color: 'rgba(148,163,184,0.60)' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom stats */}
        <div className="flex items-center gap-8">
          {[['500+', 'Products tracked'], ['Real-time', 'Analytics'], ['AI-powered', 'Agent suite']].map(([val, lbl]) => (
            <div key={lbl}>
              <p className="text-xl font-black gradient-text-green">{val}</p>
              <p className="text-2xs mt-0.5" style={{ color: 'rgba(148,163,184,0.55)' }}>{lbl}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════
          RIGHT — Login form
      ══════════════════════════════ */}
      <section className="flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-md space-y-8">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3">
            <div className="sidebar-logo-ring">
              <Sparkles size={16} style={{ color: '#00B98E', position: 'relative', zIndex: 1 }} />
            </div>
            <div>
              <p className="text-base font-black" style={{ color: '#e2fdf6' }}>SGS AgentVerse</p>
              <p className="text-xs" style={{ color: 'rgba(0,185,142,0.55)' }}>Operations Intelligence OS</p>
            </div>
          </div>

          {/* Auth card */}
          <div className="auth-panel p-7 sm:p-8">
            {/* Header */}
            <div className="mb-7 space-y-3">
              <div className="flex items-center gap-2">
                <span className="agent-chip"><ShieldCheck size={11} />Supabase Auth</span>
                <span className="live-badge">Secure</span>
              </div>
              <h2 className="text-2xl font-black tracking-tight" style={{ color: '#f0f9ff', letterSpacing: '-0.02em' }}>
                Sign in to workspace
              </h2>
              <p className="text-sm" style={{ color: 'rgba(148,163,184,0.80)' }}>
                Access your Stellar Global Supplies operations dashboard.
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold tracking-wide" style={{ color: 'rgba(148,163,184,0.80)', letterSpacing: '0.04em' }}>
                  EMAIL ADDRESS
                </label>
                <div className="agent-input gap-2.5" style={{ display: 'flex', alignItems: 'center' }}>
                  <Mail size={15} style={{ color: 'rgba(0,185,142,0.50)', flexShrink: 0 }} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-transparent outline-none text-sm text-slate-100 placeholder:text-slate-600"
                    placeholder="manager@stellarglobalsupplies.com"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold tracking-wide" style={{ color: 'rgba(148,163,184,0.80)', letterSpacing: '0.04em' }}>
                  PASSWORD
                </label>
                <div className="agent-input gap-2.5" style={{ display: 'flex', alignItems: 'center' }}>
                  <LockKeyhole size={15} style={{ color: 'rgba(0,185,142,0.50)', flexShrink: 0 }} />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full bg-transparent outline-none text-sm text-slate-100 placeholder:text-slate-600"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl p-3 text-xs"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
                  <span className="shrink-0 mt-0.5 font-bold">!</span>
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="agent-button w-full h-12 mt-2 text-base"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <ArrowRight size={18} />
                )}
                {loading ? 'Authenticating…' : 'Enter AgentVerse'}
              </button>
            </form>

            {/* Footer note */}
            <div className="mt-6 pt-5 border-t flex items-center gap-2" style={{ borderColor: 'rgba(0,185,142,0.10)' }}>
              <Zap size={11} style={{ color: 'rgba(0,185,142,0.40)', flexShrink: 0 }} />
              <p className="text-2xs" style={{ color: 'rgba(100,116,139,0.70)' }}>
                Secure workspace for approved Stellar Global Supplies team members only.
              </p>
            </div>
          </div>

          {/* Tagline */}
          <p className="text-center text-2xs" style={{ color: 'rgba(100,116,139,0.50)' }}>
            Stellar Global Supplies · Pune, India · Est. 2025
          </p>
        </div>
      </section>

      {/* CSS for orb animation injected in index.css — just in case */}
      <style>{`
        @keyframes orb {
          0%,100% { transform: scale(1) translate(0,0); }
          33% { transform: scale(1.08) translate(30px,-20px); }
          66% { transform: scale(0.95) translate(-20px,20px); }
        }
      `}</style>
    </main>
  );
}
