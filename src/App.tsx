import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import './index.css';

import { supabase } from './lib/supabaseClient';
import { getMyArtistCode, type ArtistCode } from './lib/artistCodes';
import { DawProvider } from './context/DawContext';
import { VideoCallProvider } from './context/VideoCallContext';
import { MonitorStreamProvider } from './context/MonitorStreamContext';
import DawWorkspace from './components/daw/DawWorkspace';
import AuthScreen from './components/auth/AuthScreen';
import SessionScreen from './components/session/SessionScreen';
import LandingPage from './components/landing/LandingPage';
import EngineerConsole from './components/engineer/EngineerConsole';
import { StudioErrorBoundary } from './components/error/StudioErrorBoundary';

// Admin panel loaded lazily — not needed by most users
const AdminPanel = lazy(() => import('./components/admin/AdminPanel'));

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

function App() {
  const [showApp, setShowApp] = useState(() =>
    isElectron || localStorage.getItem('sl_showApp') === 'true'
  );
  const [showPinTip, setShowPinTip] = useState(() => {
    if (!isElectron) return false;
    const seen = localStorage.getItem('sl_pinTipSeen');
    if (!seen) { localStorage.setItem('sl_pinTipSeen', 'true'); return true; }
    return false;
  });
  const [userRole, setUserRole] = useState<'artist' | 'engineer' | null>(() =>
    (localStorage.getItem('sl_role') as 'artist' | 'engineer') || null
  );
  const [session, setSession] = useState<any>(null);
  const [displayName, setDisplayName] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string | null>(() =>
    localStorage.getItem('sl_room')
  );
  const [artistCode, setArtistCode] = useState<ArtistCode | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [passwordResetMode, setPasswordResetMode] = useState(false);

  // Safe mode: set by StudioErrorBoundary when user clicks "Reload in Safe Mode".
  // Disables native audio init for the current session.
  const [safeMode, setSafeMode] = useState(() => {
    const req = localStorage.getItem('sl_safe_mode_next') === 'true';
    if (req) localStorage.removeItem('sl_safe_mode_next');
    return req;
  });
  // Crash breadcrumb: set when entering studio, cleared on clean exit / after stable timeout.
  // If still set on next launch, the previous studio session didn't exit cleanly.
  const [prevCrashDetected] = useState(() => localStorage.getItem('sl_in_studio') === 'true');
  const [crashBannerDismissed, setCrashBannerDismissed] = useState(false);
  const studioStableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-validate Supabase session on mount + listen for PASSWORD_RECOVERY
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        const u = data.session.user;
        const meta = u.user_metadata ?? {};
        const isAdminUser = u.app_metadata?.is_admin === true;

        // Derive the canonical role from the session, not from localStorage.
        // localStorage can be stale (e.g. previous engineer session on same machine).
        let sessionRole = meta.role as 'artist' | 'engineer' | undefined;
        if (!sessionRole && isAdminUser) sessionRole = 'engineer';

        setSession(data.session);
        setIsAdmin(isAdminUser);
        setDisplayName(meta.display_name || u.email?.split('@')[0] || '');

        if (sessionRole) {
          setUserRole(sessionRole);
          localStorage.setItem('sl_role', sessionRole);
        }

        if (sessionRole === 'artist') {
          getMyArtistCode(u.id).then(code => {
            if (code) setArtistCode(code);
          });
        }
      } else {
        localStorage.removeItem('sl_role');
        localStorage.removeItem('sl_room');
        setUserRole(null);
        setRoomCode(null);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordResetMode(true);
        setSession(null);
        setUserRole(null);
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUserRole(null);
        setIsAdmin(false);
        setRoomCode(null);
        setArtistCode(null);
        localStorage.removeItem('sl_role');
        localStorage.removeItem('sl_room');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = (role: 'artist' | 'engineer', activeSession: any) => {
    setUserRole(role);
    setSession(activeSession);
    localStorage.setItem('sl_role', role);
    setIsAdmin(activeSession.user.app_metadata?.is_admin === true);
    const meta = activeSession.user.user_metadata ?? {};
    setDisplayName(meta.display_name || activeSession.user.email?.split('@')[0] || '');

    if (role === 'artist') {
      getMyArtistCode(activeSession.user.id).then(code => {
        if (code) setArtistCode(code);
      });
    }
  };

  const handleJoinSession = (code: string) => {
    setRoomCode(code);
    localStorage.setItem('sl_room', code);
    // Crash breadcrumb: cleared on clean exit or after 10 s stable render
    localStorage.setItem('sl_in_studio', 'true');
    if (studioStableTimerRef.current) clearTimeout(studioStableTimerRef.current);
    studioStableTimerRef.current = setTimeout(() => {
      localStorage.removeItem('sl_in_studio');
      localStorage.removeItem('sl_studio_crash_count');
    }, 10_000);
  };

  // Called from SessionScreen when artist claims a new code
  const handleArtistCodeClaimed = (code: ArtistCode) => {
    setArtistCode(code);
    handleJoinSession(code.code);
  };

  const handleLaunchWeb = () => {
    setShowApp(true);
    localStorage.setItem('sl_showApp', 'true');
  };

  if (!showApp) {
    return (
      <LandingPage
        onLaunchWeb={handleLaunchWeb}
        exeDownloadUrl={`https://github.com/shantileemedia-developer/riddimSync/releases/download/v${__APP_VERSION__}/RiddimSync-Setup-${__APP_VERSION__}.exe`}
      />
    );
  }

  if (!session || !userRole) {
    return (
      <div className="app-container">
        <div className="top-bar">
          <div className="top-bar-title">RiddimSync</div>
        </div>
        <AuthScreen
          onLogin={(role, activeSession) => {
            setPasswordResetMode(false);
            handleLogin(role, activeSession);
          }}
          passwordResetMode={passwordResetMode}
        />
      </div>
    );
  }

  // ── Engineer: goes to the Engineer Console (manages its own session/room state) ──
  if (userRole === 'engineer') {
    return (
      <>
        {showPinTip && (
          <div style={{
            position: 'fixed', top: 12, right: 12, zIndex: 9999,
            background: '#1e1e2e', border: '1px solid #7c3aed', borderRadius: 8,
            padding: '10px 14px', color: '#e2e8f0', fontSize: 13, maxWidth: 320,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}>
            <strong style={{ color: '#a78bfa' }}>Tip:</strong> Right-click the RiddimSync icon in your taskbar while the app is running, then choose <strong>Pin to taskbar</strong> for quick access.
            <button onClick={() => setShowPinTip(false)} style={{
              marginLeft: 10, background: 'none', border: 'none', color: '#94a3b8',
              cursor: 'pointer', fontSize: 16, lineHeight: 1, float: 'right',
            }}>×</button>
          </div>
        )}
        <EngineerConsole
          userId={session.user.id}
          displayName={displayName}
          isAdmin={isAdmin}
          onOpenAdmin={() => setShowAdminPanel(true)}
        />
        {showAdminPanel && (
          <Suspense fallback={null}>
            <AdminPanel onClose={() => setShowAdminPanel(false)} />
          </Suspense>
        )}
      </>
    );
  }

  // ── Artist: session screen → DAW ─────────────────────────────────────────
  if (!roomCode) {
    return (
      <div className="app-container">
        <div className="top-bar">
          <div className="top-bar-title">RiddimSync — Artist</div>
          {isAdmin && (
            <button
              className="top-bar-admin-btn"
              onClick={() => setShowAdminPanel(true)}
              title="Admin — Manage Artist Codes"
            >
              Admin
            </button>
          )}
        </div>
        <SessionScreen
          userRole={userRole}
          artistCode={artistCode}
          onJoin={handleJoinSession}
          onArtistCodeClaimed={handleArtistCodeClaimed}
        />
        {showAdminPanel && (
          <Suspense fallback={null}>
            <AdminPanel onClose={() => setShowAdminPanel(false)} />
          </Suspense>
        )}
      </div>
    );
  }

  const handleLeaveSession = () => {
    if (studioStableTimerRef.current) clearTimeout(studioStableTimerRef.current);
    localStorage.removeItem('sl_room');
    localStorage.removeItem('sl_in_studio');
    localStorage.removeItem('sl_studio_crash_count');
    setRoomCode(null);
    setSafeMode(false);
  };

  const handleBackToDashboard = () => {
    if (studioStableTimerRef.current) clearTimeout(studioStableTimerRef.current);
    localStorage.removeItem('sl_room');
    localStorage.removeItem('sl_in_studio');
    setRoomCode(null);
    setSafeMode(false);
  };

  const showCrashBanner = prevCrashDetected && !crashBannerDismissed && !safeMode;

  return (
    <StudioErrorBoundary onBackToDashboard={handleBackToDashboard}>
    <VideoCallProvider roomCode={roomCode} userId={session.user.id} isInitiator={false}>
    <MonitorStreamProvider roomCode={roomCode} userId={session.user.id} isEngineer={false}>
    <DawProvider userRole={userRole}>
      <div className="app-container daw-mode">
        {showPinTip && (
          <div style={{
            position: 'fixed', top: 12, right: 12, zIndex: 9999,
            background: '#1e1e2e', border: '1px solid #7c3aed', borderRadius: 8,
            padding: '10px 14px', color: '#e2e8f0', fontSize: 13, maxWidth: 320,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}>
            <strong style={{ color: '#a78bfa' }}>Tip:</strong> Right-click the RiddimSync icon in your taskbar while the app is running, then choose <strong>Pin to taskbar</strong> for quick access.
            <button onClick={() => setShowPinTip(false)} style={{
              marginLeft: 10, background: 'none', border: 'none', color: '#94a3b8',
              cursor: 'pointer', fontSize: 16, lineHeight: 1, float: 'right',
            }}>×</button>
          </div>
        )}
        {safeMode && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9998,
            background: '#1a2a18', borderBottom: '1px solid #00cc6644',
            padding: '5px 16px', fontSize: 12, color: '#00cc66',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span>⚠ Safe Mode — native audio disabled.</span>
            <button
              onClick={() => setSafeMode(false)}
              style={{ background: 'none', border: '1px solid #00cc6644', color: '#00cc66',
                borderRadius: 4, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}
            >
              Exit Safe Mode
            </button>
          </div>
        )}
        {showCrashBanner && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9998,
            background: '#1e1010', borderBottom: '1px solid #ff444444',
            padding: '5px 16px', fontSize: 12, color: '#ff8080',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span>The previous studio session didn't exit cleanly.</span>
            <button
              onClick={() => { setSafeMode(true); setCrashBannerDismissed(true); }}
              style={{ background: 'none', border: '1px solid #ff444444', color: '#ff8080',
                borderRadius: 4, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}
            >
              Reload in Safe Mode
            </button>
            <button
              onClick={() => setCrashBannerDismissed(true)}
              style={{ background: 'none', border: 'none', color: '#555',
                fontSize: 14, cursor: 'pointer', marginLeft: 'auto' }}
            >
              ×
            </button>
          </div>
        )}
        <DawWorkspace
          userRole={userRole}
          userId={session.user.id}
          roomCode={roomCode}
          isAdmin={isAdmin}
          safeMode={safeMode}
          onOpenAdmin={() => setShowAdminPanel(true)}
          onLeaveSession={handleLeaveSession}
        />
        {showAdminPanel && (
          <Suspense fallback={null}>
            <AdminPanel onClose={() => setShowAdminPanel(false)} />
          </Suspense>
        )}
      </div>
    </DawProvider>
    </MonitorStreamProvider>
    </VideoCallProvider>
    </StudioErrorBoundary>
  );
}

export default App;
