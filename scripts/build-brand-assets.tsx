/**
 * Generates the static brand asset files under `public/brand/` from the single
 * source of truth in `src/components/brand/marks.tsx`.
 *
 * Run with: pnpm brand:build
 *
 * The generated files are used where React cannot render the marks: favicons,
 * e-mail footers, OG images and documentation.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OkunCrmIcon, OkunCrmIconMono, OkunWordmark, CrmWordmark } from "../src/components/brand/marks";

const OUT = join(process.cwd(), "public", "brand");

const INK = "#0D1117";
const WHITE = "#FFFFFF";
const BRAND = "#2563EB";
const ACCENT = "#22D3EE";

function svg(markup: string, color?: string) {
  const withColor = color ? markup.replaceAll("currentColor", color) : markup;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${withColor}\n`;
}

function write(relPath: string, contents: string) {
  const target = join(OUT, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  console.log("  ✓", join("public/brand", relPath));
}

/** Horizontal lockup: icon + OKUN wordmark + CRM type, composed as nested SVG. */
function horizontalLockup(wordColor: string, crmColor: string) {
  const icon = renderToStaticMarkup(<OkunCrmIcon idPrefix="okuncrm" />)
    .replace("<svg ", '<svg x="0" y="4" width="48" height="48" ');
  const word = renderToStaticMarkup(<OkunWordmark />)
    .replaceAll("currentColor", wordColor)
    .replace("<svg ", '<svg x="60" y="9" width="84" height="24" ');
  const crm = renderToStaticMarkup(<CrmWordmark />)
    .replaceAll("currentColor", crmColor)
    .replace("<svg ", '<svg x="61" y="34" width="45" height="12" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 56" width="150" height="56" role="img" aria-label="OKUN CRM">${icon}${word}${crm}</svg>`;
}

function verticalLockup(wordColor: string, crmColor: string) {
  const icon = renderToStaticMarkup(<OkunCrmIcon idPrefix="okuncrmv" />)
    .replace("<svg ", '<svg x="34" y="0" width="64" height="64" ');
  const word = renderToStaticMarkup(<OkunWordmark />)
    .replaceAll("currentColor", wordColor)
    .replace("<svg ", '<svg x="24" y="74" width="84" height="24" ');
  const crm = renderToStaticMarkup(<CrmWordmark />)
    .replaceAll("currentColor", crmColor)
    .replace("<svg ", '<svg x="43" y="100" width="45" height="12" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 118" width="132" height="118" role="img" aria-label="OKUN CRM">${icon}${word}${crm}</svg>`;
}

function poweredBy(color: string) {
  const word = renderToStaticMarkup(<OkunWordmark />)
    .replaceAll("currentColor", color)
    .replace("<svg ", '<svg x="62" y="4" width="49" height="14" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 176 22" width="176" height="22" role="img" aria-label="Powered by OKUN Software"><text x="0" y="15" font-family="Inter, system-ui, sans-serif" font-size="11" fill="${color}" opacity="0.7">Powered by</text>${word}<text x="116" y="15" font-family="Inter, system-ui, sans-serif" font-size="9" letter-spacing="2.4" fill="${color}" opacity="0.75">SOFT</text></svg>`;
}

function withNamespace(markup: string) {
  return markup.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
}

console.log("Building OKUN brand assets…");

// ── OKUN CRM (product) ──
write("okun-crm/icon.svg", svg(withNamespace(renderToStaticMarkup(<OkunCrmIcon idPrefix="okuncrmicon" />))));
write("okun-crm/icon-dark.svg", svg(withNamespace(renderToStaticMarkup(<OkunCrmIconMono />)), INK));
write("okun-crm/icon-light.svg", svg(withNamespace(renderToStaticMarkup(<OkunCrmIconMono />)), WHITE));
write("okun-crm/logo-horizontal.svg", svg(horizontalLockup(INK, BRAND)));
write("okun-crm/logo-horizontal-inverse.svg", svg(horizontalLockup(WHITE, ACCENT)));
write("okun-crm/logo-vertical.svg", svg(verticalLockup(INK, BRAND)));
write("okun-crm/logo-vertical-inverse.svg", svg(verticalLockup(WHITE, ACCENT)));

// ── OKUN Software (manufacturer) ──
write("okun-software/wordmark.svg", svg(withNamespace(renderToStaticMarkup(<OkunWordmark title="OKUN Software" />)), INK));
write("okun-software/wordmark-inverse.svg", svg(withNamespace(renderToStaticMarkup(<OkunWordmark title="OKUN Software" />)), WHITE));
write("okun-software/powered-by.svg", svg(poweredBy(INK)));
write("okun-software/powered-by-inverse.svg", svg(poweredBy(WHITE)));

console.log("Done.");
