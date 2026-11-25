const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

const read = name => readFileSync(path.join(__dirname, name), "utf8");
const demo = readFileSync(path.join(__dirname, "demo.webp")).toString("base64");
const script = read("app.js").replace('"demo.webp"', `"data:image/webp;base64,${demo}"`);
const page = read("index.html")
  .replace(/<link rel="stylesheet" href="style\.css[^\"]*">/, () => `<style>\n${read("style.css")}\n</style>`)
  .replace('<script src="vendor/mediabunny.min.js" defer></script>', () => `<script>\n/* Mediabunny 1.66.4 source: https://registry.npmjs.org/mediabunny/-/mediabunny-1.66.4.tgz */\n${read("vendor/mediabunny.min.js").replace(/<\/script/gi, "<\\/script")}\n</script>`)
  .replace('<script src="vendor/gifenc.js" defer></script>', () => `<script>\n${read("vendor/gifenc.js").replace(/<\/script/gi, "<\\/script")}\n</script>`)
  .replace(/<script src="app\.js[^\"]*" defer><\/script>/, "")
  .replace("</body>", () => `<script>\n${script}\n</script>\n</body>`);
const output = path.join(__dirname, "dist");
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, "index.html"), page);
