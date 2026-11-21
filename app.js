/* Pic2Video — picture + prompt → video
 * Two engines:
 *  1. Local: prompt-driven cinematic animation rendered on <canvas> and
 *     recorded with MediaRecorder. No server, no keys, works offline.
 *  2. AI:   calls an image-to-video model (fal.ai or Replicate) with the
 *     user's own API key. The key stays in localStorage on this device.
 */

"use strict";

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const dropzone = $("dropzone");
const previewThumb = $("previewThumb");
const dropHint = $("dropHint");
const promptInput = $("promptInput");
const generateBtn = $("generateBtn");
const resultCard = $("resultCard");
const resultVideo = $("resultVideo");
const statusMsg = $("statusMsg");
const downloadBtn = $("downloadBtn");
const renderCanvas = $("renderCanvas");
const durationRange = $("durationRange");
const fpsSelect = $("fpsSelect");
const durVal = $("durVal");
const providerSelect = $("providerSelect");
const modelInput = $("modelInput");
const aiKeyInput = $("keyInput");

let imageBitmap = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- UI wiring ---------- */
durationRange.addEventListener("input", () => (durVal.textContent = durationRange.value + "s"));

document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    promptInput.value = (promptInput.value.trim() + " " + chip.dataset.add).trim();
    promptInput.focus();
  })
);

$("btnLocal").addEventListener("click", () => switchEngine(true));
$("btnAI").addEventListener("click", () => switchEngine(false));

function switchEngine(local) {
  $("btnLocal").classList.toggle("active", local);
  $("btnAI").classList.toggle("active", !local);
  $("localOptions").hidden = !local;
  $("aiOptions").hidden = local;
  aiKeyInput.value = localStorage.getItem("p2v_key_" + providerSelect.value) || "";
}

fileInput.addEventListener("change", () => fileInput.files[0] && loadImage(fileInput.files[0]));

["dragover", "dragenter"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); })
);
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadImage(f);
});

async function loadImage(file) {
  if (!file.type.startsWith("image/")) { setStatus("That file is not an image.", true); return; }
  try {
    imageBitmap = await createImageBitmap(file);
    previewThumb.src = URL.createObjectURL(file);
    previewThumb.hidden = false;
    dropHint.hidden = true;
    generateBtn.disabled = false;
    setStatus("");
  } catch {
    setStatus("Could not read that image.", true);
  }
}

function setStatus(msg, isErr = false) {
  statusMsg.textContent = msg;
  statusMsg.classList.toggle("err", isErr);
}

/* ---------- Engine settings persistence ---------- */
providerSelect.addEventListener("change", () => {
  modelInput.value = defaultModel(providerSelect.value);
  aiKeyInput.value = localStorage.getItem("p2v_key_" + providerSelect.value) || "";
});

aiKeyInput.addEventListener("input", () => {
  localStorage.setItem("p2v_key_" + providerSelect.value, aiKeyInput.value.trim());
});

function defaultModel(provider) {
  return provider === "fal"
    ? "fal-ai/kling-video/v1.5/standard/image-to-video"
    : "wan-video/wan-2.5-i2v-fast";
}

function saveEngineSettings() {
  localStorage.setItem(
    "p2v_engine",
    JSON.stringify({ provider: providerSelect.value, model: modelInput.value })
  );
}
providerSelect.addEventListener("change", saveEngineSettings);
modelInput.addEventListener("change", saveEngineSettings);

(function restoreEngineSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("p2v_engine") || "null");
    if (s) {
      providerSelect.value = s.provider;
      modelInput.value = s.model || defaultModel(s.provider);
    }
    aiKeyInput.value = localStorage.getItem("p2v_key_" + providerSelect.value) || "";
  } catch {}
})();

