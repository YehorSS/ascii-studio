"use strict";

const copy = {
  ru: {
    preview: "Превью", drop: "Перетащи фото или видео", local: "Локальная обработка", settings: "Настройки",
    open: "Открыть файл", source: "Фото или видео", detail: "Детализация", rough: "Крупно", fine: "Мелко",
    palette: "Палитра", green: "Фосфор", original: "Исходная", mono: "Моно", export: "Экспорт", position: "Позиция видео",
    play: "Воспроизвести", pause: "Пауза", demo: "Демо · андроид", cancel: "Отменить", loading: "Открываем файл…",
    invalid: "Браузер не смог открыть этот файл. Попробуй обычное фото или видео в MP4 или WebM.",
    failed: "Не получилось сохранить файл.", unsupported: "В этом браузере доступен экспорт только отдельных кадров.",
    encoding: "Записываем видео с начала. Оставь вкладку открытой.", saved: "Файл готов.", canceled: "Экспорт отменён.", scroll: "Прокрутка страницы",
  },
  en: {
    preview: "Preview", drop: "Drop a photo or video", local: "Processed locally", settings: "Settings",
    open: "Open file", source: "Photo or video", detail: "Detail", rough: "Coarse", fine: "Fine",
    palette: "Palette", green: "Phosphor", original: "Original", mono: "Mono", export: "Export", position: "Video position",
    play: "Play", pause: "Pause", demo: "Demo · android", cancel: "Cancel", loading: "Opening file…",
    invalid: "Your browser could not open this file. Try a common image format, MP4 or WebM.",
    failed: "Could not save the file.", unsupported: "This browser can export still frames only.",
    encoding: "Recording from the start. Keep this tab open.", saved: "File ready.", canceled: "Export canceled.", scroll: "Page scroll",
  },
};

const byId = id => document.getElementById(id);
const art = byId("art");
const zone = byId("drop-zone");
const detail = byId("detail");
const seek = byId("seek");
const paletteInputs = [...document.querySelectorAll("[name=palette]")];
const context = art.getContext("2d");
const sample = document.createElement("canvas");
const sampling = sample.getContext("2d", { willReadFrequently: true });
const glyphs = " .,:;!+*#%@";
const monoFont = '14px "Cascadia Mono", Consolas, monospace';

let language = "ru";
let statusKey = "";
let source;
let loading = false;
let loadGeneration = 0;
let frameID;
let renderQueued = false;
let frame;
let movieFormat;
let recording;
let audio;

const translate = key => copy[language][key] ?? "";

function notify(key) {
  statusKey = key;
  byId("status").textContent = translate(key);
}

function switchLanguage(next) {
  language = next;
  document.documentElement.lang = next;
  for (const item of document.querySelectorAll("[data-t]")) item.textContent = translate(item.dataset.t);
  for (const item of document.querySelectorAll("[data-aria]")) item.setAttribute("aria-label", translate(item.dataset.aria));
  for (const button of document.querySelectorAll("[data-lang]")) button.ariaPressed = String(button.dataset.lang === next);
  notify(statusKey);
  updateControls();
}

function timestamp(seconds) {
  const whole = Math.floor(seconds || 0);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function updateTime() {
  if (!source?.video) return;
  const video = source.media;
  seek.value = video.currentTime;
  byId("time").textContent = `${timestamp(video.currentTime)} / ${timestamp(video.duration)}`;
  if (recording) byId("progress").value = video.currentTime / video.duration;
}

function updateControls() {
  const video = source?.video ? source.media : null;
  const locked = Boolean(recording) || loading;
  byId("open").disabled = locked;
  byId("file").disabled = locked;
  detail.disabled = locked;
  for (const input of paletteInputs) input.disabled = locked;
  for (const id of ["png", "html", "movie"]) byId(id).disabled = locked || !frame;
  byId("transport").hidden = !video;
  byId("movie").hidden = !video || !movieFormat;
  if (movieFormat) byId("movie").textContent = movieFormat.extension.toUpperCase();
  byId("recording").hidden = !recording;
  byId("play").textContent = translate(video && !video.paused ? "pause" : "play");
  byId("play").disabled = locked;
  seek.disabled = locked;
  byId("filename").textContent = source?.demo ? translate("demo") : source?.name ?? "";
}

function render() {
  if (!source) return;
  const { media, width, height } = source;
  const columns = Number(detail.value);
  const mode = paletteInputs.find(input => input.checked).value;
  context.font = monoFont;
  const cellWidth = Math.ceil(context.measureText("M").width);
  const cellHeight = 14;
  const rows = Math.max(1, Math.min(420, Math.round(columns * height / width * cellWidth / cellHeight)));
  if (sample.width !== columns || sample.height !== rows) {
    sample.width = columns;
    sample.height = rows;
    art.width = columns * cellWidth;
    art.height = rows * cellHeight;
  }
  sampling.fillStyle = "#080c0a";
  sampling.fillRect(0, 0, columns, rows);
  sampling.drawImage(media, 0, 0, columns, rows);
  const rgba = sampling.getImageData(0, 0, columns, rows).data;
  context.fillStyle = "#080c0a";
  context.fillRect(0, 0, art.width, art.height);
  context.font = monoFont;
  context.textBaseline = "middle";
  context.textAlign = "center";
  const cells = [];
  const sameGrid = source.video && frame?.columns === columns && frame?.rows === rows && frame?.mode === mode;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x;
      const offset = index * 4;
      const r = rgba[offset];
      const g = rgba[offset + 1];
      const b = rgba[offset + 2];
      const density = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 * (glyphs.length - 1);
      const last = sameGrid ? frame.cells[index].level : -1;
      const level = last >= 0 && Math.abs(density - last) < 0.69 ? last : Math.round(density);
      const char = glyphs[level];
      const color = mode === "green" ? "#55e477" : mode === "mono" ? "#e2eee6" : `rgb(${r},${g},${b})`;
      cells.push({ char, color, level });
      if (!level) continue;
      context.fillStyle = color;
      context.fillText(char, (x + 0.5) * cellWidth, (y + 0.54) * cellHeight);
    }
  }
  frame = { cells, columns, rows, mode };
  byId("dimensions").textContent = `${columns} × ${rows}`;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function stopFrames(video) {
  if (frameID === undefined) return;
  if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameID);
  else cancelAnimationFrame(frameID);
  frameID = undefined;
}

