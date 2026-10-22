#!/usr/bin/env node
/**
 * Hill Light contrast audit.
 *
 * Parses the semantic tokens in css/tokens.css, then checks the pairs that
 * actually carry text or focus in the static site. Fails with exit code 1 when
 * a normal-text pair drops below 4.5:1 or a focus indicator below 3:1.
 *
 * Usage: node scripts/check-contrast.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "css/tokens.css"), "utf8");

const themes = {};
for (const match of css.matchAll(/\[data-theme="(\w+)"\]\s*\{([\s\S]*?)\n\}/g)) {
  const tokens = {};
  for (const decl of match[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[decl[1]] = decl[2].trim();
  }
  themes[match[1]] = tokens;
}

function luminance(hex) {
  let value = hex.replace("#", "");
  if (value.length === 3) value = value.split("").map((c) => c + c).join("");
  const channels = [0, 2, 4]
    .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

// [foreground, background, minimum, label]
const checks = [
  ["text", "bg", 4.5, "正文 / 纸面"],
  ["text", "bg-elevated", 4.5, "正文 / 抬升面"],
  ["text", "bg-subtle", 4.5, "正文 / 次级面"],
  ["text-muted", "bg", 4.5, "次级文字 / 纸面"],
  ["text-muted", "bg-elevated", 4.5, "次级文字 / 抬升面"],
  ["text-muted", "bg-subtle", 4.5, "次级文字 / 次级面"],
  ["text-faint", "bg", 4.5, "微文字 / 纸面"],
  ["text-faint", "bg-elevated", 4.5, "微文字 / 抬升面"],
  ["accent", "bg", 4.5, "链接 / 纸面"],
  ["accent", "bg-elevated", 4.5, "链接 / 抬升面"],
  ["accent", "bg-subtle", 4.5, "链接 / 次级面"],
  ["accent-contrast", "accent", 4.5, "反白 / 强调面"],
  ["focus-ring", "bg", 3, "焦点环 / 纸面"],
];

let failed = 0;
console.log("Hill Light · contrast audit\n");

for (const [theme, tokens] of Object.entries(themes)) {
  console.log(`## ${theme}`);
  for (const [fg, bg, minimum, label] of checks) {
    if (!tokens[fg] || !tokens[bg]) {
      console.log(`  ? ${label}: missing token`);
      failed += 1;
      continue;
    }
    const ratio = contrast(tokens[fg], tokens[bg]);
    const ok = ratio >= minimum;
    if (!ok) failed += 1;
    console.log(
      `  ${ok ? "PASS" : "FAIL"} ${ratio.toFixed(2).padStart(6)}  ${label}` +
        ` (${tokens[fg]} on ${tokens[bg]}, need ${minimum})`
    );
  }
  console.log("");
}

if (failed) {
  console.error(`${failed} contrast check(s) failed.`);
  process.exit(1);
}
console.log("All contrast checks passed.");
