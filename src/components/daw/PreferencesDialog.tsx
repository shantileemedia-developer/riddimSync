import React, { useState, useEffect } from 'react';
import { X, Cpu, Radio } from 'lucide-react';
import './PreferencesDialog.css';

interface PreferencesDialogProps {
  onClose: () => void;
}

interface AudioDevice {
  deviceId: string;
  label: string;
}

const PreferencesDialog: React.FC<PreferencesDialogProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'audio' | 'streaming'>('audio');
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [inputDevices,  setInputDevices]  = useState<AudioDevice[]>([]);
  const [selectedOutput, setSelectedOutput] = useState('');
  const [selectedInput,  setSelectedInput]  = useState('');
  const [streamingEnabled, setStreamingEnabled] = useState(() => {
    return localStorage.getItem('studiolink_streaming_enabled') !== 'false';
  });
  const [bufferSize, setBufferSize] = useState(() =>
    localStorage.getItem('studiolink_buffer_size') ?? '256'
  );

  useEffect(() => {
    const loadDevices = async () => {
      try {
        // Request permission so labels are visible
        await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === 'audiooutput').map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Output ${d.deviceId.slice(0, 8)}`,
        }));
        const inputs = devices.filter(d => d.kind === 'audioinput').map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Input ${d.deviceId.slice(0, 8)}`,
        }));
        setOutputDevices(outputs);
        setInputDevices(inputs);
        setSelectedOutput(prev => prev || outputs[0]?.deviceId || '');
        setSelectedInput(prev => prev || inputs[0]?.deviceId || '');
      } catch { /* permissions denied */ }
    };
    loadDevices();
  }, []);

  const handleSave = () => {
    localStorage.setItem('studiolink_streaming_enabled', String(streamingEnabled));
    localStorage.setItem('studiolink_buffer_size', bufferSize);
    localStorage.setItem('studiolink_output_device', selectedOutput);
    localStorage.setItem('studiolink_input_device', selectedInput);
    onClose();
  };

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="pref-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pref-dialog">
        <div className="pref-header">
          <span className="pref-title">Preferences</span>
          <button className="pref-close-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="pref-body">
          {/* Sidebar tabs */}
          <div className="pref-sidebar">
            <button
              className={`pref-tab ${activeTab === 'audio' ? 'active' : ''}`}
              onClick={() => setActiveTab('audio')}
            >
              <Cpu size={14} />
              Audio
            </button>
            <button
              className={`pref-tab ${activeTab === 'streaming' ? 'active' : ''}`}
              onClick={() => setActiveTab('streaming')}
            >
              <Radio size={14} />
              Streaming
            </button>
          </div>

          {/* Content */}
          <div className="pref-content">
            {activeTab === 'audio' && (
              <div className="pref-section">
                <h3 className="pref-section-title">Audio Settings</h3>

                <div className="pref-row">
                  <label className="pref-label">Audio Driver</label>
                  <div className="pref-driver-note">
                    Web Audio uses the browser's audio system. For ASIO/low-latency output on Windows,
                    set your ASIO driver as the default audio device in Windows Sound Settings.
                  </div>
                </div>

                <div className="pref-row">
                  <label className="pref-label">Output Device</label>
                  <select
                    className="pref-select"
                    value={selectedOutput}
                    onChange={e => setSelectedOutput(e.target.value)}
                  >
                    {outputDevices.length === 0
                      ? <option value="">Default</option>
                      : outputDevices.map(d => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                        ))}
                  </select>
                </div>

                <div className="pref-row">
                  <label className="pref-label">Input Device</label>
                  <select
                    className="pref-select"
                    value={selectedInput}
                    onChange={e => setSelectedInput(e.target.value)}
                  >
                    {inputDevices.length === 0
                      ? <option value="">Default Microphone</option>
                      : inputDevices.map(d => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                        ))}
                  </select>
                </div>

                <div className="pref-row">
                  <label className="pref-label">Buffer Size</label>
                  <select
                    className="pref-select"
                    value={bufferSize}
                    onChange={e => setBufferSize(e.target.value)}
                  >
                    <option value="64">64 samples</option>
                    <option value="128">128 samples</option>
                    <option value="256">256 samples</option>
                    <option value="512">512 samples</option>
                    <option value="1024">1024 samples</option>
                    <option value="2048">2048 samples</option>
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'streaming' && (
              <div className="pref-section">
                <h3 className="pref-section-title">Streaming</h3>

                <div className="pref-row">
                  <label className="pref-label">Built-in Streaming</label>
                  <div className="pref-toggle-row">
                    <label className="pref-toggle">
                      <input
                        type="checkbox"
                        checked={streamingEnabled}
                        onChange={e => setStreamingEnabled(e.target.checked)}
                      />
                      <span className="pref-toggle-slider" />
                    </label>
                    <span className="pref-toggle-label">
                      {streamingEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>
                <p className="pref-hint">
                  When enabled, the Artist can stream the stereo master output to the online Engineer
                  in real-time using ListenTo-style WebRTC audio.
                </p>

                <div className="pref-row" style={{ marginTop: 16 }}>
                  <label className="pref-label">Stream Quality</label>
                  <div className="pref-static-value">510 kbps stereo Opus (fixed)</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="pref-footer">
          <button className="pref-btn pref-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="pref-btn pref-btn-save" onClick={handleSave}>Apply & Close</button>
        </div>
      </div>
    </div>
  );
};

export default PreferencesDialog;
