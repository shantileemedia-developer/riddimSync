import React, { useState, useEffect } from 'react';
import { Activity, Mic, MonitorPlay } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import './AuthScreen.css';

interface AuthScreenProps {
  onLogin: (role: 'artist' | 'engineer', session: any) => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isArtist, setIsArtist] = useState(true);
  const [isSignUp] = useState(false); // Sign up disabled for now
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Check if already logged in on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // If they have a session, read role from metadata if we want, 
        // or just rely on the UI selection they made previously.
        // For simplicity, we'll force them to click "Connect as X" if they already have a session,
        // or we could auto-login if role is in metadata.
        const role = session.user.user_metadata?.role as 'artist' | 'engineer';
        if (role) {
          onLogin(role, session);
        }
      }
    });
  }, [onLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    
    const role = isArtist ? 'artist' : 'engineer';

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { role } // store role in user metadata
          }
        });
        if (error) throw error;
        if (data.session) onLogin(role, data.session);
        else setErrorMsg('Check your email for the confirmation link.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (data.session) {
          // You can choose to use the saved metadata role or the UI toggle role
          const savedRole = data.session.user.user_metadata?.role || role;
          onLogin(savedRole, data.session);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <Activity size={32} color="#00ffcc" />
          <h1>StudioDESK</h1>
          <p>Sign in to connect to your session</p>
        </div>

        <div className="role-selector">
          <div 
            className={`role-option ${isArtist ? 'active' : ''}`}
            onClick={() => setIsArtist(true)}
          >
            <Mic size={24} />
            <span>Artist</span>
          </div>
          <div 
            className={`role-option ${!isArtist ? 'active' : ''}`}
            onClick={() => setIsArtist(false)}
          >
            <MonitorPlay size={24} />
            <span>Engineer</span>
          </div>
        </div>

        {errorMsg && <div className="auth-error">{errorMsg}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Email</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@studio.com"
              required 
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required 
            />
          </div>
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Processing...' : (isSignUp ? 'Create Account' : `Connect as ${isArtist ? 'Artist' : 'Engineer'}`)}
          </button>
          
          {/* Sign up disabled for now
          <button 
            type="button" 
            className="toggle-auth-mode-btn" 
            onClick={() => setIsSignUp(!isSignUp)}
          >
            {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
          </button>
          */}
        </form>
      </div>
    </div>
  );
};

export default AuthScreen;
