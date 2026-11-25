"use strict";

const copy = {
  ru: {
    preview: "Превью", drop: "Перетащи фото, видео или GIF", local: "Локальная обработка", settings: "Настройки",
    open: "Открыть файл", source: "Фото, видео или GIF", detail: "Детализация", rough: "Крупно", fine: "Мелко", volume: "Громкость",
    palette: "Палитра", green: "Фосфор", original: "Исходная", mono: "Моно", export: "Экспорт", position: "Позиция видео",
    play: "Воспроизвести", pause: "Пауза", demo: "Демо · андроид", cancel: "Отменить", loading: "Открываем файл…",
    invalid: "Браузер не смог открыть этот файл. Попробуй обычное фото или видео в MP4 или WebM.",
    failed: "Не получилось сохранить файл.", unsupported: "В этом браузере доступен экспорт только отдельных кадров.",
    gifStill: "Браузер показал первый кадр GIF. Анимация GIF здесь недоступна.",
    removeBackground: "Убрать однотонный фон",
    encoding: "Обрабатываем кадры. Оставь вкладку открытой.", recording: "Записываем в реальном времени. Оставь вкладку открытой.",
    saved: "Файл готов.", canceled: "Экспорт отменён.", scroll: "Прокрутка страницы",
  },
  en: {
    preview: "Preview", drop: "Drop a photo, video or GIF", local: "Processed locally", settings: "Settings",
    open: "Open file", source: "Photo, video or GIF", detail: "Detail", rough: "Coarse", fine: "Fine", volume: "Volume",
    palette: "Palette", green: "Phosphor", original: "Original", mono: "Mono", export: "Export", position: "Video position",
    play: "Play", pause: "Pause", demo: "Demo · android", cancel: "Cancel", loading: "Opening file…",
    invalid: "Your browser could not open this file. Try a common image format, MP4 or WebM.",
    failed: "Could not save the file.", unsupported: "This browser can export still frames only.",
    gifStill: "This browser can show the first GIF frame only.",
    removeBackground: "Remove solid background",
    encoding: "Processing frames. Keep this tab open.", recording: "Recording in real time. Keep this tab open.",
    saved: "File ready.", canceled: "Export canceled.", scroll: "Page scroll",
  },
};

const byId = id => document.getElementById(id);
let art = byId("art");
const zone = byId("drop-zone");
const detail = byId("detail");
const seek = byId("seek");
const volume = byId("volume");
const removeBackground = byId("remove-background");
const paletteInputs = [...document.querySelectorAll("[name=palette]")];
const sample = document.createElement("canvas");
const sampling = sample.getContext("2d", { willReadFrequently: true });
const glyphs = " .,:;!+*#%@";
const monoFont = '14px "Cascadia Mono", Consolas, monospace';
const maximumFps = 60;
const cellHeight = 14;
sampling.font = monoFont;
const cellWidth = Math.ceil(sampling.measureText("M").width);
const background = [8, 12, 10];
const colors = { green: [85, 228, 119], mono: [226, 238, 230] };
const littleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
const packPixel = littleEndian
  ? (r, g, b, a = 255) => (a << 24) | (b << 16) | (g << 8) | r
  : (r, g, b, a = 255) => (r << 24) | (g << 16) | (b << 8) | a;
const backgroundPixel = packPixel(...background);
const glyphMasks = [...glyphs].map(glyph => {
  const cell = document.createElement("canvas");
  cell.width = cellWidth;
  cell.height = cellHeight;
  const ctx = cell.getContext("2d");
  ctx.font = monoFont;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(glyph, cellWidth / 2, cellHeight * 0.54);
  const pixels = ctx.getImageData(0, 0, cellWidth, cellHeight).data;
  const mask = [];
  for (let i = 0; i < cellWidth * cellHeight; i++) {
    if (pixels[i * 4 + 3]) mask.push([i % cellWidth, Math.floor(i / cellWidth), pixels[i * 4 + 3] + 1]);
  }
  return mask;
});
const gpu = createGpuRenderer();
const context = gpu ? null : art.getContext("2d");

