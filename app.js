"use strict";

const copy = {
  ru: {
    preview: "Превью", zoom: "Лупа", drop: "Перетащи фото, видео или GIF", local: "Локальная обработка", settings: "Настройки",
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
    preview: "Preview", zoom: "Zoom", drop: "Drop a photo, video or GIF", local: "Processed locally", settings: "Settings",
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
const rasterLimit = 4096;
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

function rasterCellSize(columns, rows) {
  const maximumWidth = Math.floor(rasterLimit / columns);
  const maximumHeight = Math.floor(rasterLimit / rows);
  const scale = Math.min(1, maximumWidth / cellWidth, maximumHeight / cellHeight);
  return [Math.max(2, Math.round(cellWidth * scale)), Math.max(2, Math.round(cellHeight * scale))];
}

function rasterMasks(width, height, stride) {
  if (width === cellWidth && height === cellHeight) {
    return glyphMasks.map(mask => mask.map(([x, y, alpha]) => [y * stride + x, alpha]));
  }
  return glyphMasks.map(mask => {
    const canvas = document.createElement("canvas");
    canvas.width = cellWidth;
    canvas.height = cellHeight;
    const ctx = canvas.getContext("2d");
    const source = ctx.createImageData(cellWidth, cellHeight);
    for (const [x, y, alpha] of mask) source.data[(y * cellWidth + x) * 4 + 3] = alpha - 1;
    ctx.putImageData(source, 0, 0);
    const resized = document.createElement("canvas");
    resized.width = width;
    resized.height = height;
    const scaledCtx = resized.getContext("2d");
    scaledCtx.drawImage(canvas, 0, 0, width, height);
    const pixels = scaledCtx.getImageData(0, 0, width, height).data;
    const scaled = [];
    for (let i = 0; i < width * height; i++) {
      const alpha = pixels[i * 4 + 3];
      if (alpha) scaled.push([Math.floor(i / width) * stride + i % width, alpha + 1]);
    }
    return scaled;
  });
}
const gpu = createGpuRenderer();
const context = gpu ? null : art.getContext("2d");
const tonePreview = byId("tone-preview");
const toneContext = tonePreview.getContext("2d");
const zoomPreview = byId("zoom-preview");
const zoomContext = zoomPreview.getContext("2d");
const zoomButton = byId("zoom");
// Average glyph light before display gamma so thin, bright strokes stay visible.
const glyphCoverage = glyphMasks.map(mask => {
  const light = mask.reduce((sum, [, , alpha]) => sum + ((alpha - 1) / 255) ** 2.2, 0);
  return (light / (cellWidth * cellHeight)) ** (1 / 2.2);
});
let toneImage;
let previewBounds;
let zoomed = false;
let zoomX = 0.5;
let zoomY = 0.5;

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
  if (recording?.stream) byId("progress").value = video.currentTime / video.duration;
}

function updateControls() {
  const video = source?.video ? source.media : null;
  const locked = Boolean(recording) || loading;
  zoomButton.disabled = !frame;
  byId("open").disabled = locked;
  byId("file").disabled = locked;
  detail.disabled = locked;
  removeBackground.disabled = locked;
  for (const input of paletteInputs) input.disabled = locked;
  for (const id of ["png", "html", "gif", "movie"]) byId(id).disabled = locked || !frame;
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
  const gl = art.getContext("webgl", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  if (!gl) return null;
  const program = gl.createProgram();
  const vertex = `attribute vec2 position; void main() { gl_Position = vec4(position, 0., 1.); }`;
  const fragment = `
    precision highp float;
    uniform sampler2D grid, atlas;
    uniform vec2 size, cellSize;
    uniform vec3 tint;
    uniform bool useTint, transparent;
    void main() {
      float outputHeight = ceil(size.y * cellSize.y / 2.) * 2.;
      vec2 pixel = vec2(gl_FragCoord.x, outputHeight - gl_FragCoord.y);
      vec2 cell = floor(pixel / cellSize);
      if (cell.x >= size.x || cell.y >= size.y) { gl_FragColor = transparent ? vec4(0.) : vec4(vec3(8., 12., 10.) / 255., 1.); return; }
      vec4 data = texture2D(grid, (cell + .5) / size);
      float glyphData = floor(data.a * 255. + .5);
      float level = mod(glyphData, 16.);
      vec2 atlasCell = vec2(${cellWidth}., ${cellHeight}.);
      vec2 glyph = clamp(mod(pixel, cellSize) / cellSize * atlasCell, vec2(.5), atlasCell - .5);
      glyph.x += level * atlasCell.x;
      float ink = texture2D(atlas, glyph / vec2(${cellWidth * glyphs.length}., ${cellHeight}.)).a;
      vec3 color = useTint ? tint : data.rgb;
      float opacity = ink * floor(glyphData / 16.) / 15.;
      gl_FragColor = transparent ? vec4(color * opacity, opacity)
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
  const uniforms = Object.fromEntries(["grid", "atlas", "size", "cellSize", "tint", "useTint", "transparent"].map(name => [name, gl.getUniformLocation(program, name)]));
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  for (const [index, name] of ["grid", "atlas"].entries()) {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, key, name === "atlas" ? gl.LINEAR : gl.NEAREST);
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
  let grid;
  return (rgba, columns, rows, tint, transparent, raster) => {
    if (grid !== raster) {
      grid = raster;
      gl.viewport(0, 0, art.width, art.height);
      gl.uniform2f(uniforms.size, columns, rows);
      gl.uniform2f(uniforms.cellSize, raster.width, raster.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, columns, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, columns, rows, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.uniform1i(uniforms.transparent, transparent);
    gl.uniform1i(uniforms.useTint, Boolean(tint));
    if (tint) gl.uniform3f(uniforms.tint, tint[0] / 255, tint[1] / 255, tint[2] / 255);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

function render(input, keepTransparency = !recording || recording.extension === "gif") {
  if (!source) return;
  const { media, width, height } = source;
  const columns = Number(detail.value);
  const mode = paletteInputs.find(input => input.checked).value;
  const preferredRows = Math.max(1, Math.min(1600, Math.round(columns * height / width * cellWidth / cellHeight)));
  const [glyphWidth, glyphHeight] = rasterCellSize(columns, preferredRows);
  const rows = Math.max(1, Math.min(1600, Math.floor(rasterLimit / glyphHeight), Math.round(columns * height / width * glyphWidth / glyphHeight)));
  if (!raster || sample.width !== columns || sample.height !== rows || raster.width !== glyphWidth || raster.height !== glyphHeight) {
    sample.width = columns;
    sample.height = rows;
    art.width = Math.ceil(columns * glyphWidth / 2) * 2;
    art.height = Math.ceil(rows * glyphHeight / 2) * 2;
    const image = context?.createImageData(art.width, art.height);
    raster = {
      image,
      width: glyphWidth, height: glyphHeight,
      pixels: image && new Uint32Array(image.data.buffer),
      masks: image && rasterMasks(glyphWidth, glyphHeight, art.width),
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
  let transparent = keepTransparency && Boolean(cut);
  if (keepTransparency && removeBackground.checked && !transparent) {
    for (let offset = 3; offset < rgba.length; offset += 4) {
      if (rgba[offset] !== 255) { transparent = true; break; }
    }
  }
  pixels?.fill(transparent ? 0 : backgroundPixel);
  const sameGrid = source.video && frame?.columns === columns && frame?.rows === rows && frame?.mode === mode;
  const levels = sameGrid ? frame.levels : new Uint8Array(columns * rows);
  const tint = colors[mode];
  for (let y = 0; y < rows; y++) {
    const rowOffset = y * raster.height * art.width;
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
      const cellOffset = rowOffset + x * raster.width;
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
  if (gpu) gpu(rgba, columns, rows, tint, transparent, raster);
  else context.putImageData(image, 0, 0);
  recording?.stream?.getVideoTracks()[0]?.requestFrame?.();
  frame = { levels, rgba, columns, rows, mode, transparent };
  drawPreview();
}

function drawPreview() {
  if (!frame || !previewBounds) return;
  const { levels, rgba, columns, rows, mode, transparent } = frame;
  const scale = Math.min(previewBounds.width / art.width, previewBounds.height / art.height);
  const width = art.width * scale;
  const height = art.height * scale;
  // MediaRecorder captures the painted canvas, so it needs the actual canvas visible.
  const inspect = zoomed && !recording?.live;
  const pixelsPerGlyph = devicePixelRatio * Math.min(width / columns, height / rows);
  const tone = inspect || recording?.live ? 0 : Math.max(0, Math.min(1, 3 - pixelsPerGlyph));
  tonePreview.hidden = tone === 0;
  zoomPreview.hidden = !inspect;
  art.toggleAttribute("data-alternate-preview", tone === 1 || inspect);
  art.style.setProperty("--preview-opacity", transparent ? 1 - tone : 1);
  if (inspect) { drawZoom(); return; }
  if (!tone) return;
  if (toneImage?.width !== columns || toneImage.height !== rows) {
    tonePreview.width = columns;
    tonePreview.height = rows;
    toneImage = toneContext.createImageData(columns, rows);
  }
  tonePreview.style.width = `${width}px`;
  tonePreview.style.height = `${height}px`;
  tonePreview.style.setProperty("--preview-opacity", tone);
  const tint = colors[mode];
  const pixels = toneImage.data;
  for (let i = 0; i < levels.length; i++) {
    const offset = i * 4;
    const coverage = glyphCoverage[levels[i]];
    for (let channel = 0; channel < 3; channel++) {
      const color = tint ? tint[channel] : rgba[offset + channel];
      pixels[offset + channel] = transparent ? color : background[channel] + (color - background[channel]) * coverage;
    }
    const alpha = gpu ? (rgba[offset + 3] >> 4) * 17 : rgba[offset + 3];
    pixels[offset + 3] = transparent ? alpha * coverage : 255;
  }
  toneContext.putImageData(toneImage, 0, 0);
}

function drawZoom() {
  const { levels, rgba, columns, rows, mode, transparent } = frame;
  const across = Math.max(1, Math.min(columns, Math.floor(previewBounds.width / cellWidth)));
  const down = Math.max(1, Math.min(rows, Math.floor(previewBounds.height / cellHeight)));
  const startX = Math.round((columns - across) * zoomX);
  const startY = Math.round((rows - down) * zoomY);
  const width = across * cellWidth;
  const height = down * cellHeight;
  if (zoomPreview.width !== width || zoomPreview.height !== height) {
    zoomPreview.width = width;
    zoomPreview.height = height;
    zoomPreview.style.width = `${width}px`;
    zoomPreview.style.height = `${height}px`;
  }
  zoomContext.globalAlpha = 1;
  if (transparent) zoomContext.clearRect(0, 0, width, height);
  else {
    zoomContext.fillStyle = "#080c0a";
    zoomContext.fillRect(0, 0, width, height);
  }
  zoomContext.font = monoFont;
  zoomContext.textAlign = "center";
  zoomContext.textBaseline = "middle";
  const tint = colors[mode];
  if (tint) zoomContext.fillStyle = `rgb(${tint.join(",")})`;
  for (let y = 0; y < down; y++) {
    for (let x = 0; x < across; x++) {
      const index = (startY + y) * columns + startX + x;
      const level = levels[index];
      if (!level) continue;
      const offset = index * 4;
      if (!tint) zoomContext.fillStyle = `rgb(${rgba[offset]},${rgba[offset + 1]},${rgba[offset + 2]})`;
      if (transparent) zoomContext.globalAlpha = (gpu ? (rgba[offset + 3] >> 4) * 17 : rgba[offset + 3]) / 255;
      zoomContext.fillText(glyphs[level], (x + 0.5) * cellWidth, (y + 0.54) * cellHeight);
    }
  }
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
  recording.abort.abort();
  if (source.video) source.media.pause();
  recording.conversion?.cancel().catch(() => {});
  if (recording.recorder?.state !== "inactive") recording.recorder?.stop();
}

function startRecording(extension) {
  const video = source.video ? source.media : null;
  const job = { extension, position: video?.currentTime, resume: Boolean(video && !video.paused), chunks: [], abort: new AbortController() };
  recording = job;
  video?.pause();
  notify("encoding");
  byId("progress").value = 0;
  updateControls();
  return job;
}

function finishRecording(job) {
  if (recording !== job) return;
  const video = source.video ? source.media : null;
  video?.pause();
  job.stream?.getVideoTracks().forEach(track => track.stop());
  recording = undefined;
  if (video && video.currentTime !== job.position) video.currentTime = job.position;
  render();
  if (job.outcome === "saved") save(job.blob ?? new Blob(job.chunks, { type: job.recorder.mimeType }), job.extension);
  else notify(job.outcome || "failed");
  updateControls();
  if (job.resume) video.play().catch(() => {});
}

async function seekMedia(video, time, signal) {
  signal.throwIfAborted();
  if (!video.seeking && Math.abs(video.currentTime - time) < 0.0001) return;
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  try {
    await new Promise((resolve, reject) => {
      video.addEventListener("seeked", resolve, options);
      video.addEventListener("error", reject, options);
      signal.addEventListener("abort", () => reject(signal.reason), options);
      video.currentTime = time;
    });
  } finally { listeners.abort(); }
}

async function* gifFrames(signal) {
  if (!source.video) {
    yield { delay: 0, progress: 1 };
    return;
  }
  const video = source.media;
  if (source.gif) {
    for (const [index, time] of video.times.entries()) {
      signal.throwIfAborted();
      const { image } = await video.decoder.decode({ frameIndex: index });
      const end = video.times[index + 1] ?? video.duration;
      try { yield { image, delay: (end - time) * 1000, progress: end / video.duration }; }
      finally { image.close(); }
    }
    return;
  }

  // Whole centiseconds keep GIF playback in sync with the source duration.
  let fps = 25;
  let index = 0;
  const at = index => index / fps;
  const length = () => Math.ceil(video.duration * fps - 0.000001);
  const timing = index => {
    const end = Math.min(video.duration, at(index + 1));
    return { delay: Math.max(10, (Math.round(end * 100) - Math.round(at(index) * 100)) * 10), progress: end / video.duration };
  };
  const media = window.Mediabunny;
  if (media && window.VideoDecoder) {
    const input = new media.Input({ formats: media.ALL_FORMATS, source: new media.BlobSource(source.file) });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (track) {
        const { averagePacketRate } = await track.computePacketStats(60);
        if (Number.isFinite(averagePacketRate) && averagePacketRate > 0) fps = Math.min(fps, Math.max(1, Math.round(averagePacketRate)));
        const first = await track.getFirstTimestamp();
        const timestamps = function* () {
          for (let i = 0; i < length(); i++) yield Math.max(first, at(i));
        };
        for await (const sample of new media.VideoSampleSink(track).samplesAtTimestamps(timestamps())) {
          if (!sample) break;
          try {
            signal.throwIfAborted();
            yield { image: sample.toCanvasImageSource(), ...timing(index) };
          } finally { sample.close(); }
          index++;
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      console.warn("Using browser seeking for GIF export:", error);
    } finally { input.dispose(); }
  }
  for (; index < length(); index++) {
    await seekMedia(video, at(index), signal);
    yield timing(index);
  }
}

async function exportGif() {
  if (recording || !frame || !window.gifenc) return;
  const { GIFEncoder, quantize, applyPalette } = window.gifenc;
  const { columns, rows } = frame;
  const job = startRecording("gif");
  // Budget the indexed GIF bitmap and rasterize the glyphs again at its native size.
  const ratio = raster.height / raster.width;
  const glyphWidth = Math.max(2, Math.floor(Math.min(cellWidth, cellHeight / ratio, 8192 / columns, 8192 / (rows * ratio), Math.sqrt(36_000_000 / (columns * rows * ratio)))));
  const glyphHeight = Math.max(2, Math.min(Math.floor(8192 / rows), Math.floor(36_000_000 / (columns * rows * glyphWidth)), Math.round(glyphWidth * ratio)));
  const width = columns * glyphWidth;
  const height = rows * glyphHeight;
  const masks = rasterMasks(glyphWidth, glyphHeight, width).map(mask => mask.filter(([, alpha]) => alpha >= 96));
  const bitmap = new Uint8Array(width * height);
  const encoder = GIFEncoder();
  const transparent = removeBackground.checked;
  try {
    frame = undefined;
    for await (const { image, delay, progress } of gifFrames(job.abort.signal)) {
      job.abort.signal.throwIfAborted();
      render(image);
      const { levels, rgba, mode } = frame;
      const tint = colors[mode];
      const palette = tint ? [tint] : quantize(rgba, 255);
      const indices = tint ? null : applyPalette(rgba, palette);
      palette.unshift(transparent ? [0, 0, 0] : background);
      bitmap.fill(0);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          const index = y * columns + x;
          const level = levels[index];
          if (!level) continue;
          const alpha = gpu ? (rgba[index * 4 + 3] >> 4) * 17 : rgba[index * 4 + 3];
          if (frame.transparent && alpha < 96) continue;
          const origin = y * glyphHeight * width + x * glyphWidth;
          const color = indices ? indices[index] + 1 : 1;
          for (const entry of masks[level]) bitmap[origin + entry[0]] = color;
        }
      }
      encoder.writeFrame(bitmap, width, height, { palette, delay, transparent, transparentIndex: 0, dispose: transparent ? 2 : 1 });
      byId("progress").value = progress;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!job.outcome && byId("progress").value > 0) {
      encoder.finish();
      job.blob = new Blob([encoder.bytesView()], { type: "image/gif" });
      job.outcome = "saved";
    }
  } catch (error) {
    if (!job.outcome) console.warn("GIF export failed:", error);
  } finally { finishRecording(job); }
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
  const job = startRecording(movieFormat.extension);
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
    await seekMedia(video, 0, job.abort.signal);
    if (job.outcome) return finishRecording(job);
    job.live = true;
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
byId("gif").onclick = exportGif;
zoomButton.onclick = () => {
  zoomed = !zoomed;
  zoomButton.ariaPressed = String(zoomed);
  zone.toggleAttribute("data-zoom", zoomed);
  drawPreview();
};
zoomButton.onkeydown = event => {
  if (!zoomed || !event.key.startsWith("Arrow")) return;
  event.preventDefault();
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") zoomX = Math.max(0, Math.min(1, zoomX + (event.key === "ArrowLeft" ? -0.08 : 0.08)));
  else zoomY = Math.max(0, Math.min(1, zoomY + (event.key === "ArrowUp" ? -0.08 : 0.08)));
  drawPreview();
};
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
function positionZoom(event) {
  if (!zoomed) return;
  const bounds = zone.getBoundingClientRect();
  zoomX = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  zoomY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
  drawPreview();
}
zone.addEventListener("pointerdown", positionZoom);
zone.addEventListener("pointermove", event => { if (event.pointerType === "mouse" || event.buttons) positionZoom(event); });
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
new ResizeObserver(() => {
  const padding = Number.parseFloat(getComputedStyle(art).paddingLeft) * 2;
  previewBounds = { width: art.clientWidth - padding, height: art.clientHeight - padding };
  drawPreview();
}).observe(zone);

let preferred;
try { preferred = localStorage.getItem("ascii-language"); } catch { /* Local file storage may be unavailable. */ }
switchLanguage(preferred === "en" ? "en" : "ru");
load();