function fileToDataUri(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* =========================================================
 * LOCAL ENGINE — prompt → motion plan → canvas animation → video
 * ========================================================= */

function parsePrompt(prompt) {
  const t = prompt.toLowerCase();
  const plan = {
    zoom: "none", zoomAmount: 0.18,
    pan: "none", panAmount: 0.07,
    shake: 0, drift: 0,
    letterbox: false, bloom: false,
    grade: null,
  };
  const has = (...words) => words.some((w) => t.includes(w));

  if (has("zoom in", "push in", "closer")) plan.zoom = "in";
  else if (has("zoom out", "pull out", "pull back")) plan.zoom = "out";
  if (has("pan left", "move left")) plan.pan = "left";
  else if (has("pan right", "move right")) plan.pan = "right";
  else if (has("pan up", "tilt up", "upward", "drift up")) plan.pan = "up";
  else if (has("pan down", "tilt down", "downward", "drift down")) plan.pan = "down";
  if (has("shake", "tremble", "earthquake")) plan.shake = 1;
  if (has("float", "breathe", "life", "alive", "gentle")) plan.drift = 1;
  if (has("cinematic", "letterbox", "movie", "film")) plan.letterbox = true;
  if (has("dreamy", "glow", "bloom", "soft")) plan.bloom = true;
  if (has("warm", "golden", "sunset", "sunny")) plan.grade = "warm";
  else if (has("cool", "cold", "night", "blue", "moon")) plan.grade = "cool";
  else if (has("vintage", "sepia", "old", "retro")) plan.grade = "vintage";
  else if (has("dramatic", "contrast", "moody")) plan.grade = "contrast";

  if (plan.zoom === "none" && plan.pan === "none" && !plan.shake && !plan.drift) {
    plan.zoom = "in"; /* never render a dead-still clip */
  }
  return plan;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function pickMime() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || null;
}

function renderLocal(plan, durationSec, fps, onProgress) {
  return new Promise((resolve, reject) => {
    const src = imageBitmap;
    const outW = Math.round(src.width / 2) * 2;
    const outH = Math.round(src.height / 2) * 2;
    renderCanvas.width = outW;
    renderCanvas.height = outH;
    const ctx = renderCanvas.getContext("2d");

    const mime = pickMime();
    if (!mime) {
      reject(new Error("Video recording is not supported in this browser. Try Chrome, Edge, or Safari 15+."));
      return;
    }
    const stream = renderCanvas.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const gradeColors = {
      warm:     ["rgba(255,160,60,0.18)", "multiply"],
      cool:     ["rgba(40,90,220,0.22)", "multiply"],
      vintage:  ["rgba(112,66,20,0.28)", "multiply"],
      contrast: ["rgba(10,10,25,0.15)", "multiply"],
    };

    function drawFrame(now) {
      const t = Math.min(now / (durationSec * 1000), 1);
      const e = easeInOut(t);

      const zoomT = plan.zoom === "in" ? e : plan.zoom === "out" ? 1 - e : 0;
      const scale = 1.02 + plan.zoomAmount * zoomT;

      const panT = plan.pan === "none" ? 0 : e;
      let dx = 0, dy = 0;
      if (plan.pan === "left") dx = -plan.panAmount * panT;
      if (plan.pan === "right") dx = plan.panAmount * panT;
      if (plan.pan === "up") dy = -plan.panAmount * panT;
      if (plan.pan === "down") dy = plan.panAmount * panT;

      if (plan.drift) { dx += 0.006 * Math.sin(now / 900); dy += 0.006 * Math.cos(now / 1100); }
      if (plan.shake) { dx += 0.004 * Math.sin(now / 42); dy += 0.004 * Math.cos(now / 37); }

      ctx.save();
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, outW, outH);
      ctx.translate(outW / 2, outH / 2);
      ctx.scale(scale, scale);
      ctx.translate(dx * outW, dy * outH);
      ctx.drawImage(src, -outW / 2, -outH / 2, outW, outH);
      ctx.restore();

      const grade = gradeColors[plan.grade];
      if (grade) {
        ctx.globalCompositeOperation = grade[1];
        ctx.fillStyle = grade[0];
        ctx.fillRect(0, 0, outW, outH);
        ctx.globalCompositeOperation = "source-over";
      }

      if (plan.bloom) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.10 + 0.05 * Math.sin(now / 700);
        ctx.filter = "blur(18px)";
        ctx.drawImage(renderCanvas, 0, 0);
        ctx.restore();
      }

      const vg = ctx.createRadialGradient(
        outW / 2, outH / 2, Math.min(outW, outH) * 0.25,
        outW / 2, outH / 2, Math.max(outW, outH) * 0.75
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, outW, outH);

      if (plan.letterbox) {
        const bar = outH * 0.07;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, outW, bar);
        ctx.fillRect(0, outH - bar, outW, bar);
      }

      onProgress(t);
      if (t < 1) requestAnimationFrame(drawFrame);
      else setTimeout(() => rec.state !== "inactive" && rec.stop(), 120);
    }

    rec.onerror = (e) => reject(e.error || new Error("Recording failed"));
    rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
    rec.start(200);
    requestAnimationFrame(drawFrame);
  });
}

