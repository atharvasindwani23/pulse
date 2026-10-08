# Pulse

A standalone local meeting companion. Pulse uses your microphone to provide live feedback on spoken words and vocal delivery, with optional camera movement cues processed on your device.

## Run locally

Use Node.js 24 and Chrome.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open http://127.0.0.1:5173 or http://127.0.0.1:5173/meeting. Supply your own OpenAI API key in the connection settings, or configure the variables shown in `.env.example` on the server. Your account needs access to the configured Realtime model and Decisions endpoint.

- **Try local feedback** runs microphone level and optional camera movement tracking without AI requests.
- **Start live analysis** connects your microphone to OpenAI Realtime, then sends the current phrase and cue descriptions to OpenAI Decisions.
- **Use spoken words** is on by default. Turn it off before starting to omit recognized words from scoring and display. Realtime still receives and can understand the audio.
- **Camera cues** enables local smile, brow and blink movement measurements. No camera frames are uploaded.
- **Stop capture** releases both microphone and camera and cancels pending analysis. Capture also stops when the page closes.

## Feedback

The dashboard shows **Happy, Sad, Angry and Surprised**, with three finer shades for each. Recognized words and vocal delivery both contribute; a neutral face cannot veto clear emotional wording. The current phrase is shown under **Words heard**.

These are tentative descriptions of expression, not validated measurements of a person's feelings or micro-expressions. Low or conflicting scores stay **Neutral / unclear**; uncertain values appear as `—`. Facial movement alone does not produce an emotion reading.

Local microphone indicators update roughly every 50 ms. AI analysis collects approximately one-second audio segments and reuses up to four seconds of recent context. Requests run asynchronously, prioritize the newest pending segment, and suppress results older than five seconds. AI interpretation is not instantaneous.

## Data handling

- Pulse listens to your selected microphone; it does not read another app's notes, recordings, databases, or system audio.
- The dashboard key stays in tab memory and clears on reload. Optional server keys belong in environment variables, never source control.
- Microphone audio goes to OpenAI over WebRTC. Decisions receives text descriptions, optional recognized words and camera movement coefficients.
- Camera frames stay on your device. The bundled MediaPipe library and face model load locally.
- Pulse does not write keys, raw audio, video, recognized words, or session history to disk. Provider processing follows your API account's data settings and usage charges.

## Development

```sh
npm test
npm run typecheck
npm run build
```

- `app/meeting/`: dashboard and camera preview. The root route opens the same dashboard.
- `lib/meeting-engine.ts`: microphone lifecycle, WebRTC, request scheduling and local camera worker.
- `lib/meeting-context.ts`: bounded recent audio context.
- `lib/meeting-protocol.ts`: observation validation, scoring rubrics and response parsing.
- `app/api/openai/`: same-origin API proxies. Keys are used only for OpenAI requests.
- `public/pulse-meter.js`, `public/pulse-face.js`, `public/vision/`, `public/models/`: local signal processing and third-party camera assets.
- `tests/`: protocol and engine checks with synthetic fixtures. They test behavior, not emotion-recognition accuracy on arbitrary live audio.

This is a local prototype. Keep the server bound to loopback unless you add authentication and appropriate deployment protections.
