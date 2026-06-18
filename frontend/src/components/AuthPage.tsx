import { useState } from 'react';
import type { FormEvent } from 'react';
import { LockKeyhole, Mail, Loader2, Building2, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const result =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === 'signup' && !result.data.session) {
      setMessage('Account created. Check your email to confirm access.');
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 grid lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden lg:flex relative overflow-hidden p-10 flex-col justify-between border-r border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.20),transparent_28%),radial-gradient(circle_at_70%_35%,rgba(245,158,11,0.14),transparent_28%)]" />
        <div className="relative">
          <div className="inline-flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
              <Building2 size={22} />
            </div>
            <div>
              <p className="text-lg font-bold">Stellar Global Supplies</p>
              <p className="text-xs text-slate-400">Operations Intelligence</p>
            </div>
          </div>
        </div>

        <div className="relative max-w-xl">
          <p className="text-sm uppercase tracking-[0.22em] text-amber-300 mb-4">Secure control center</p>
          <h1 className="text-5xl font-bold leading-tight tracking-normal">
            Steel supply analytics with clean, auditable ingestion.
          </h1>
          <p className="text-base text-slate-300 mt-5 max-w-lg">
            Upload accounting exports, track sales, purchases, GST, margins, customers, suppliers, and item performance from one authenticated workspace.
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-3 text-xs">
          {['Sales register', 'Purchase register', 'Item ledgers'].map((item) => (
            <div key={item} className="border border-slate-700 bg-slate-900/70 rounded-lg p-3">
              <p className="font-semibold text-slate-200">{item}</p>
              <p className="text-slate-500 mt-1">Supabase ready</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center p-5">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
              <Building2 size={20} />
            </div>
            <div>
              <p className="text-base font-bold">Stellar Global Supplies</p>
              <p className="text-xs text-slate-500">Operations Intelligence</p>
            </div>
          </div>

          <div className="glass-card p-6 sm:p-7">
            <div className="mb-6">
              <p className="text-2xs uppercase tracking-[0.18em] text-emerald-300">Supabase Auth</p>
              <h2 className="text-2xl font-bold mt-2">
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Use your approved operations account to access the dashboard.
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-slate-300">Email</span>
                <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 focus-within:border-emerald-400">
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
                <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 focus-within:border-emerald-400">
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
              {message && <p className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded-lg p-3">{message}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-lg bg-emerald-500 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-emerald-400 transition-colors disabled:opacity-70"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <div className="mt-5 pt-5 border-t border-slate-800 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {mode === 'signin' ? 'Need an account?' : 'Already registered?'}
              </p>
              <button
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin');
                  setError(null);
                  setMessage(null);
                }}
                className="text-xs font-semibold text-amber-300 hover:text-amber-200"
              >
                {mode === 'signin' ? 'Create one' : 'Sign in instead'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
