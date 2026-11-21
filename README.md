# Pic2Video — Picture + Prompt → Video

A single-page Progressive Web App (PWA). Pick a picture, type a prompt
("slow zoom in, warm sunset glow, cinematic"), and get a real video file you
can save to your camera roll.

No build step, no backend, no dependencies — plain HTML/CSS/JS.

## Two engines

| Engine | Needs | Output |
|---|---|---|
| **On-device (free)** | Nothing. Works offline. | Real MP4/WebM rendered in-browser via `<canvas>` + `MediaRecorder`, animated from prompt keywords (zoom, pan, drift, shake, color grade, bloom, letterbox). |
| **AI model** | Your own API key | A generative image-to-video clip from fal.ai or Replicate (e.g. Kling, Wan). Key is stored only in your device's localStorage. |

### Prompt keywords (on-device engine)

- Motion: `zoom in` / `zoom out`, `pan left|right|up|down`, `drift`, `shake`, `gentle`, `fast`, `slow`
- Look: `warm / sunset / golden`, `night / cool / blue`, `vintage / sepia`, `dramatic`, `dreamy / glow`, `cinematic / letterbox`

Any prompt works — unknown words default to a smooth zoom-in so you never get
a dead-still clip.

## Run locally

```bash
cd pic2video
python3 -m http.server 8000
# open http://localhost:8000
```

Serve over HTTP(S) — the PWA install prompt and camera/file APIs need a
secure or localhost context.

## Install on your phone after deploying

- **Android (Chrome):** open the site → menu (⋮) → **Install app** / **Add to Home screen**.
- **iPhone (Safari):** open the site → Share → **Add to Home Screen**.

The app then launches full-screen like a native app and works offline
(service worker caches the shell; AI mode still needs network).

## Deploy (free hosting)

1. Push this folder to a GitHub repository.
2. Either:
   - **GitHub Pages:** Settings → Pages → Deploy from branch → main, root.
     If the app lives in a subfolder, point Pages at that folder or put its
     files at the repo root.
   - **Vercel / Netlify:** import the repo and deploy as a static site —
     zero config.

## AI mode setup

1. Pick the provider tab → **Engine → AI model**.
2. Paste your key (fal.ai: account → API keys; Replicate: account → API tokens).
   It is saved in localStorage and never sent anywhere except that provider.
3. Model id defaults to `fal-ai/kling-video/v1.5/standard/image-to-video`
   (fal) — change it to any image-to-video endpoint id you have access to.
   On Replicate, use an official model like `wan-video/wan-2.5-i2v-fast`.

Costs are billed to your own provider account. On-device mode is always free.

## Browser support

- Video recording: Chrome/Edge 49+, Safari 15+, Firefox 113+.
- iOS Safari records MP4 (H.264); Chromium browsers may produce WebM.
  Both preview and save correctly on the phone.
