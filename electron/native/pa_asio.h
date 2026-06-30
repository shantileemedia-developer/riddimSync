/*
 * pa_asio.h — PortAudio ASIO-specific host API extensions.
 *
 * Minimal subset required by pa_callback.cc.  Types and function signatures
 * match the official PortAudio v19 pa_asio.h (MIT licence).
 *
 * All four functions below are confirmed present in the bundled portaudio_x64.dll
 * (verified by binary string scan of naudiodon/portaudio/bin/portaudio_x64.dll).
 *
 *   PaAsio_GetAvailableBufferSizes   — query device's min/max/preferred buffer size
 *   PaAsio_GetInputChannelName       — driver-reported channel name for UI
 *   PaAsio_GetOutputChannelName
 *   PaAsio_ShowControlPanel          — open the ASIO driver's settings dialog
 */

#ifndef PA_ASIO_H
#define PA_ASIO_H

#include <portaudio.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── PaAsioStreamInfo ────────────────────────────────────────────────────────
 *
 * Pass as hostApiSpecificStreamInfo in PaStreamParameters to enable
 * ASIO-specific features.  The most important flag is paAsioUseChannelSelectors:
 * it lets you open exactly the channels you need rather than all device channels,
 * which avoids allocating DMA buffers for unused ASIO channels.
 *
 * Usage:
 *   long sel = inputChOffset;
 *   PaAsioStreamInfo ai = { sizeof(PaAsioStreamInfo), paASIO, 1,
 *                           paAsioUseChannelSelectors, &sel };
 *   inParams.channelCount = 1;           // one channel — the selected one
 *   inParams.hostApiSpecificStreamInfo = &ai;
 */
typedef struct PaAsioStreamInfo {
    unsigned long   size;             /* sizeof(PaAsioStreamInfo) */
    PaHostApiTypeId hostApiType;      /* paASIO */
    unsigned long   version;          /* 1 */
    unsigned long   flags;
    const long     *channelSelectors; /* array; one entry per stream channel */
} PaAsioStreamInfo;

/* Flag: use the channelSelectors array to choose which ASIO channels to open. */
#define paAsioUseChannelSelectors  (0x01)

/* ── Buffer-size negotiation ─────────────────────────────────────────────────
 *
 * ASIO drivers have fixed or quantised buffer sizes.  Call this before
 * Pa_OpenStream to discover the device's preferred size.  Pass
 * paFramesPerBufferUnspecified (= 0) to Pa_OpenStream and let the driver pick,
 * or pass preferredBufferSizeFrames for a specific size.
 *
 * granularity == -1 means only power-of-two sizes are valid.
 */
PaError PaAsio_GetAvailableBufferSizes(PaDeviceIndex device,
    long *minBufferSizeFrames,
    long *maxBufferSizeFrames,
    long *preferredBufferSizeFrames,
    long *granularity);

/* ── Channel names ───────────────────────────────────────────────────────────
 *
 * Return the driver-reported channel name (e.g. "Analog 1").
 * The string is owned by the driver; do not free it.
 * Returns NULL if device or channelIndex is invalid.
 */
const char *PaAsio_GetInputChannelName(PaDeviceIndex device, int channelIndex);
const char *PaAsio_GetOutputChannelName(PaDeviceIndex device, int channelIndex);

/* ── Control panel ───────────────────────────────────────────────────────────
 *
 * Open the ASIO driver's own settings dialog (buffer size, clock source, etc.).
 * systemSpecific: pass NULL on Windows.
 * Must not be called while a stream using the device is open.
 */
PaError PaAsio_ShowControlPanel(PaDeviceIndex device, void *systemSpecific);

#ifdef __cplusplus
}
#endif

#endif /* PA_ASIO_H */
