import type { RecoveredTake } from '../../hooks/useRecordingRecovery';
import './RecordingRecoveryDialog.css';

interface RecordingRecoveryDialogProps {
  take: RecoveredTake;
  onRestore: () => void;
  onDiscard: () => void;
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function RecordingRecoveryDialog({ take, onRestore, onDiscard }: RecordingRecoveryDialogProps) {
  const { marker, estimatedDurationSecs } = take;

  return (
    <div className="rrd-overlay">
      <div className="rrd-dialog" role="alertdialog" aria-modal="true">
        <div className="rrd-icon">⚠</div>
        <h2 className="rrd-title">Recovered Recording Found</h2>
        <p className="rrd-subtitle">
          The app closed while a recording was in progress. This take was recovered.
        </p>

        <div className="rrd-take-card">
          <div className="rrd-take-row">
            <span className="rrd-take-label">Take</span>
            <span className="rrd-take-value">{marker.takeName}</span>
          </div>
          <div className="rrd-take-row">
            <span className="rrd-take-label">Track</span>
            <span className="rrd-take-value">{marker.trackName}</span>
          </div>
          <div className="rrd-take-row">
            <span className="rrd-take-label">Duration</span>
            <span className="rrd-take-value">~{fmtDuration(estimatedDurationSecs)}</span>
          </div>
          <div className="rrd-take-row">
            <span className="rrd-take-label">Recorded</span>
            <span className="rrd-take-value">{fmtDate(marker.timestamp)}</span>
          </div>
        </div>

        <div className="rrd-actions">
          <button className="rrd-btn rrd-btn--restore" onClick={onRestore}>
            Restore Take
          </button>
          <button className="rrd-btn rrd-btn--discard" onClick={onDiscard}>
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