/* =========================================================
 * AI ENGINE — image + prompt → provider API → video URL
 * ========================================================= */

async function generateWithFal(key, model, prompt, imageUri, onStatus) {
  const start = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_url: imageUri }),
  });
  if (!start.ok) throw new Error(`fal.ai error ${start.status}: ${(await start.text()).slice(0, 300)}`);
  const { status_url, response_url } = await start.json();

  while (true) {
    await sleep(2500);
    const j = await (await fetch(status_url, { headers: { Authorization: `Key ${key}` } })).json();
    onStatus(`AI status: ${j.status}`);
    if (j.status === "IN_QUEUE" || j.status === "IN_PROGRESS") continue;
    if (j.status === "COMPLETED") {
      const r = await (await fetch(response_url, { headers: { Authorization: `Key ${key}` } })).json();
      const url = r.video?.url || (r.videos && r.videos[0] && r.videos[0].url);
      if (!url) throw new Error("Model finished but returned no video: " + JSON.stringify(r).slice(0, 300));
      return url;
    }
    throw new Error(`AI job failed: ${j.status}`);
  }
}

async function generateWithReplicate(key, model, prompt, imageUri, onStatus) {
  const startRes = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: { prompt, image: imageUri } }),
  });
  let pred = await startRes.json();
  if (!pred.id) throw new Error("Replicate error: " + JSON.stringify(pred).slice(0, 300));

  while (pred.status === "starting" || pred.status === "processing") {
    await sleep(2500);
    pred = await (
      await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
        headers: { Authorization: `Bearer ${key}` },
      })
    ).json();
    onStatus(`AI status: ${pred.status}`);
  }
  if (pred.status !== "succeeded") throw new Error("Replicate job failed: " + pred.status);
  const out = Array.isArray(pred.output) ? pred.output[pred.output.length - 1] : pred.output;
  if (!out) throw new Error("Model returned no video");
  return out;
}

/* =========================================================
 * MAIN GENERATE FLOW
 * ========================================================= */

generateBtn.addEventListener("click", async () => {
  if (!imageBitmap) return;
  const prompt = promptInput.value.trim();
  if (!prompt) { setStatus("Add a prompt describing the motion.", true); return; }

  generateBtn.disabled = true;
  resultCard.hidden = false;
  resultVideo.hidden = true;
  downloadBtn.hidden = true;
  resultVideo.removeAttribute("src");

  try {
    const isLocal = $("btnLocal").classList.contains("active");
    let blob, ext;

    if (isLocal) {
      const plan = parsePrompt(prompt);
      blob = await renderLocal(
        plan,
        +durationRange.value,
        +fpsSelect.value,
        (t) => setStatus(`Rendering on-device… ${Math.round(t * 100)}%`)
      );
      ext = blob.type.includes("mp4") ? "mp4" : "webm";
    } else {
      const key = aiKeyInput.value.trim();
      if (!key) throw new Error("Paste your API key first (Engine → AI model).");
      setStatus("Uploading image to " + providerSelect.value + "…");
      const imageUri = fileInput.files[0] ? await fileToDataUri(fileInput.files[0]) : null;
      const gen = providerSelect.value === "fal" ? generateWithFal : generateWithReplicate;
      const url = await gen(key, modelInput.value, prompt, imageUri, (s) => setStatus(s));
      setStatus("Downloading video…");
      blob = await (await fetch(url)).blob();
      ext = blob.type.includes("mp4") ? "mp4" : "webm";
    }

    const blobUrl = URL.createObjectURL(blob);
    resultVideo.src = blobUrl;
    resultVideo.hidden = false;
    downloadBtn.href = blobUrl;
    downloadBtn.download = `pic2video-${Date.now()}.${ext}`;
    downloadBtn.hidden = false;
    setStatus(`Done — ${(blob.size / 1e6).toFixed(1)} MB`);
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Generation failed.", true);
  } finally {
    generateBtn.disabled = false;
  }
});