function playFrames(video) {
  stopFrames(video);
  const next = () => {
    frameID = undefined;
    if (source?.media !== video) return;
    render();
    updateTime();
    if (!video.paused && !video.ended) playFrames(video);
  };
  frameID = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(next) : requestAnimationFrame(next);
}

function disposeSource() {
  if (!source) return;
  if (source.video) {
    const video = source.media;
    stopFrames(video);
    video.pause();
    video.removeAttribute("src");
    video.load();
    audio?.context.close().catch(() => {});
    audio = undefined;
  }
  if (!source.demo) URL.revokeObjectURL(source.url);
  source = undefined;
  frame = undefined;
}

function videoEvents(video) {
  seek.max = video.duration;
  video.addEventListener("play", () => {
    if (source?.media !== video) return;
    updateControls();
    playFrames(video);
  });
  video.addEventListener("pause", () => {
    if (source?.media !== video) return;
    stopFrames(video);
    updateControls();
  });
  video.addEventListener("seeked", () => {
    if (source?.media !== video) return;
    frame = undefined;
    render();
    updateTime();
  });
  video.addEventListener("ended", () => {
    if (source?.media !== video) return;
    render();
    updateTime();
    updateControls();
    stopRecording("saved");
  });
}

function mediaReady(media, event, url) {
  return new Promise((resolve, reject) => {
    media.addEventListener(event, resolve, { once: true });
    media.addEventListener("error", reject, { once: true });
    media.src = url;
  });
}

async function load(file) {
  if (recording) return;
  const generation = ++loadGeneration;
  const url = file ? URL.createObjectURL(file) : "demo.webp";
  const video = Boolean(file && (file.type.startsWith("video/") || /\.(mp4|m4v|webm|mov|ogv|mkv)$/i.test(file.name)));
  const media = video ? document.createElement("video") : new Image();
  if (video) {
    media.preload = "auto";
    media.playsInline = true;
  }
  loading = true;
  updateControls();
  if (file) notify("loading");
  try {
    await mediaReady(media, video ? "loadeddata" : "load", url);
    if (generation !== loadGeneration) {
      if (file) URL.revokeObjectURL(url);
      return;
    }
    const width = video ? media.videoWidth : media.naturalWidth;
    const height = video ? media.videoHeight : media.naturalHeight;
    if (!width || !height || (video && (!Number.isFinite(media.duration) || media.duration <= 0))) throw new Error("Invalid media");
    disposeSource();
    source = { url, media, width, height, name: file?.name, demo: !file, video };
    if (video) videoEvents(media);
    delete zone.dataset.empty;
    render();
    updateTime();
    notify(video && !movieFormat ? "unsupported" : "");
  } catch {
    if (file) URL.revokeObjectURL(url);
    if (generation === loadGeneration) {
      if (!source) zone.dataset.empty = "";
      if (file) notify("invalid");
    }
  } finally {
    if (generation === loadGeneration) {
      loading = false;
      updateControls();
    }
  }
}

function save(blob, extension) {
  if (!blob?.size) {
    notify("failed");
    return;
  }
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${source?.name?.replace(/\.[^.]+$/, "") || "android"}-ascii.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  notify("saved");
}

function saveHtml() {
  const { cells, rows, columns } = frame;
  let content = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const { char, color } = cells[y * columns + x];
      content += char === " " ? char : `<span style="color:${color}">${char}</span>`;
    }
    content += "\n";
  }
  const html = `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ASCII Studio</title><style>body{background:#080c0a;color:#e2eee6;margin:16px}pre{font:14px/1 'Cascadia Mono',Consolas,monospace;width:max-content;margin:auto}</style><pre>${content}</pre></html>`;
  save(new Blob([html], { type: "text/html;charset=utf-8" }), "html");
}