let language = "ru";
let statusKey = "";
let source;
let loading = false;
let loadGeneration = 0;
let frameID;
let renderQueued = false;
let frame;
let raster;
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
  removeBackground.disabled = locked;
  for (const input of paletteInputs) input.disabled = locked;
  for (const id of ["png", "html", "movie"]) byId(id).disabled = locked || !frame;
  byId("transport").hidden = !video;
  byId("movie").hidden = !video || !movieFormat;
  if (movieFormat) byId("movie").textContent = movieFormat.extension.toUpperCase();
  byId("recording").hidden = !recording;
  byId("play").textContent = translate(video && !video.paused ? "pause" : "play");
  byId("play").disabled = locked;
  seek.disabled = locked;
  byId("volume-control").hidden = !video || Boolean(source.gif);
  volume.disabled = locked;
  byId("filename").textContent = source?.demo ? translate("demo") : source?.name ?? "";
}

function solidBackgroundMask(rgba, columns, rows, mask, queue) {
  const last = columns * rows - 1;
  const corners = [0, columns - 1, last - columns + 1, last];
  const close = (pixel, reference) => Math.abs(rgba[pixel] - rgba[reference]) <= 26
    && Math.abs(rgba[pixel + 1] - rgba[reference + 1]) <= 26
    && Math.abs(rgba[pixel + 2] - rgba[reference + 2]) <= 26
    && Math.abs(rgba[pixel + 3] - rgba[reference + 3]) <= 26;
  const corner = corners.find(index => corners.filter(other => close(index * 4, other * 4)).length >= 3);
  if (corner === undefined) return null;
  const reference = corner * 4;
  mask.fill(0);
  let count = 0;
  const add = index => {
    if (mask[index] || !close(index * 4, reference)) return;
    mask[index] = 1;
    queue[count++] = index;
  };
  for (let x = 0; x < columns; x++) {
    add(x);
    add(last - x);
  }
  for (let y = 1; y < rows - 1; y++) {
    add(y * columns);
    add((y + 1) * columns - 1);
  }
  for (let head = 0; head < count; head++) {
    const index = queue[head];
    const x = index % columns;
    if (x > 0) add(index - 1);
    if (x < columns - 1) add(index + 1);
    if (index >= columns) add(index - columns);
    if (index + columns <= last) add(index + columns);
  }
  return mask;
}

