import { useState } from 'react';
import './index.css';

import { DawProvider } from './context/DawContext';
import DawWorkspace from './components/daw/DawWorkspace';
import AuthScreen from './components/auth/AuthScreen';
import SessionScreen from './components/session/SessionScreen';
import LandingPage from './components/landing/LandingPage';

function App() {
  const [showApp, setShowApp] = useState(false);
  const [userRole, setUserRole] = useState<'artist' | 'engineer' | null>(null);
  const [session, setSession] = useState<any>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);

  const handleLogin = (role: 'artist' | 'engineer', activeSession: any) => {
    setUserRole(role);
    setSession(activeSession);
  };

  const handleJoinSession = (code: string) => {
    setRoomCode(code);
  };

  if (!showApp) {
    return (
      <LandingPage
        onLaunchWeb={() => setShowApp(true)}
        exeDownloadUrl="https://github.com/shantileemedia-developer/studiodesk/releases/download/v0.0.0/StudioDESK-Setup-0.0.0.exe"
      />
    );
  }

  if (!session || !userRole) {
    return (
      <div className="app-container">
        <div className="top-bar">
          <div className="top-bar-title">StudioDESK</div>
        </div>
        <AuthScreen onLogin={handleLogin} />
      </div>
    );
  }

  if (!roomCode) {
    return (
      <div className="app-container">
        <div className="top-bar">
          <div className="top-bar-title">StudioDESK — {userRole === 'engineer' ? 'Engineer' : 'Artist'}</div>
        </div>
        <SessionScreen userRole={userRole} onJoin={handleJoinSession} />
      </div>
    );
  }

  return (
    <DawProvider userRole={userRole}>
      <div className="app-container daw-mode">
        <DawWorkspace
          userRole={userRole}
          userId={session.user.id}
          roomCode={roomCode}
        />
      </div>
    </DawProvider>
  );
}

export default App;
