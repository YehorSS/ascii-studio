# ASCII Studio

Turn photos and videos into colored ASCII art in the browser. Files stay on your device.

[Open ASCII Studio](https://yehorss.github.io/ascii-studio/)

- Adjust the detail level and choose the original colors, green phosphor, or monochrome.
- Export images and video frames as PNG or HTML. HTML keeps the characters as text.
- Record video with sound as MP4 or WebM, depending on browser support. Keep the tab open until recording finishes.
- Switch between English and Russian.

The website uses plain JavaScript, Canvas, and Web Audio. Serve the repository root with any static HTTP server to develop locally. To make a single HTML file that opens directly in a browser, run `node build.cjs` and open `dist/index.html`.

## По-русски

Открой или перетащи фото либо видео, настрой детализацию и цвет. Для фото и отдельных кадров доступны PNG и HTML, для видео со звуком — MP4 или WebM в зависимости от браузера. Файлы обрабатываются на устройстве. Язык переключается кнопками RU и EN.
