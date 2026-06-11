import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useDaw } from '../../context/DawContext';
import { supabase } from '../../lib/supabaseClient';
import './MenuBar.css';

interface MenuItem {
  label: string;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  projectName?: string;
  onOpenPreferences?: () => void;
}

const MenuBar: React.FC<MenuBarProps> = ({ projectName = 'Untitled Project', onOpenPreferences }) => {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const { dispatch, state, setProjectDirHandle, setAudioDirHandle, projectDirHandle } = useDaw();

  const handleSaveAs = async () => {
    try {
      if (!('showDirectoryPicker' in window)) {
        alert('Local folder saving is currently only supported in Chrome or Edge.');
        return;
      }
      
      // Request user to select a local directory
      // @ts-ignore
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setProjectDirHandle(dirHandle);

      // Create or get the Audio subfolder
      const audioDir = await dirHandle.getDirectoryHandle('Audio', { create: true });
      setAudioDirHandle(audioDir);

      // Save project.json
      await handleSave(dirHandle);

      alert(`Project saved successfully to local folder: ${dirHandle.name}`);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Save As Error:', err);
        alert('Failed to save project. Ensure you have granted folder permissions.');
      }
    }
  };

  const handleSave = async (dirHandle = projectDirHandle) => {
    if (!dirHandle) {
      return handleSaveAs();
    }
    try {
      const fileHandle = await dirHandle.getFileHandle('project.json', { create: true });
      const writable = await fileHandle.createWritable();
      
      // Optional: exclude large waveform data or blobs from being saved verbatim if needed, 
      // but for now we just serialize state. We omit pool items' objectUrls because they don't persist well, 
      // but we do need the file references.
      const stateToSave = { ...state };
      
      await writable.write(JSON.stringify(stateToSave, null, 2));
      await writable.close();
      
      if (dirHandle === projectDirHandle) {
        // Just a normal save, show a subtle notification or nothing
        console.log('Project saved to project.json');
      }
    } catch (err) {
      console.error('Save Error:', err);
    }
  };

  const MENUS: Menu[] = useMemo(() => [
    {
      label: 'File',
      items: [
        { label: 'New Project',          shortcut: 'Ctrl+N' },
        { label: 'Open Project…',        shortcut: 'Ctrl+O' },
        { label: 'Open Recent',          disabled: true },
        { separator: true, label: '' },
        { label: 'Close Project' },
        { separator: true, label: '' },
        { label: 'Save',                 shortcut: 'Ctrl+S', onClick: () => handleSave() },
        { label: 'Save As…',             shortcut: 'Ctrl+Shift+S', onClick: handleSaveAs },
        { label: 'Save New Version' },
        { label: 'Revert' },
        { separator: true, label: '' },
        { label: 'Import Audio File…' },
        { label: 'Import MIDI File…' },
        { separator: true, label: '' },
        { label: 'Export Audio Mixdown…', shortcut: 'Ctrl+Shift+E' },
        { label: 'Export MIDI File…' },
        { separator: true, label: '' },
        { label: 'Preferences…' },
        { separator: true, label: '' },
        { label: 'Sign Out', onClick: async () => {
          await supabase.auth.signOut();
          window.location.reload();
        } },
        { label: 'Quit',                  shortcut: 'Ctrl+Q' },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo',       shortcut: 'Ctrl+Z', disabled: state.history.past.length === 0, onClick: () => dispatch({ type: 'UNDO' }) },
        { label: 'Redo',       shortcut: 'Ctrl+Shift+Z', disabled: state.history.future.length === 0, onClick: () => dispatch({ type: 'REDO' }) },
        { label: 'History…' },
        { separator: true, label: '' },
        { label: 'Cut',        shortcut: 'Ctrl+X' },
        { label: 'Copy',       shortcut: 'Ctrl+C' },
        { label: 'Paste',      shortcut: 'Ctrl+V' },
        { label: 'Paste at Origin' },
        { label: 'Delete',     shortcut: 'Del' },
        { separator: true, label: '' },
        { label: 'Select All', shortcut: 'Ctrl+A' },
        { label: 'Deselect All' },
        { separator: true, label: '' },
        { label: 'Find…',      shortcut: 'Ctrl+F' },
        { separator: true, label: '' },
        { label: 'Preferences…', shortcut: 'Ctrl+,', onClick: onOpenPreferences },
      ],
    },
    {
      label: 'Project',
      items: [
        { label: 'Project Setup…' },
        { label: 'Project Properties…' },
        { label: 'Notepad' },
        { separator: true, label: '' },
        { label: 'Add Audio Track' },
        { label: 'Add MIDI Track' },
        { label: 'Add Instrument Track' },
        { label: 'Add Stereo Track' },
        { separator: true, label: '' },
        { label: 'Markers' },
        { label: 'Tempo Track' },
        { label: 'Chord Track' },
      ],
    },
    {
      label: 'Audio',
      items: [
        { label: 'Hardware Setup…' },
        { label: 'Driver Configuration…' },
        { separator: true, label: '' },
        { label: 'Process' },
        { label: 'Plug-ins' },
        { label: 'Advanced' },
        { separator: true, label: '' },
        { label: 'Spectrum Analyzer' },
        { label: 'Statistics…' },
      ],
    },
    {
      label: 'MIDI',
      items: [
        { label: 'MIDI Setup…' },
        { label: 'MIDI Remote' },
        { separator: true, label: '' },
        { label: 'Transpose…' },
        { label: 'Logical Editor…' },
        { label: 'Drum Editor' },
        { separator: true, label: '' },
        { label: 'Note Expression' },
        { label: 'Step Designer' },
      ],
    },
    {
      label: 'Transport',
      items: [
        { label: 'Play',               shortcut: 'Space', onClick: () => dispatch({ type: 'SET_PLAYING', payload: !state.transport.isPlaying }) },
        { label: 'Record',             shortcut: 'R', onClick: () => dispatch({ type: 'SET_RECORDING', payload: !state.transport.isRecording }) },
        { label: 'Return to Zero',     shortcut: 'Num 0', onClick: () => dispatch({ type: 'SET_CURRENT_TIME', payload: 0 }) },
        { label: 'Rewind',             shortcut: 'Num -' },
        { label: 'Forward',            shortcut: 'Num +' },
        { separator: true, label: '' },
        { label: 'Toggle Loop',        shortcut: 'Ctrl+L', onClick: () => dispatch({ type: 'TOGGLE_LOOP' }) },
        { label: 'Metronome On/Off',   shortcut: 'Ctrl+M', onClick: () => dispatch({ type: 'TOGGLE_METRONOME' }) },
        { label: 'Tap Tempo' },
        { separator: true, label: '' },
        { label: 'Set Tempo from Selection' },
      ],
    },
    {
      label: 'Devices',
      items: [
        { label: 'Device Manager…' },
        { label: 'VST Instruments…',  shortcut: 'F11' },
        { label: 'VST Connections…',  shortcut: 'F4' },
        { separator: true, label: '' },
        { label: 'Remote Devices' },
        { label: 'External FX…' },
        { label: 'Control Room…' },
      ],
    },
    {
      label: 'Window',
      items: [
        { label: 'New Window' },
        { separator: true, label: '' },
        { label: 'Mixer',              shortcut: 'F3' },
        { label: 'MIDI Remote',        shortcut: 'Alt+M' },
        { label: 'Tempo Track' },
        { label: 'Chord Track' },
        { label: 'Marker Track' },
        { separator: true, label: '' },
        { label: 'Tile Windows' },
        { label: 'Cascade Windows' },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Documentation' },
        { label: 'Keyboard Shortcuts…' },
        { label: 'Video Tutorials' },
        { separator: true, label: '' },
        { label: 'Check for Updates…' },
        { label: 'About StudioDESK' },
      ],
    },
  ], [state.history.past.length, state.history.future.length, state.transport.isPlaying, state.transport.isRecording, dispatch, onOpenPreferences]);

  // Close on outside click
  useEffect(() => {
    if (openMenu === null) return;
    const h = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node))
        setOpenMenu(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [openMenu]);

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const toggleMenu = useCallback((idx: number) => {
    setOpenMenu(prev => (prev === idx ? null : idx));
  }, []);

  const handleItemClick = useCallback((item: MenuItem) => {
    if (item.separator || item.disabled) return;
    item.onClick?.();
    setOpenMenu(null);
  }, []);

  return (
    <div className="menu-bar" ref={barRef}>
      <div className="menu-bar-logo">
        <span className="menu-bar-brand">StudioDESK</span>
      </div>

      <div className="menu-bar-menus">
        {MENUS.map((menu, idx) => (
          <div
            key={menu.label}
            className={`menu-bar-item ${openMenu === idx ? 'open' : ''}`}
            onClick={() => toggleMenu(idx)}
            onMouseEnter={() => { if (openMenu !== null) setOpenMenu(idx); }}
          >
            <span className="menu-bar-label">{menu.label}</span>

            {openMenu === idx && (
              <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
                {menu.items.map((item, i) =>
                  item.separator ? (
                    <div key={`sep-${i}`} className="menu-separator" />
                  ) : (
                    <div
                      key={item.label}
                      className={`menu-item ${item.disabled ? 'disabled' : ''}`}
                      onClick={() => handleItemClick(item)}
                    >
                      <span className="menu-item-label">{item.label}</span>
                      {item.shortcut && (
                        <span className="menu-item-shortcut">{item.shortcut}</span>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="menu-bar-project">
        <span className="menu-project-name">{projectName}</span>
      </div>
    </div>
  );
};

export default MenuBar;