function createGpuRenderer() {
  const gl = art.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!gl) return null;
  const program = gl.createProgram();
  const vertex = `attribute vec2 position; void main() { gl_Position = vec4(position, 0., 1.); }`;
  const fragment = `
    precision highp float;
    uniform sampler2D grid, atlas;
    uniform vec2 size;
    uniform vec3 tint;
    uniform bool useTint, transparent;
    void main() {
      vec2 cellSize = vec2(${cellWidth}., ${cellHeight}.);
      vec2 pixel = vec2(gl_FragCoord.x, size.y * cellSize.y - gl_FragCoord.y);
      vec2 cell = floor(pixel / cellSize);
      if (cell.x >= size.x) { gl_FragColor = vec4(vec3(8., 12., 10.) / 255., transparent ? 0. : 1.); return; }
      vec4 data = texture2D(grid, (cell + .5) / size);
      float glyphData = floor(data.a * 255. + .5);
      float level = mod(glyphData, 16.);
      vec2 glyph = mod(pixel, cellSize);
      glyph.x += level * cellSize.x;
      float ink = texture2D(atlas, glyph / vec2(${cellWidth * glyphs.length}., ${cellHeight}.)).a;
      vec3 color = useTint ? tint : data.rgb;
      gl_FragColor = transparent ? vec4(color, ink * floor(glyphData / 16.) / 15.)
        : vec4(mix(vec3(8., 12., 10.) / 255., color, ink), 1.);
    }`;
  for (const [type, sourceCode] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, sourceCode);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const replacement = art.cloneNode();
    art.replaceWith(replacement);
    art = replacement;
    return null;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(["grid", "atlas", "size", "tint", "useTint", "transparent"].map(name => [name, gl.getUniformLocation(program, name)]));
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  for (const [index, name] of ["grid", "atlas"].entries()) {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, key, gl.NEAREST);
    for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
    gl.uniform1i(uniforms[name], index);
  }
  const atlasWidth = cellWidth * glyphs.length;
  const atlas = new Uint8Array(atlasWidth * cellHeight);
  for (const [level, mask] of glyphMasks.entries()) {
    for (const [x, y, alpha] of mask) atlas[y * atlasWidth + level * cellWidth + x] = alpha - 1;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, atlasWidth, cellHeight, 0, gl.ALPHA, gl.UNSIGNED_BYTE, atlas);
  gl.activeTexture(gl.TEXTURE0);
  let width = 0;
  let height = 0;
  return (rgba, columns, rows, tint, transparent) => {
    if (columns !== width || rows !== height) {
      width = columns;
      height = rows;
      gl.viewport(0, 0, art.width, art.height);
      gl.uniform2f(uniforms.size, columns, rows);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, columns, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, columns, rows, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.uniform1i(uniforms.transparent, transparent);
    gl.uniform1i(uniforms.useTint, Boolean(tint));
    if (tint) gl.uniform3f(uniforms.tint, tint[0] / 255, tint[1] / 255, tint[2] / 255);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

function render(input) {
  if (!source) return;
  const { media, width, height } = source;
  const columns = Number(detail.value);
  const mode = paletteInputs.find(input => input.checked).value;
  const rows = Math.max(1, Math.min(640, Math.round(columns * height / width * cellWidth / cellHeight)));
  if (!raster || sample.width !== columns || sample.height !== rows) {
    sample.width = columns;
    sample.height = rows;
    art.width = Math.ceil(columns * cellWidth / 2) * 2;
    art.height = rows * cellHeight;
    const image = context?.createImageData(art.width, art.height);
    raster = {
      image,
      pixels: image && new Uint32Array(image.data.buffer),
      masks: image && glyphMasks.map(mask => mask.map(([x, y, alpha]) => [y * art.width + x, alpha])),
      backgroundMask: new Uint8Array(columns * rows),
      queue: new Uint32Array(columns * rows),
    };
    byId("dimensions").textContent = `${columns} × ${rows}`;
  }
  if (removeBackground.checked) sampling.clearRect(0, 0, columns, rows);
  else {
    sampling.fillStyle = "#080c0a";
    sampling.fillRect(0, 0, columns, rows);
  }
  sampling.drawImage(input || (source.gif ? media.frame : media), 0, 0, columns, rows);
  const rgba = sampling.getImageData(0, 0, columns, rows).data;
  const { image, pixels, masks } = raster;
  const cut = removeBackground.checked ? solidBackgroundMask(rgba, columns, rows, raster.backgroundMask, raster.queue) : null;
  const transparent = Boolean(cut) && !recording;
  pixels?.fill(transparent ? 0 : backgroundPixel);
  const sameGrid = source.video && frame?.columns === columns && frame?.rows === rows && frame?.mode === mode;
  const levels = sameGrid ? frame.levels : new Uint8Array(columns * rows);
  const tint = colors[mode];
  for (let y = 0; y < rows; y++) {
    const rowOffset = y * cellHeight * art.width;
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x;
      const offset = index * 4;
      if (cut?.[index]) { levels[index] = 0; if (gpu) rgba[offset + 3] = 0; continue; }
      const r = rgba[offset];
      const g = rgba[offset + 1];
      const b = rgba[offset + 2];
      const density = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 * (glyphs.length - 1);
      const last = levels[index];
      const level = sameGrid && Math.abs(density - last) < 0.69 ? last : Math.round(density);
      levels[index] = level;
      if (gpu) {
        rgba[offset + 3] = (rgba[offset + 3] & 0xf0) | level;
        continue;
      }
      if (!level) continue;
      const cellOffset = rowOffset + x * cellWidth;
      const dr = (tint ? tint[0] : r) - background[0];
      const dg = (tint ? tint[1] : g) - background[1];
      const db = (tint ? tint[2] : b) - background[2];
      for (const entry of masks[level]) {
        const alpha = entry[1];
        pixels[cellOffset + entry[0]] = transparent
          ? packPixel(dr + background[0], dg + background[1], db + background[2], (rgba[offset + 3] * alpha) >> 8)
          : packPixel(background[0] + ((dr * alpha) >> 8), background[1] + ((dg * alpha) >> 8), background[2] + ((db * alpha) >> 8));
      }
    }
  }
  if (gpu) gpu(rgba, columns, rows, tint, transparent);
  else context.putImageData(image, 0, 0);
  recording?.stream?.getVideoTracks()[0]?.requestFrame?.();
  frame = { levels, rgba, columns, rows, mode, transparent };
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
  if (source.gif) {
    source.media.close();
  } else if (source.video) {
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
    if (!source.gif) playFrames(video);
  });
  video.addEventListener("frame", () => {
    if (source?.media !== video) return;
    render();
    updateTime();
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
  video.addEventListener("error", () => {
    if (source?.media !== video) return;
    if (recording) stopRecording("failed");
    else notify("invalid");
  });
}

class GifPlayback extends EventTarget {
  constructor(decoder, times, duration, frame) {
    super();
    Object.assign(this, { decoder, times, duration, frame, time: 0, index: 0, paused: true, ended: false, generation: 0 });
  }

  get currentTime() { return this.time; }

  set currentTime(time) {
    cancelAnimationFrame(this.animation);
    this.ended = false;
    this.show(Math.max(0, Math.min(time, this.duration)), ++this.generation).then(shown => {
      if (!shown) return;
      this.dispatchEvent(new Event("seeked"));
      if (!this.paused) this.startFrames();
    });
  }

  async show(time, generation) {
    const index = this.times.findLastIndex(start => start <= time);
    try {
      if (index !== this.index) {
        const { image } = await this.decoder.decode({ frameIndex: index });
        if (generation !== this.generation) { image.close(); return false; }
        this.frame.close();
        this.frame = image;
        this.index = index;
      }
      this.time = time;
      return true;
    } catch {
      if (generation === this.generation) {
        this.pause();
        this.dispatchEvent(new Event("error"));
      }
      return false;
    }
  }

  startFrames() {
    cancelAnimationFrame(this.animation);
    const start = performance.now() - this.time * 1000;
    const generation = ++this.generation;
    const tick = async now => {
      const index = this.index;
      const time = Math.min(this.duration, Math.max(0, (now - start) / 1000));
      if (!(await this.show(time, generation)) || generation !== this.generation) return;
      if (this.index !== index) this.dispatchEvent(new Event("frame"));
      if (time < this.duration) this.animation = requestAnimationFrame(tick);
      else {
        this.ended = true;
        this.pause();
        this.dispatchEvent(new Event("ended"));
      }
    };
    this.animation = requestAnimationFrame(tick);
  }

  async play() {
    if (!this.paused) return;
    if (this.ended && !(await this.show(0, ++this.generation))) throw new Error("GIF replay failed");
    this.ended = false;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    this.startFrames();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.generation++;
    cancelAnimationFrame(this.animation);
    this.dispatchEvent(new Event("pause"));
  }

  close() {
    this.pause();
    this.generation++;
    this.decoder.close();
    this.frame.close();
  }
}

async function openGif(file) {
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: "image/gif" });
  let first;
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track?.animated) { decoder.close(); return null; }
    const times = [];
    let duration = 0;
    for (let index = 0; index < track.frameCount; index++) {
      const { image } = await decoder.decode({ frameIndex: index });
      times.push(duration);
      duration += Math.max(10_000, image.duration || 100_000) / 1_000_000;
      if (index === 0) first = image;
      else image.close();
    }
    return new GifPlayback(decoder, times, duration, first);
  } catch (error) {
    first?.close();
    decoder.close();
    throw error;
  }
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
  const videoFile = Boolean(file && (file.type.startsWith("video/") || /\.(mp4|m4v|webm|mov|ogv|mkv)$/i.test(file.name)));
  const gifFile = file && (file.type === "image/gif" || /\.gif$/i.test(file.name));
  loading = true;
  updateControls();
  if (file) notify("loading");
  try {
    const gifSupported = gifFile && window.ImageDecoder && await ImageDecoder.isTypeSupported("image/gif");
    const gif = gifSupported ? await openGif(file) : null;
    const video = videoFile || Boolean(gif);
    const media = gif || (videoFile ? document.createElement("video") : new Image());
    if (videoFile) {
      media.preload = "auto";
      media.playsInline = true;
      media.volume = Number(volume.value) / 100;
    }
    if (!gif) await mediaReady(media, video ? "loadeddata" : "load", url);
    if (generation !== loadGeneration) {
      gif?.close();
      if (file) URL.revokeObjectURL(url);
      return;
    }
    const width = gif ? gif.frame.displayWidth : video ? media.videoWidth : media.naturalWidth;
    const height = gif ? gif.frame.displayHeight : video ? media.videoHeight : media.naturalHeight;
    if (!width || !height || (video && (!Number.isFinite(media.duration) || media.duration <= 0))) throw new Error("Invalid media");
    disposeSource();
    source = { url, media, width, height, file, name: file?.name, demo: !file, video, gif: Boolean(gif) };
    if (video) videoEvents(media);
    delete zone.dataset.empty;
    render();
    updateTime();
    notify(gifFile && !gifSupported ? "gifStill" : video && !movieFormat ? "unsupported" : "");
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
  const { levels, rgba, rows, columns, mode, transparent } = frame;
  const tint = colors[mode];
  let content = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x;
      const char = glyphs[levels[index]];
      if (char === " ") { content += char; continue; }
      const offset = index * 4;
      const color = tint ? `rgb(${tint.join(",")})` : `rgb(${rgba[offset]},${rgba[offset + 1]},${rgba[offset + 2]})`;
      content += `<span style="color:${color}">${char}</span>`;
    }
    content += "\n";
  }
  const html = `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ASCII Studio</title><style>body{${transparent ? "" : "background:#080c0a;"}color:#e2eee6;margin:16px}pre{font:14px/1 'Cascadia Mono',Consolas,monospace;width:max-content;margin:auto}</style><pre>${content}</pre></html>`;
  save(new Blob([html], { type: "text/html;charset=utf-8" }), "html");
}

