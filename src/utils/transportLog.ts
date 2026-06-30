export type TransportEventType =
  | 'play' | 'stop' | 'record' | 'seek'
  | 'device_change' | 'device_disconnected'
  | 'crash_recovery' | 'engine_error'
  | 'stall_detected' | 'stall_recovered'
  | 'autosave' | 'autosave_restored'
  | 'recording_start' | 'recording_stop' | 'recording_recovered' | 'recording_discarded'
  | 'disk_space_warning' | 'wav_integrity_fail'
  | 'sample_rate_mismatch';

export interface TransportEvent {
  type: TransportEventType;
  timestamp: number;
  detail?: Record<string, unknown>;
}

const MAX_EVENTS = 500;
const events: TransportEvent[] = [];

export function logTransport(type: TransportEventType, detail?: Record<string, unknown>): void {
  events.push({ type, timestamp: Date.now(), detail });
  if (events.length > MAX_EVENTS) events.shift();
}

export function getTransportLog(): Readonly<TransportEvent[]> {
  return events;
}

if (typeof window !== 'undefined') {
  (window as any).__transportLog = { events, log: logTransport };
}
