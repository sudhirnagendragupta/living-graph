import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeskly } from '../store/desklyStore';
import { Lock, Mail, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login, addToast } = useDeskly();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your work email.');
      addToast({ type: 'warning', title: 'Validation Error', message: 'Work email is required.' });
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      addToast({ type: 'error', title: 'Invalid Password', message: 'Password is too short.' });
      return;
    }

    setIsLoading(true);
    await login(email);
    setIsLoading(false);
    navigate('/dashboard');
  };

  const handleFillDemo = () => {
    setEmail('sudhir@deskly.dev');
    setPassword('deskly2026');
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 selection:bg-indigo-500 selection:text-white">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 shadow-lg shadow-indigo-600/30 text-white font-bold text-xl mb-1">
            D
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Welcome to Deskly</h1>
          <p className="text-xs text-zinc-400">
            Sign in to access your organization's support desk
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div
            data-testid="login-error-alert"
            className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Work Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
              <input
                type="email"
                data-testid="login-email-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-300">Password</label>
              <a href="#forgot" className="text-[11px] text-indigo-400 hover:underline">
                Forgot password?
              </a>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
              <input
                type="password"
                data-testid="login-password-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-400 select-none">
              <input
                type="checkbox"
                data-testid="login-remember-checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded bg-zinc-950 border-zinc-700 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-zinc-900"
              />
              <span>Remember me</span>
            </label>
          </div>

          <button
            type="submit"
            data-testid="login-submit-btn"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all active:scale-98 disabled:opacity-50"
          >
            {isLoading ? (
              <span>Authenticating...</span>
            ) : (
              <>
                <span>Sign In to Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </form>

        {/* Demo Helper Button */}
        <div className="pt-2 border-t border-zinc-800 text-center">
          <button
            type="button"
            onClick={handleFillDemo}
            data-testid="fill-demo-credentials-btn"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-indigo-300 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span>Autofill Demo Credentials</span>
          </button>
        </div>
      </div>
    </div>
  );
};