function stopRecording(outcome) {
  if (!recording || recording.outcome) return;
  recording.outcome = outcome;
  source.media.pause();
  if (recording.recorder?.state !== "inactive") recording.recorder?.stop();
}

function finishRecording(job) {
  if (recording !== job) return;
  const video = source.media;
  video.pause();
  job.stream?.getVideoTracks().forEach(track => track.stop());
  recording = undefined;
  video.currentTime = job.position;
  if (job.outcome === "saved") save(new Blob(job.chunks, { type: job.recorder.mimeType }), movieFormat.extension);
  else notify(job.outcome || "failed");
  updateControls();
  if (job.resume) video.play().catch(() => {});
}

async function recordVideo() {
  if (!movieFormat || recording || !source?.video) return;
  const video = source.media;
  const job = { position: video.currentTime, resume: !video.paused, chunks: [] };
  recording = job;
  video.pause();
  notify("encoding");
  byId("progress").value = 0;
  updateControls();
  try {
    if (!audio) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      const context = new Audio();
      const element = context.createMediaElementSource(video);
      const destination = context.createMediaStreamDestination();
      element.connect(destination);
      element.connect(context.destination);
      audio = { context, destination };
    }
    await audio.context.resume();
    if (job.outcome) return finishRecording(job);
    if (video.currentTime !== 0) {
      const start = new Promise(resolve => video.addEventListener("seeked", resolve, { once: true }));
      video.currentTime = 0;
      await start;
    }
    if (job.outcome) return finishRecording(job);
    render();
    job.stream = art.captureStream(30);
    for (const track of audio.destination.stream.getAudioTracks()) job.stream.addTrack(track);
    const recorder = new MediaRecorder(job.stream, { mimeType: movieFormat.mime, videoBitsPerSecond: 6000000 });
    job.recorder = recorder;
    recorder.ondataavailable = event => { if (event.data.size) job.chunks.push(event.data); };
    recorder.onstop = () => finishRecording(job);
    recorder.onerror = () => {
      job.outcome = "failed";
      finishRecording(job);
    };
    recorder.start(500);
    await video.play();
  } catch {
    if (job.recorder && job.recorder.state !== "inactive") stopRecording("failed");
    else finishRecording(job);
  }
}

if (window.MediaRecorder && art.captureStream && (window.AudioContext || window.webkitAudioContext)) {
  movieFormat = [
    { mime: "video/mp4;codecs=avc1.42001f,mp4a.40.2", extension: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", extension: "webm" },
    { mime: "video/webm;codecs=vp8,opus", extension: "webm" },
  ].find(format => MediaRecorder.isTypeSupported(format.mime));
}

byId("open").onclick = () => byId("file").click();
byId("file").onchange = event => {
  if (event.target.files[0]) load(event.target.files[0]);
  event.target.value = "";
};
detail.oninput = () => {
  byId("detail-value").value = detail.value;
  scheduleRender();
};
for (const input of paletteInputs) input.onchange = scheduleRender;
byId("play").onclick = () => {
  const video = source.media;
  if (video.paused) video.play().catch(() => notify("invalid"));
  else video.pause();
};
seek.oninput = () => { source.media.currentTime = Number(seek.value); };
byId("png").onclick = () => art.toBlob(blob => save(blob, "png"));
byId("html").onclick = saveHtml;
byId("movie").onclick = recordVideo;
byId("cancel").onclick = () => stopRecording("canceled");
for (const button of document.querySelectorAll("[data-lang]")) {
  button.onclick = () => {
    switchLanguage(button.dataset.lang);
    try { localStorage.setItem("ascii-language", language); } catch { /* Local file storage may be unavailable. */ }
  };
}

zone.addEventListener("dragover", event => {
  event.preventDefault();
  event.dataTransfer.dropEffect = recording ? "none" : "copy";
  if (!recording) zone.dataset.drag = "";
});
zone.addEventListener("dragleave", event => {
  if (!zone.contains(event.relatedTarget)) delete zone.dataset.drag;
});
zone.addEventListener("drop", event => {
  event.preventDefault();
  delete zone.dataset.drag;
  if (event.dataTransfer.files[0]) load(event.dataTransfer.files[0]);
});
window.addEventListener("dragover", event => event.preventDefault());
window.addEventListener("drop", event => event.preventDefault());

const scrollControl = byId("scroll");
const scrollExtent = () => document.documentElement.scrollHeight - innerHeight;
function updateScroll() {
  const extent = scrollExtent();
  scrollControl.hidden = extent <= 0;
  if (extent > 0) scrollControl.value = Math.round(scrollY / extent * 1000);
}
scrollControl.oninput = () => scrollTo(0, Number(scrollControl.value) / 1000 * scrollExtent());
window.addEventListener("scroll", updateScroll, { passive: true });
window.addEventListener("resize", updateScroll);
new ResizeObserver(updateScroll).observe(document.querySelector("main"));

let preferred;
try { preferred = localStorage.getItem("ascii-language"); } catch { /* Local file storage may be unavailable. */ }
switchLanguage(preferred === "en" ? "en" : "ru");
load();