function stopRecording(outcome) {
  if (!recording || recording.outcome) return;
  recording.outcome = outcome;
  source.media.pause();
  recording.conversion?.cancel().catch(() => {});
  if (recording.recorder?.state !== "inactive") recording.recorder?.stop();
}

function finishRecording(job) {
  if (recording !== job) return;
  const video = source.media;
  video.pause();
  job.stream?.getVideoTracks().forEach(track => track.stop());
  recording = undefined;
  video.currentTime = job.position;
  render();
  if (job.outcome === "saved") save(job.blob ?? new Blob(job.chunks, { type: job.recorder.mimeType }), movieFormat.extension);
  else notify(job.outcome || "failed");
  updateControls();
  if (job.resume) video.play().catch(() => {});
}

async function encodeFrameByFrame(job) {
  const media = window.Mediabunny;
  if (!media || source.gif || !window.VideoDecoder || !window.VideoEncoder) return false;
  const input = new media.Input({ formats: media.ALL_FORMATS, source: new media.BlobSource(source.file) });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) return false;
    const { averagePacketRate } = await video.computePacketStats(120);
    if (job.outcome) return true;
    const gain = Number(volume.value) / 100;
    const target = new media.BufferTarget();
    const format = movieFormat.extension === "mp4" ? new media.Mp4OutputFormat() : new media.WebMOutputFormat();
    const output = new media.Output({ format, target });
    const conversion = await media.Conversion.init({
      input, output, tracks: "primary", showWarnings: false,
      video: {
        frameRate: averagePacketRate > maximumFps + 0.5 ? maximumFps : undefined,
        processedWidth: art.width,
        processedHeight: art.height,
        quality: media.QUALITY_HIGH,
        process(sample) {
          render(sample.toCanvasImageSource());
          return art;
        },
      },
      audio: gain === 1 ? {} : {
        process(sample) {
          const { numberOfChannels, numberOfFrames, sampleRate, timestamp } = sample;
          const format = "f32";
          const data = new Float32Array(numberOfChannels * numberOfFrames);
          sample.copyTo(data, { format, planeIndex: 0 });
          for (let i = 0; i < data.length; i++) data[i] *= gain;
          return new media.AudioSample({ data, format, numberOfChannels, sampleRate, timestamp });
        },
      },
    });
    if (job.outcome) return true;
    if (!conversion.isValid || conversion.discardedTracks.length) {
      console.warn("Frame-by-frame format unavailable:", conversion.discardedTracks.map(item => item.reason));
      return false;
    }
    job.conversion = conversion;
    conversion.onProgress = progress => { byId("progress").value = progress; };
    frame = undefined;
    await conversion.execute();
    if (!job.outcome && target.buffer?.byteLength) {
      job.blob = new Blob([target.buffer], { type: `video/${movieFormat.extension}` });
      job.outcome = "saved";
    }
    return Boolean(job.outcome);
  } catch (error) {
    if (!job.outcome) console.warn("Frame-by-frame export unavailable:", error);
    return Boolean(job.outcome);
  } finally {
    input.dispose();
    job.conversion = undefined;
  }
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
    if (await encodeFrameByFrame(job)) return finishRecording(job);
    notify("recording");
    if (!source.gif && !audio) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      const context = new Audio();
      const element = context.createMediaElementSource(video);
      const destination = context.createMediaStreamDestination();
      const gain = context.createGain();
      gain.gain.value = Number(volume.value) / 100;
      video.volume = 1;
      element.connect(gain);
      gain.connect(destination);
      gain.connect(context.destination);
      audio = { context, destination, gain };
    }
    await audio?.context.resume();
    if (job.outcome) return finishRecording(job);
    if (video.currentTime !== 0) {
      const listeners = new AbortController();
      const start = new Promise((resolve, reject) => {
        video.addEventListener("seeked", resolve, { signal: listeners.signal });
        video.addEventListener("error", reject, { signal: listeners.signal });
      });
      video.currentTime = 0;
      try { await start; } finally { listeners.abort(); }
    }
    if (job.outcome) return finishRecording(job);
    render();
    job.stream = art.captureStream(maximumFps);
    for (const track of audio?.destination.stream.getAudioTracks() ?? []) job.stream.addTrack(track);
    const recorder = new MediaRecorder(job.stream, { mimeType: movieFormat.mime, videoBitsPerSecond: 12000000 });
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
    { mime: "video/mp4", extension: "mp4" },
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
removeBackground.onchange = () => {
  frame = undefined;
  scheduleRender();
};
byId("play").onclick = () => {
  const video = source.media;
  if (video.paused) video.play().catch(() => notify("invalid"));
  else video.pause();
};
seek.oninput = () => { source.media.currentTime = Number(seek.value); };
volume.oninput = () => {
  const value = Number(volume.value);
  byId("volume-value").value = `${value}%`;
  if (audio) audio.gain.gain.value = value / 100;
  else if (source?.video && !source.gif) source.media.volume = value / 100;
};
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
