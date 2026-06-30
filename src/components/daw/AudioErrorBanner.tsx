import { useState, useCallback } from 'react';
import { useDaw } from '../../context/DawContext';
import type { AudioEngineError } from '../../types/audioErrors';
import './AudioErrorBanner.css';

interface AudioErrorBannerProps {
  onOpenAudioSettings: () => void;
}

const BACKEND_LABELS: Record<AudioEngineError['backend'], string> = {
  ASIO:     'ASIO',
  WASAPI:   'WASAPI',
  WebAudio: 'Web Audio',
  unknown:  'Native',
};

export default function AudioErrorBanner({ onOpenAudioSettings }: AudioErrorBannerProps) {
  const { state, dispatch } = useDaw();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const error = state.audioError;

  const copyDetails = useCallback(() => {
    if (!error) return;
    const text = [
      `Audio Error — ${new Date(error.timestamp).toISOString()}`,
      `Code:    ${error.code}`,
      `Backend: ${error.backend}`,
      ...(error.deviceName  ? [`Device:  ${error.deviceName}`]  : []),
      ...(error.sampleRate  ? [`Rate:    ${error.sampleRate} Hz`] : []),
      ``,
      error.technicalMessage,
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [error]);

  if (!error) return null;

  const dismiss = () => {
    dispatch({ type: 'CLEAR_AUDIO_ERROR' });
    setShowDetails(false);
    setCopied(false);
  };

  return (
    <div className="audio-error-banner" role="alert">
      <div className="audio-error-main">
        <span className="audio-error-icon">⚠</span>
        <span className="audio-error-backend">{BACKEND_LABELS[error.backend]}</span>
        <span className="audio-error-msg">{error.userMessage}</span>

        <div className="audio-error-actions">
          <button
            className="audio-error-btn audio-error-btn--details"
            onClick={() => setShowDetails(v => !v)}
          >
            {showDetails ? 'Hide details' : 'Details'}
          </button>
          <button
            className="audio-error-btn audio-error-btn--settings"
            onClick={() => { dismiss(); onOpenAudioSettings(); }}
          >
            Audio Settings
          </button>
          <button
            className="audio-error-btn audio-error-btn--dismiss"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>

      {showDetails && (
        <div className="audio-error-details">
          <code className="audio-error-tech">{error.technicalMessage}</code>
          <button
            className="audio-error-btn audio-error-btn--copy"
            onClick={copyDetails}
          >
            {copied ? 'Copied!' : 'Copy details'}
          </button>
        </div>
      )}
    </div>
  );
}
