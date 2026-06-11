import { useState, useRef, useEffect } from 'react';
import {
  MousePointer2, Scissors, Eraser, VolumeX, Search,
  Spline, Pencil, Copy, Palette,
} from 'lucide-react';
import { useDaw } from '../../context/DawContext';
import type { ActiveTool } from '../../context/DawContext';
import './TopToolbar.css';

const TOOLS: { id: ActiveTool; icon: React.ElementType; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Object Selection', key: '1' },
  { id: 'range',  icon: Copy,          label: 'Range Selection',  key: '2' },
  { id: 'split',  icon: Scissors,      label: 'Split',            key: '3' },
  { id: 'glue',   icon: Spline,        label: 'Glue',             key: '4' },
  { id: 'erase',  icon: Eraser,        label: 'Erase',            key: '5' },
  { id: 'zoom',   icon: Search,        label: 'Zoom',             key: '6' },
  { id: 'mute',   icon: VolumeX,       label: 'Mute',             key: '7' },
  { id: 'draw',   icon: Pencil,        label: 'Draw',             key: '8' },
];

const COLOR_PALETTE = [
  '#ff4d4d', '#ff7f4d', '#ffb84d', '#ffd700',
  '#b8ff4d', '#00ffcc', '#4dffb8', '#4db8ff',
  '#4d9fff', '#7b68ff', '#cc4dff', '#ff4dcf',
  '#ffffff', '#b0b0b0', '#606060', '#303030',
];

const SNAP_VALUES = ['Off', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32'];

interface TopToolbarProps {
  roomCode?: string;
  userRole?: 'artist' | 'engineer';
  onlineCount?: number;
}

const TopToolbar: React.FC<TopToolbarProps> = ({ roomCode, userRole, onlineCount }) => {
  const { state, dispatch } = useDaw();
  const { activeTool, selectedTrackId, tracks } = state;

  const [showPalette, setShowPalette] = useState(false);
  const [showSnapMenu, setShowSnapMenu] = useState(false);

  const snapOn  = state.snapOn;
  const snapVal = state.snapValue;

  const paletteRef = useRef<HTMLDivElement>(null);
  const snapRef    = useRef<HTMLDivElement>(null);

  const selectedTrack = tracks.find(t => t.id === selectedTrackId);

  // Close palettes on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) setShowPalette(false);
      if (snapRef.current    && !snapRef.current.contains(e.target as Node))    setShowSnapMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const applyColor = (color: string) => {
    if (!selectedTrackId) return;
    dispatch({ type: 'UPDATE_TRACK', payload: { id: selectedTrackId, updates: { color } } });
    setShowPalette(false);
  };

  return (
    <div className="top-toolbar">

      {/* ── flex spacer left ────────────────────────── */}
      <div className="toolbar-left" />

      {/* ── CENTER: color | tools | snap (all together) */}
      <div className="toolbar-center">

        {/* Tool buttons */}
        <div className="toolbar-section">
          {TOOLS.map(({ id, icon: Icon, label, key }) => (
            <button
              key={id}
              className={`toolbar-btn ${activeTool === id ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'SET_TOOL', payload: id })}
              title={`${label}  [${key}]`}
            >
              <Icon size={15} />
              <span className="tool-key">{key}</span>
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* Color picker */}
        <div className="toolbar-section" ref={paletteRef} style={{ position: 'relative' }}>
          <button
            className={`toolbar-btn color-pick-btn ${showPalette ? 'active' : ''}`}
            title={selectedTrack ? `Color: ${selectedTrack.name}` : 'Select a track first'}
            onClick={() => setShowPalette(v => !v)}
          >
            <Palette size={14} />
            <span className="color-swatch" style={{ backgroundColor: selectedTrack?.color ?? '#555' }} />
          </button>

          {showPalette && (
            <div className="color-palette-popup">
              <div className="palette-title">
                {selectedTrack ? selectedTrack.name : 'No track selected'}
              </div>
              <div className="palette-grid">
                {COLOR_PALETTE.map(c => (
                  <button
                    key={c}
                    className={`palette-cell ${selectedTrack?.color === c ? 'palette-active' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => applyColor(c)}
                    title={c}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="toolbar-divider" />

        {/* Snap / Grid */}
        <div className="toolbar-section grid-settings" ref={snapRef} style={{ position: 'relative' }}>
          <div
            className={`grid-toggle ${snapOn ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SNAP', payload: { on: !snapOn, value: snapVal } })}
            title="Toggle Snap"
          >Snap</div>
          <div className="grid-type">Grid</div>
          <div
            className="grid-value"
            onClick={() => setShowSnapMenu(v => !v)}
            title="Snap value"
          >{snapVal}</div>

          {showSnapMenu && (
            <div className="snap-dropdown">
              {SNAP_VALUES.map(v => (
                <div
                  key={v}
                  className={`snap-item ${snapVal === v ? 'active' : ''}`}
                  onClick={() => { dispatch({ type: 'SET_SNAP', payload: { on: snapOn, value: v } }); setShowSnapMenu(false); }}
                >{v}</div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── flex spacer right ───────────────────────── */}
      <div className="toolbar-right" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '20px', gap: '15px' }}>
        {roomCode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#1a1b1e', padding: '4px 10px', borderRadius: '4px', border: '1px solid #333' }}>
            <span style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase' }}>Session ID:</span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#00ffcc', fontFamily: 'monospace', letterSpacing: '1px' }}>{roomCode}</span>
          </div>
        )}
        {onlineCount !== undefined && (
          <div style={{ fontSize: '11px', color: '#a0a0a0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px', background: '#1a1b1e', padding: '4px 8px', borderRadius: '4px', border: '1px solid #333' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: onlineCount > 1 ? '#00cc66' : '#888' }}></div>
            {onlineCount > 1 ? `${onlineCount} Online` : 'Only You'}
          </div>
        )}
        {userRole && (
          <div style={{ fontSize: '11px', color: '#a0a0a0', textTransform: 'uppercase', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: userRole === 'engineer' ? '#ff4d4d' : '#00ffcc' }}></div>
            {userRole}
          </div>
        )}
      </div>

    </div>
  );
};

export default TopToolbar;
