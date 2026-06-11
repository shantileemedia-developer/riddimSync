import { Settings2, Volume2, Target, SlidersHorizontal, ChevronDown, Power } from 'lucide-react';
import { useDaw } from '../../context/DawContext';
import './InspectorPanel.css';

const InspectorPanel = () => {
  const { state, dispatch } = useDaw();
  const track = state.tracks.find(t => t.id === state.selectedTrackId);

  if (!track) {
    return (
      <div className="daw-panel inspector-panel">
        <div className="daw-panel-header">Inspector</div>
        <div className="inspector-content" style={{ padding: 20, color: '#666', textAlign: 'center' }}>
          No track selected
        </div>
      </div>
    );
  }

  return (
    <div className="daw-panel inspector-panel">
      <div className="daw-panel-header">Inspector</div>
      
      {/* Selected Track Name */}
      <div className="inspector-track-header">
        <div className="color-strip" style={{ backgroundColor: track.color }}></div>
        <span className="track-name">{track.name}</span>
      </div>

      <div className="inspector-content">
        {/* Track Routing */}
        <div className="inspector-section">
          <div className="section-header">
            <Settings2 size={14} />
            <span>Routing</span>
            <ChevronDown size={14} className="ml-auto" />
          </div>
          <div className="section-body">
            <div className="routing-box">{track.type === 'stereo' ? 'Stereo In' : 'Mono In'}</div>
            <div className="routing-box">Stereo Out</div>
          </div>
        </div>

        {/* Inserts */}
        <div className="inspector-section">
          <div className="section-header">
            <SlidersHorizontal size={14} />
            <span>Inserts</span>
            <ChevronDown size={14} className="ml-auto" />
          </div>
          <div className="section-body p-0">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="insert-slot">
                <Power size={12} className="power-off" />
                <span className="slot-name"></span>
                <ChevronDown size={12} className="dropdown-icon" />
              </div>
            ))}
          </div>
        </div>

        {/* Sends */}
        <div className="inspector-section">
          <div className="section-header">
            <Target size={14} />
            <span>Sends</span>
            <ChevronDown size={14} className="ml-auto" />
          </div>
        </div>

        {/* Fader Area */}
        <div className="inspector-fader-area">
          <Volume2 size={16} color={track.color} />
          <div className="fader-track-container" style={{ position: 'relative', width: '100%', height: 120, marginTop: 10 }}>
            <input 
              type="range" 
              min="0" 
              max="1.5" 
              step="0.01" 
              value={track.volume}
              onChange={e => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { volume: parseFloat(e.target.value) } } })}
              className="inspector-volume-slider"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: 120,
                transform: 'translate(-50%, -50%) rotate(-90deg)',
                cursor: 'pointer'
              }}
            />
          </div>
          <div className="fader-value">{(track.volume * 100).toFixed(0)}%</div>
        </div>
      </div>
    </div>
  );
};

export default InspectorPanel;
