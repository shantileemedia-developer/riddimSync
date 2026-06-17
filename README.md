# StudioDESK

**Professional audio collaboration for recording engineers and artists.**

StudioDESK is a Cubase-style DAW collaboration app that connects recording engineers and artists in real-time — wherever they are in the world. Engineers control the session, artists record, and everything stays in sync.

---

## Features

- **Cubase-style DAW** — Multi-track arrange window, waveform display, loop/punch-in markers, snap grid, timeline ruler
- **Real-time transport sync** — Engineer presses Record, artist's transport rolls simultaneously via WebRTC
- **Video call + chat** — Built-in video/audio call between engineer and artist, with in-session text chat
- **Remote control** — Engineer can take control of the artist's mouse and keyboard (AnyDesk-style), with artist consent
- **ListenTo-style streaming** — Artist streams their DAW output live to the engineer for real-time monitoring
- **Audio interface selection** — Hardware Setup dialog (F4) to pick input/output device, sample rate, and buffer size
- **WAV mixdown export** — File > Export Audio Mixdown renders all tracks to a 32-bit float WAV
- **Local project save/load** — Save project.json + Audio folder to any local directory via the File System Access API
- **Import Audio** — Drag audio files onto the arrange window or use File > Import Audio File
- **Mixer panel** — Per-track faders, pan, mute/solo with live VU meters
- **Media pool** — Manage recorded takes, preview, delete, export as FLAC+ZIP
- **MIDI device listing** — Audio/MIDI Preferences shows connected MIDI in/out ports
- **Notepad** — Per-project session notes (Project > Notepad)

---

## Download

**[Download for Windows (v0.0.0)](https://github.com/shantileemedia-developer/studiodesk/releases/download/v0.0.0/StudioDESK-Setup-0.0.0.exe)**

> **Note:** Windows SmartScreen may show a warning on first launch. Click **"More info"** then **"Run anyway"** — this is normal for new apps without a paid code signing certificate.

Or **[Launch the Web App](https://studiodesk.vercel.app)** — no install required (Chrome or Edge recommended).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8 |
| Desktop shell | Electron 42 |
| Backend / realtime | Supabase (Auth + Realtime channels) |
| Audio | Web Audio API, WebCodecs, MediaStream |
| Video + RC | WebRTC (peer-to-peer) |
| Packaging | electron-builder (NSIS installer) |

---

## Development Setup

```bash
# 1. Clone the repo
git clone https://github.com/shantileemedia-developer/studiodesk.git
cd studiodesk

# 2. Install dependencies
npm install

# 3. Create a .env file with your Supabase credentials
cp .env.example .env
# Edit .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 4. Run in development (Electron + Vite hot reload)
npm run dev

# 5. Build the Windows installer
npm run electron:build
```

The installer will be output to `dist-desktop/StudioDESK-Setup-{version}.exe`.

---

## Project Structure

```
src/
  components/
    auth/          — Login / signup screen
    daw/           — All DAW components (arrange, mixer, transport, menus…)
    landing/       — Landing page
    session/       — Session create/join screen
  context/
    DawContext.tsx — Central state (useReducer) for all DAW state
  hooks/
    useAudioEngine — Web Audio playback/recording engine
    useWebRTC      — Video call, screen share, remote control
    useDawSync     — Supabase realtime state sync between peers
    useAudioStream — ListenTo-style live audio streaming
  utils/
    exportUtils    — WAV mixdown renderer (OfflineAudioContext)
    audioUtils     — Waveform peak extraction helpers
electron/
  main.ts          — Electron main process
```

---

## License

MIT © 2025 Shantel Bradford
