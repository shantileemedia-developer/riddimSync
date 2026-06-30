export type AudioErrorCode =
  | 'DEVICE_BUSY'
  | 'SAMPLE_RATE_MISMATCH'
  | 'BUFFER_SIZE_UNSUPPORTED'
  | 'DRIVER_FAILED'
  | 'INPUT_UNAVAILABLE'
  | 'OUTPUT_UNAVAILABLE'
  | 'ADDON_MISSING'
  | 'BACKEND_UNAVAILABLE'
  | 'RECORDING_FAILED'
  | 'PLAYBACK_FAILED'
  | 'UNKNOWN';

export type AudioErrorSeverity = 'error' | 'warning';

export interface AudioEngineError {
  code: AudioErrorCode;
  severity: AudioErrorSeverity;
  userMessage: string;
  technicalMessage: string;
  backend: 'ASIO' | 'WASAPI' | 'WebAudio' | 'unknown';
  deviceName?: string;
  sampleRate?: number;
  timestamp: number;
}

const USER_MESSAGES: Record<AudioErrorCode, string> = {
  DEVICE_BUSY:
    'Your ASIO device is already in use by another app. Close Cubase, FL Studio, browser audio tabs, or your interface control panel, then try again.',
  SAMPLE_RATE_MISMATCH:
    'Your audio interface is running at a different sample rate than this project. Set both to 44.1 kHz or 48 kHz in your interface driver settings.',
  BUFFER_SIZE_UNSUPPORTED:
    'Your audio interface does not support the selected buffer size. Try a different buffer size in Audio/MIDI Preferences.',
  DRIVER_FAILED:
    'The audio driver failed to open. Reconnect your interface, update your driver, or choose a different device in Audio/MIDI Preferences.',
  INPUT_UNAVAILABLE:
    'The selected input device could not be opened. Check your connection or choose a different input in Audio/MIDI Preferences.',
  OUTPUT_UNAVAILABLE:
    'The selected output device could not be opened. Check your connection or choose a different output in Audio/MIDI Preferences.',
  ADDON_MISSING:
    'The native audio engine is not built yet. Run "node-gyp rebuild" in electron/native/, then restart the app.',
  BACKEND_UNAVAILABLE:
    'No audio backend is available. PortAudio could not initialize. Restart the app or reinstall your audio drivers.',
  RECORDING_FAILED:
    'Recording could not start. Check your input device connection and try again.',
  PLAYBACK_FAILED:
    'Playback could not start with the selected audio device. Choose another device or check your driver settings in Audio/MIDI Preferences.',
  UNKNOWN:
    'An audio engine error occurred. See technical details for more information.',
};

export function classifyAudioError(raw: string): Pick<AudioEngineError, 'code' | 'userMessage' | 'backend'> {
  const msg = raw.toLowerCase();

  let backend: AudioEngineError['backend'] = 'unknown';
  if (msg.includes('asio')) backend = 'ASIO';
  else if (msg.includes('wasapi')) backend = 'WASAPI';

  let code: AudioErrorCode = 'UNKNOWN';

  if (msg.includes('device unavailable') || msg.includes('device is in use') || (msg.includes('asio') && (msg.includes('unavailable') || msg.includes('busy')))) {
    code = 'DEVICE_BUSY';
    if (backend === 'unknown') backend = 'ASIO';
  } else if (msg.includes('invalid sample rate') || msg.includes('sample rate')) {
    code = 'SAMPLE_RATE_MISMATCH';
  } else if ((msg.includes('buffer') && msg.includes('size')) || msg.includes('frames per buffer')) {
    code = 'BUFFER_SIZE_UNSUPPORTED';
  } else if (msg.includes('input open failed') || msg.includes('input device') || msg.includes('instream')) {
    code = 'INPUT_UNAVAILABLE';
  } else if (msg.includes('output open failed') || msg.includes('output device') || msg.includes('outstream')) {
    code = 'OUTPUT_UNAVAILABLE';
  } else if (msg.includes('cannot open file') || msg.includes('record') && (msg.includes('fail') || msg.includes('error'))) {
    code = 'RECORDING_FAILED';
  } else if (msg.includes('pa_openstream') || msg.includes('pa_startstream') || msg.includes('driver')) {
    code = 'DRIVER_FAILED';
  } else if (msg.includes('play') && (msg.includes('fail') || msg.includes('error'))) {
    code = 'PLAYBACK_FAILED';
  } else if (msg.includes('initialize') || msg.includes('portaudio') || msg.includes('pa_init')) {
    code = 'BACKEND_UNAVAILABLE';
  }

  return { code, userMessage: USER_MESSAGES[code], backend };
}

export function makeAudioError(raw: string, overrides?: Partial<AudioEngineError>): AudioEngineError {
  const { code, backend } = classifyAudioError(raw);
  const finalCode = overrides?.code ?? code;
  return {
    code: finalCode,
    severity: 'error',
    userMessage: USER_MESSAGES[finalCode],
    technicalMessage: raw,
    backend,
    timestamp: Date.now(),
    ...overrides,
  };
}
