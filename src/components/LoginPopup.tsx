import React, { useState } from 'react';
import { motion } from 'motion/react';
import { LogIn, AlertCircle } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { EvdekimiLogo } from './EvdekimiLogo';
import { auth, googleIdentityProvider } from '../lib/firebase';
import { readJsonResponse } from '../lib/utils';
import { signInWithPopup, OAuthProvider } from 'firebase/auth';

export function LoginPopup() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [view, setView] = useState<'login' | 'link'>('login');
  
  // Link State
  const [linkInvestorCode, setLinkInvestorCode] = useState('');
  const [linkLegacyPassword, setLinkLegacyPassword] = useState('');
  const [linkOauthEmail, setLinkOauthEmail] = useState('');
  const [linkSuccess, setLinkSuccess] = useState(false);
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });
      
      const data = await readJsonResponse(res);
      
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }
      
      login(data.user);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to sign in');
    } finally {
      setIsLoggingIn(false);
    }
  };


  
  const handleLinkAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError(null);
    try {
      // 1. Verify legacy credentials with backend
      const res = await fetch('/api/auth/verify-legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          investorCode: linkInvestorCode,
          legacyPassword: linkLegacyPassword
        })
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data.error || 'Invalid credentials');

      const result = await signInWithPopup(auth, googleIdentityProvider);
      const firebaseIdToken = await result.user.getIdToken();

      const linkRes = await fetch('/api/auth/link-google-legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          investorCode: linkInvestorCode,
          legacyPassword: linkLegacyPassword,
          firebaseIdToken
        })
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok) throw new Error(linkData.error || 'Failed to link account');

      setLinkSuccess(true);

      const loginRes = await fetch('/api/auth/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ firebaseIdToken })
      });

      const loginData = await loginRes.json();
      if (!loginRes.ok) throw new Error(loginData.error || 'Login failed after linking');

      setTimeout(() => login(loginData.user), 1000);
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to link account');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleAppleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      const result = await signInWithPopup(auth, provider);
      const res = await fetch('/api/auth/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ firebaseIdToken: await result.user.getIdToken() })
      });
      
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data.error || 'Please link your account first');
      login(data.user);
    } catch (err: any) {
      if (!err.message?.includes('link your account')) {
        console.error(err);
      }
      setError(err.message || 'Apple Sign-In failed');
    } finally {
      setIsLoggingIn(false);
    }
  };
  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleIdentityProvider);
      const firebaseIdToken = await result.user.getIdToken();

      const res = await fetch('/api/auth/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ firebaseIdToken })
      });

      const data = await readJsonResponse(res);
      if (!res.ok) {
        throw new Error(data.error || 'This Google account is not linked to an EVDEKIMI account. Please log in with your EVDEKIMI credentials and connect Google from your profile first.');
      }

      login(data.user);
    } catch (err: any) {
      if (!err.message?.includes('not linked to an EVDEKIMI account') && !err.message?.includes('No account association found')) {
        console.error(err);
      }
      setError(err.message || 'Google Sign-In failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/60 backdrop-blur-sm p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass w-full max-w-md p-8 rounded-2xl shadow-2xl overflow-hidden relative text-center"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-600" />
        
        {view === 'link' ? (
          <form onSubmit={handleLinkAccount} className="flex flex-col items-center space-y-6">
            <div className="bg-white p-4 rounded-3xl shadow-lg mb-2">
              <EvdekimiLogo className="w-12 h-12" color="#031428" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white tracking-tight">Account Linking</h2>
              <p className="text-brand-muted text-sm px-4">Link your legacy account to a Google or Apple ID.</p>
            </div>

            <div className="w-full space-y-4">
              {error && (
                <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-xs font-bold uppercase tracking-widest">
                  {error}
                </div>
              )}
              {linkSuccess && (
                <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-xl text-green-200 text-xs font-bold tracking-wide">
                  Account linked successfully! Returning to login...
                </div>
              )}
              
              <div className="space-y-3">
                <input 
                  type="text" placeholder="Investor Code (Legacy User ID)" value={linkInvestorCode}
                  onChange={e => setLinkInvestorCode(e.target.value)} required
                  className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/40 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input 
                  type="password" placeholder="Legacy Password" value={linkLegacyPassword}
                  onChange={e => setLinkLegacyPassword(e.target.value)} required
                  className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/40 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button type="submit" disabled={isLoggingIn} className="w-full py-4 bg-white text-brand-navy rounded-xl font-bold hover:bg-gray-100 transition-colors flex items-center justify-center gap-2">
                <svg viewBox="0 0 48 48" className="w-5 h-5">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
                {isLoggingIn ? 'Processing...' : 'Verify & Link with Google'}
              </button>
              
              <button type="button" onClick={() => setView('login')} className="w-full py-3 bg-transparent text-white/70 text-sm hover:text-white transition-colors">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="flex flex-col items-center space-y-6">
          <div className="flex justify-center mb-2">
            <EvdekimiLogo className="w-24 h-24" />
          </div>
          
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-white tracking-tight">EVDEkimi Dashboard</h2>
            <p className="text-brand-muted text-sm px-4">
              Real Estate Financial Management Portal
            </p>
          </div>

          <div className="w-full bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-left flex items-start gap-3 mt-6 mb-4">
            <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-200 leading-relaxed font-medium">
              <strong className="text-blue-300 font-bold block mb-1">Important Notice</strong> 
              Starting October 1st, only Google and Apple ID authentication will be supported. Please use the Registration menu to link your legacy User ID and Password to your Google or Apple account for secure login.
            </p>
          </div>

          <div className="w-full space-y-4">
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-xs font-bold uppercase tracking-widest">
                {error}
              </div>
            )}
            
            <div className="space-y-3">
              <input 
                type="text" 
                placeholder="Username" 
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/40 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <input 
                type="password" 
                placeholder="Password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/40 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-4 bg-white text-brand-navy rounded-xl font-bold hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 group shadow-xl active:scale-95 disabled:opacity-50 mt-2"
            >
              <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              {isLoggingIn ? 'Authenticating...' : 'Sign In'}
            </button>

            <div className="relative my-4 flex py-1 items-center">
              <div className="flex-grow border-t border-white/15"></div>
              <span className="flex-shrink mx-4 text-white/40 text-xs font-bold uppercase tracking-widest">Or</span>
              <div className="flex-grow border-t border-white/15"></div>
            </div>
            
            <div className="grid grid-cols-2 gap-3 w-full">
              <button
                type="button" onClick={handleGoogleLogin} disabled={isLoggingIn}
                className="w-full py-3 bg-white border border-transparent rounded-xl hover:bg-gray-100 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
              >
                <svg viewBox="0 0 48 48" className="w-5 h-5">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
                <span className="text-gray-700 font-bold text-sm">Google</span>
              </button>

              <button
                type="button" onClick={handleAppleLogin} disabled={isLoggingIn}
                className="w-full py-3 bg-black border border-transparent text-white rounded-xl hover:bg-gray-900 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
              >
                <svg viewBox="0 0 384 512" className="w-4 h-4" fill="currentColor">
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
                </svg>
                <span className="font-bold text-sm">Apple</span>
              </button>
            </div>
            
            <button
              type="button" onClick={() => setView('link')}
              className="mt-4 text-blue-300 hover:text-blue-200 text-xs font-bold underline transition-colors"
            >
              Account Registration / Linking
            </button>
          </div>
          <p className="text-[10px] text-brand-muted uppercase tracking-widest">
            Production Identity Gate Active
          </p>
        </form>
        )}
      </motion.div>
    </div>
  );
}
