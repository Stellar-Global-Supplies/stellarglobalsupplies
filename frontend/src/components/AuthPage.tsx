import { useState } from 'react';
import type { FormEvent } from 'react';
import { LockKeyhole, Mail, Loader2, Building2, ArrowRight, Sparkles, ShieldCheck, Bot } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (result.error) {
      setError(result.error.message);
    }
  };

  return (
    <main className="agentverse-shell min-h-screen text-slate-100 grid lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden lg:flex relative overflow-hidden p-10 flex-col justify-between border-r border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,185,142,0.20),transparent_30%),radial-gradient(circle_at_72%_34%,rgba(56,189,248,0.16),transparent_30%),radial-gradient(circle_at_42%_82%,rgba(167,139,250,0.14),transparent_26%)]" />
        <div className="relative">
          <div className="inline-flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-[rgba(0,185,142,0.15)] border border-[rgba(0,185,142,0.34)] flex items-center justify-center text-[#00B98E] shadow-[0_0_34px_rgba(0,185,142,0.22)]">
              <Sparkles size={22} />
            </div>
            <div>
              <p className="text-lg font-bold">SGS AgentVerse</p>
              <p className="text-xs text-slate-400">Operations Intelligence OS</p>
            </div>
          </div>
        </div>

        <div className="relative max-w-xl">
          <p className="agent-chip mb-5 text-[#00B98E] border-[rgba(0,185,142,0.28)] bg-[rgba(0,185,142,0.08)]">
            <Bot size={13} />
            Secure AI workspace
          </p>
          <h1 className="text-5xl font-black leading-tight tracking-normal">
            Command your supply, sales, and marketing agents from one premium cockpit.
          </h1>
          <p className="text-base text-slate-300 mt-5 max-w-lg">
            Upload accounting exports, monitor Supabase-backed analytics, brief business agents, and track Meta performance from a secure authenticated workspace.
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-3 text-xs">
          {['Supabase data', 'AI agents', 'Meta intelligence'].map((item) => (
            <div key={item} className="agent-card p-4">
              <p className="font-semibold text-slate-100">{item}</p>
              <p className="text-slate-500 mt-1">Live workspace</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center p-5">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
              <Building2 size={20} />
            </div>
            <div>
              <p className="text-base font-bold">Stellar Global Supplies</p>
              <p className="text-xs text-slate-500">Operations Intelligence</p>
            </div>
          </div>

          <div className="agent-card p-6 sm:p-7">
            <div className="mb-6">
              <p className="agent-chip w-fit text-[#00B98E] border-[rgba(0,185,142,0.28)] bg-[rgba(0,185,142,0.08)]">
                <ShieldCheck size={13} />
                Supabase Auth
              </p>
              <h2 className="text-2xl font-bold mt-2">Sign in</h2>
              <p className="text-sm text-slate-400 mt-1">
                Use your approved operations account to access the dashboard.
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-slate-300">Email</span>
                <span className="mt-1.5 flex items-center gap-2 agent-input focus-within:border-emerald-400/60">
                  <Mail size={16} className="text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    className="w-full bg-transparent outline-none text-sm text-slate-100 placeholder:text-slate-600"
                    placeholder="manager@stellarglobalsupplies.com"
                  />
                </span>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-300">Password</span>
                <span className="mt-1.5 flex items-center gap-2 agent-input focus-within:border-emerald-400/60">
                  <LockKeyhole size={16} className="text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={6}
                    className="w-full bg-transparent outline-none text-sm text-slate-100 placeholder:text-slate-600"
                    placeholder="Minimum 6 characters"
                  />
                </span>
              </label>

              {error && <p className="text-xs text-red-300 bg-red-950/50 border border-red-900 rounded-lg p-3">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="agent-button w-full h-11"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                Sign in
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}