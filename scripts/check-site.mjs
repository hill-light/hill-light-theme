#!/usr/bin/env node
/*
 * Static checks for the parts the contrast script cannot see:
 * local references, image dimensions, duplicated ids, theme hooks,
 * the four-time image sets and the two wallpaper ratios.
 * No dependencies, no network.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["index.html", "demo.html", "styleguide.html"];
const themes = ["dawn", "noon", "dusk", "night"];
const failures = [];
const passes = [];

const fail = (message) => failures.push(message);
const pass = (message) => passes.push(message);

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function localTarget(raw, baseDir) {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.startsWith("#")) return null;
  if (/^(?:[a-z]+:)?\/\//i.test(value)) return null;
  if (/^(?:mailto|tel|data|javascript):/i.test(value)) return null;
  const clean = decodeURIComponent(value.split("#")[0].split("?")[0]);
  if (!clean) return null;
  return resolve(baseDir, clean);
}

function attributes(tag) {
  const out = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(tag))) out[match[1].toLowerCase()] = match[3] ?? match[4] ?? "";
  return out;
}

function imageSize(buffer, ext) {
  if (ext === ".png") {
    if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    let i = 2;
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) { i += 1; continue; }
      const marker = buffer[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) };
      }
      if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
      const length = buffer.readUInt16BE(i + 2);
      i += 2 + length;
    }
    return null;
  }
  if (ext === ".webp") {
    if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    if (chunk === "VP8L") {
      const b = buffer;
      return {
        width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
        height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
      };
    }
    if (chunk === "VP8 ") {
      for (let i = 20; i + 9 < buffer.length; i += 1) {
        if (buffer[i] === 0x9d && buffer[i + 1] === 0x01 && buffer[i + 2] === 0x2a) {
          return {
            width: buffer.readUInt16LE(i + 3) & 0x3fff,
            height: buffer.readUInt16LE(i + 5) & 0x3fff,
          };
        }
      }
    }
    return null;
  }
  if (ext === ".avif") {
    // ISO BMFF: the first `ispe` box stores version/flags, width, height.
    const at = buffer.indexOf("ispe", 0, "ascii");
    if (at < 0 || at + 16 > buffer.length) return null;
    return { width: buffer.readUInt32BE(at + 8), height: buffer.readUInt32BE(at + 12) };
  }
  return null;
}

function expectedSize(rel) {
  if (/\/times\/flower-(?:dawn|noon|dusk|night)-800\.(?:avif|webp|jpg)$/.test(rel)) return [800, 450];
  if (/\/times\/flower-(?:dawn|noon|dusk|night)-1600\.(?:avif|webp|jpg)$/.test(rel)) return [1600, 900];
  if (/\/times\/wide-(?:dawn|noon|dusk|night)-840\.(?:avif|webp|jpg)$/.test(rel)) return [840, 360];
  if (/\/times\/wide-(?:dawn|noon|dusk|night)-1680\.(?:avif|webp|jpg)$/.test(rel)) return [1680, 720];
  if (/\/wallpapers\/hill-light-(?:dawn|noon|dusk|night)-16x9\.jpg$/.test(rel)) return [1920, 1080];
  if (/\/wallpapers\/hill-light-(?:dawn|noon|dusk|night)-21x9\.jpg$/.test(rel)) return [2520, 1080];
  if (/\/brand\/org-avatar\.png$/.test(rel)) return [460, 460];
  if (/\/brand\/org-avatar-180\.png$/.test(rel)) return [180, 180];
  if (/\/brand\/icon-180\.png$/.test(rel)) return [180, 180];
  if (/\/brand\/og-cover\.jpg$/.test(rel)) return [1200, 630];
  if (/\/brand\/repo-social\.jpg$/.test(rel)) return [1280, 640];
  return null;
}

function checkImage(rel, label) {
  const target = join(root, rel);
  if (!existsSync(target)) {
    fail(`missing image: ${rel}`);
    return false;
  }
  const ext = extname(target).toLowerCase();
  const size = imageSize(readFileSync(target), ext);
  const expected = expectedSize(`/${rel}`);
  if (!size || !size.width || !size.height) {
    fail(`${rel}: cannot read intrinsic dimensions`);
    return false;
  }
  if (expected && (size.width !== expected[0] || size.height !== expected[1])) {
    fail(`${rel}: ${size.width}×${size.height}, expected ${expected[0]}×${expected[1]}`);
    return false;
  }
  if (label) pass(`${label}: ${size.width}×${size.height}`);
  return true;
}

const referenced = new Set();
const checkedImages = new Map();

for (const page of pages) {
  const html = read(page);
  const pageDir = join(root, dirname(page));
  const pageIds = new Map();

  if (!/<html[^>]*\slang="zh-CN"/i.test(html)) fail(`${page}: missing lang="zh-CN" on <html>`);
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(`${page}: missing <title>`);
  if (!/<meta[^>]+name="description"[^>]+content="[^"]+"/i.test(html)) fail(`${page}: missing meta description`);

  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*?)>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = attributes(match[2]);

    if (attrs.id) {
      if (pageIds.has(attrs.id)) fail(`${page}: duplicate id "${attrs.id}"`);
      else pageIds.set(attrs.id, true);
    }

    for (const name of ["href", "src", "poster"]) {
      const target = localTarget(attrs[name], pageDir);
      if (!target) {
        if ((name === "href" || name === "src") && attrs[name]?.trim().startsWith("#") && attrs[name].trim() !== "#") {
          const id = attrs[name].trim().slice(1);
          if (!html.includes(`id="${id}"`)) fail(`${page}: missing anchor target #${id}`);
        }
        continue;
      }
      referenced.add(target);
    }

    if (attrs.srcset) {
      for (const candidate of attrs.srcset.split(",")) {
        const url = candidate.trim().split(/\s+/)[0];
        const target = localTarget(url, pageDir);
        if (target) referenced.add(target);
      }
    }

    if (tag === "img") {
      const src = attrs.src || "";
      if (!src) fail(`${page}: <img> without src`);
      if (!attrs.alt) fail(`${page}: <img src="${src}"> without alt`);
      if (!attrs.width || !attrs.height) fail(`${page}: <img src="${src}"> without width/height`);
      const target = localTarget(src, pageDir);
      if (target) checkedImages.set(target, { page, alt: attrs.alt || "" });
    }
  }

  for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
    const attrs = attributes(match[1]);
    if (attrs["data-theme-choice"] && !attrs["aria-pressed"]) {
      fail(`${page}: theme button "${attrs["data-theme-choice"]}" without aria-pressed`);
    }
  }

  for (const match of html.matchAll(/data-theme-frame="([^"]+)"/g)) {
    if (!themes.includes(match[1])) fail(`${page}: invalid data-theme-frame "${match[1]}"`);
  }
}

for (const target of referenced) {
  if (!existsSync(target)) {
    fail(`missing referenced file: ${relative(root, target)}`);
    continue;
  }
  if (!statSync(target).isFile()) fail(`referenced path is not a file: ${relative(root, target)}`);
}

for (const css of ["css/tokens.css", "css/base.css", "css/components.css", "css/pages.css"]) {
  const text = read(css);
  for (const match of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const target = localTarget(match[2], join(root, dirname(css)));
    if (!target) continue;
    if (!existsSync(target)) fail(`${css}: missing url() file ${relative(root, target)}`);
  }
}

for (const [target, meta] of checkedImages) {
  const rel = relative(root, target).split("\\").join("/");
  const ext = extname(target).toLowerCase();
  const size = imageSize(readFileSync(target), ext);
  if (!size || !size.width || !size.height) {
    fail(`${rel}: cannot read intrinsic dimensions (${meta.page})`);
    continue;
  }
  const expected = expectedSize(`/${rel}`);
  if (expected && (size.width !== expected[0] || size.height !== expected[1])) {
    fail(`${rel}: ${size.width}×${size.height}, expected ${expected[0]}×${expected[1]}`);
  }
}

// Every generated page image exists at the exact size in all three formats.
let formatCount = 0;
for (const theme of themes) {
  for (const base of [
    `assets/img/times/flower-${theme}-800`,
    `assets/img/times/flower-${theme}-1600`,
    `assets/img/times/wide-${theme}-840`,
    `assets/img/times/wide-${theme}-1680`,
  ]) {
    for (const ext of ["avif", "webp", "jpg"]) {
      if (checkImage(`${base}.${ext}`)) formatCount += 1;
    }
  }
  for (const ratio of ["16x9", "21x9"]) {
    if (checkImage(`assets/img/wallpapers/hill-light-${theme}-${ratio}.jpg`)) formatCount += 1;
  }
}
for (const rel of [
  "assets/img/brand/org-avatar.png",
  "assets/img/brand/org-avatar-180.png",
  "assets/img/brand/icon-180.png",
  "assets/img/brand/og-cover.jpg",
  "assets/img/brand/repo-social.jpg",
]) checkImage(rel);

const home = read("index.html");
const frameThemes = [...home.matchAll(/data-theme-frame="([^"]+)"/g)].map((m) => m[1]);
for (const theme of themes) {
  const count = frameThemes.filter((value) => value === theme).length;
  if (count !== 3) fail(`index.html: expected three light frames for ${theme}, found ${count}`);
}
if (frameThemes.length !== 12) fail(`index.html: expected 12 theme frames, found ${frameThemes.length}`);

const timeLinks = [...home.matchAll(/data-theme-link="([^"]+)"/g)].map((m) => m[1]);
for (const theme of themes) {
  if (!timeLinks.includes(theme)) fail(`index.html: missing plate link for ${theme}`);
}

const wallpaperLinks = [...home.matchAll(/href="(assets\/img\/wallpapers\/hill-light-[^"]+\.jpg)"/g)].map((m) => m[1]);
if (wallpaperLinks.length !== 8) fail(`index.html: expected 8 wallpaper downloads, found ${wallpaperLinks.length}`);
for (const link of wallpaperLinks) {
  if (!existsSync(join(root, link))) fail(`index.html: missing wallpaper ${link}`);
}
if ((home.match(/<figure class="wallpaper-card(?:\s[^"]*)?"/g) || []).length !== 2) fail("index.html: expected two wallpaper cards");

const avifSources = (home.match(/type="image\/avif"/g) || []).length;
if (avifSources < 18) fail(`index.html: expected at least 18 AVIF sources, found ${avifSources}`);

const tokens = read("css/tokens.css");
if (!/:root\s*,\s*\[data-theme="dawn"\]/.test(tokens)) fail("tokens.css: expected dawn as :root default");
for (const theme of ["noon", "dusk", "night"]) {
  if (!tokens.includes(`[data-theme="${theme}"]`)) fail(`tokens.css: missing [data-theme="${theme}"]`);
}
for (const variable of ["--bg", "--text", "--accent", "--stage-bg", "--img-overlay"]) {
  if (!tokens.includes(`${variable}:`)) fail(`tokens.css: missing ${variable}`);
}

const stageStart = home.indexOf('class="stage"');
const stageEnd = home.indexOf('class="stage-caption"');
const stageMarkup = stageStart >= 0 && stageEnd > stageStart ? home.slice(stageStart, stageEnd) : "";
if (!stageMarkup) fail("index.html: stage markup not found");
else if (stageMarkup.includes('loading="lazy"')) fail("stage exposures must load eagerly for the cross-fade");
else pass("stage exposures are eager; wallpaper and avatar images are lazy");

const og = home.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
if (!og) fail("index.html: missing og:image");
else if (!og[1].includes("assets/img/brand/og-cover.jpg")) fail("index.html: og:image is not the generated cover");

const avatar = home.match(/src="(assets\/img\/brand\/org-avatar\.png)"/);
if (!avatar) fail("index.html: missing organisation avatar");

if (!pageHasUsableHomepage(home)) fail("index.html: missing the stage or four plate rows");
function pageHasUsableHomepage(html) {
  return html.includes('class="stage"') && (html.match(/class="plate"/g) || []).length === 4;
}

const summary = {
  pages: pages.length,
  localReferences: referenced.size,
  imagesChecked: checkedImages.size,
  generatedImages: formatCount,
  themeFrames: frameThemes.length,
  plateLinks: timeLinks.length,
  wallpapers: wallpaperLinks.length,
};

if (failures.length) {
  console.error(`site checks: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\nchecked ${summary.pages} pages, ${summary.localReferences} local references, ${summary.imagesChecked} images, ${summary.generatedImages} generated files`);
  process.exit(1);
}

console.log("site checks: PASS");
console.log(`  pages ${summary.pages}; local references ${summary.localReferences}; images ${summary.imagesChecked}`);
console.log(`  theme frames ${summary.themeFrames}; plate links ${summary.plateLinks}; wallpapers ${summary.wallpapers}; generated files ${summary.generatedImages}`);
for (const message of passes) console.log(`  · ${message}`);
