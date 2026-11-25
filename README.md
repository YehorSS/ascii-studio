# ASCII Studio

Turn photos and videos into colored ASCII art in the browser. Files stay on your device.

[Open ASCII Studio](https://yehorss.github.io/ascii-studio/)

- Work with photos, videos, and animated GIFs. Adjust the detail up to 320 columns and choose the original colors, green phosphor, or monochrome.
- Remove a solid background and export transparent PNG or HTML. HTML keeps the characters as text.
- Export video at up to 60 fps with adjustable audio volume. The browser chooses MP4 or WebM. Keep the tab open until export finishes.
- Switch between English and Russian.

The website uses plain JavaScript, Canvas, and Web Audio. Serve the repository root with any static HTTP server to develop locally. To make a single HTML file that opens directly in a browser, run `node build.cjs` and open `dist/index.html`.

## По-русски

Открой или перетащи фото, видео или GIF, настрой детализацию и цвет. Однотонный фон можно убрать. Для кадров доступны PNG и HTML. Видео экспортируется до 60 кадров/с с выбранной громкостью в MP4 или WebM. Файлы обрабатываются на устройстве. Язык переключается кнопками RU и EN.

## Third-party code

The bundled Mediabunny 1.66.4 is distributed under the [Mozilla Public License 2.0](vendor/Mediabunny-LICENSE.txt). Its corresponding source is available in the [upstream npm archive](https://registry.npmjs.org/mediabunny/-/mediabunny-1.66.4.tgz).
