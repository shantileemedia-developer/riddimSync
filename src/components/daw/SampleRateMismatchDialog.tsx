import { useDaw } from '../../context/DawContext';
import './SampleRateMismatchDialog.css';

const COMMON_RATES = [44100, 48000, 88200, 96000];

interface SampleRateMismatchDialogProps {
  onOpenAudioSettings: () => void;
}

export default function SampleRateMismatchDialog({ onOpenAudioSettings }: SampleRateMismatchDialogProps) {
  const { state, dispatch } = useDaw();
  const error = state.audioError;

  if (!error || error.code !== 'SAMPLE_RATE_MISMATCH') return null;

  const deviceRate = error.sampleRate;

  const dismiss = () => dispatch({ type: 'CLEAR_AUDIO_ERROR' });

  const switchProjectRate = (rate: number) => {
    // Persist new rate to audio prefs so the engine uses it on next play
    try {
      const raw = localStorage.getItem('riddimSync_audio_prefs');
      const prefs = raw ? JSON.parse(raw) : {};
      localStorage.setItem('riddimSync_audio_prefs', JSON.stringify({ ...prefs, sampleRate: rate }));
    } catch {}
    dismiss();
  };

  const openSettings = () => {
    dismiss();
    onOpenAudioSettings();
  };

  return (
    <div className="srm-overlay" onClick={dismiss}>
      <div className="srm-dialog" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <div className="srm-header">
          <span className="srm-icon">⚠</span>
          <h2 className="srm-title">Sample Rate Mismatch</h2>
        </div>

        <p className="srm-body">
          {deviceRate
            ? `Your audio interface is running at ${deviceRate.toLocaleString()} Hz, which does not match the project.`
            : 'Your audio interface sample rate does not match the project setting.'}
          {' '}Playing at the wrong rate will cause pitch and speed errors.
        </p>

        <div className="srm-section-label">Switch project to:</div>
        <div className="srm-rate-grid">
          {COMMON_RATES.map(rate => (
            <button
              key={rate}
              className={`srm-rate-btn${deviceRate === rate ? ' srm-rate-btn--device' : ''}`}
              onClick={() => switchProjectRate(rate)}
            >
              {(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1)} kHz
              {deviceRate === rate && <span className="srm-rate-badge">device</span>}
            </button>
          ))}
        </div>

        <div className="srm-divider" />

        <div className="srm-actions">
          <button className="srm-btn srm-btn--settings" onClick={openSettings}>
            Open Audio Settings
          </button>
          <button className="srm-btn srm-btn--cancel" onClick={dismiss}>
            Cancel
          </button>
        </div>

        {error.technicalMessage && (
          <details className="srm-details">
            <summary>Technical details</summary>
            <code>{error.technicalMessage}</code>
          </details>
        )}
      </div>
    </div>
  );
}
