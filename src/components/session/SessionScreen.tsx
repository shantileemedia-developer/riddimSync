import React, { useState } from 'react';
import { Link2, Users } from 'lucide-react';
import './SessionScreen.css';

interface SessionScreenProps {
  userRole: 'artist' | 'engineer';
  onJoin: (roomCode: string) => void;
}

const SessionScreen: React.FC<SessionScreenProps> = ({ userRole, onJoin }) => {
  const [generatedCode] = useState(() =>
    Math.random().toString(36).substring(2, 8).toUpperCase()
  );
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'choose' | 'join'>(userRole === 'engineer' ? 'choose' : 'join');

  if (mode === 'choose' && userRole === 'engineer') {
    return (
      <div className="session-container">
        <div className="session-card">
          <h2>Start a Session</h2>
          <p className="session-sub">Share this code with your artist to connect</p>
          <div className="session-code-box">{generatedCode}</div>
          <p className="session-hint">Both users must enter the same code</p>
          <button className="session-btn primary" onClick={() => onJoin(generatedCode)}>
            <Link2 size={16} />
            Create Session
          </button>
          <button className="session-btn ghost" onClick={() => setMode('join')}>
            <Users size={16} />
            Join existing session
          </button>
          <button 
            className="session-btn ghost" 
            style={{ marginTop: '20px', color: '#ff4d4d' }}
            onClick={async () => {
              const { supabase } = await import('../../lib/supabaseClient');
              await supabase.auth.signOut();
              window.location.reload();
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="session-container">
      <div className="session-card">
        <h2>Join a Session</h2>
        <p className="session-sub">Enter the session code from your engineer</p>
        <input
          className="session-input"
          value={joinCode}
          onChange={e => setJoinCode(e.target.value.toUpperCase())}
          placeholder="XXXXXX"
          maxLength={6}
          autoFocus
        />
        <button
          className="session-btn primary"
          onClick={() => onJoin(joinCode)}
          disabled={joinCode.length < 4}
        >
          <Link2 size={16} />
          Join Session
        </button>
        {userRole === 'engineer' && (
          <button className="session-btn ghost" onClick={() => setMode('choose')}>
            Back
          </button>
        )}
        <button 
          className="session-btn ghost" 
          style={{ marginTop: '20px', color: '#ff4d4d' }}
          onClick={async () => {
            const { supabase } = await import('../../lib/supabaseClient');
            await supabase.auth.signOut();
            window.location.reload();
          }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
};

export default SessionScreen;
