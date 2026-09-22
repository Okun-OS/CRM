/**
 * Leitet aus den Originaldateien des Markenpakets die Fassungen ab, die die
 * Oberfläche braucht.
 *
 * Es wird **nichts gezeichnet und nichts umgefärbt**. Das Skript kann nur zwei
 * Dinge: verkleinern und Bildbereiche freistellen. Die Originale bleiben
 * unverändert und liegen zusätzlich unter `public/brand/original/`.
 *
 * Abgeleitet werden:
 *
 * 1. `okun-crm/icon-{512,192,180,32}.png` — Verkleinerungen des Zeichens für
 *    Favicon, App-Icon und Kacheln.
 * 2. `okun-crm/logo-horizontal-inverse-plain.png` — das horizontale Logo ohne
 *    den eingebrannten Claim „KUNDEN. BEZIEHUNGEN. WACHSTUM.". Der Claim ist
 *    rund 3 % der Bildhöhe hoch; in der Navigation (56 px) und auf der
 *    Anmeldeseite wären das 1–3 px, also unleserlicher Brei. Entfernt wird er,
 *    indem der Bereich rechts unterhalb der Wortmarke transparent gesetzt und
 *    das Ergebnis beschnitten wird — gezeichnet wird nichts.
 * 3. `okun-software/logo-plain.png` — dasselbe für das Logo von OKUN Software:
 *    ohne Trennlinie und ohne den zweizeiligen Claim.
 *
 * Sobald OKUN Software die claimfreien Fassungen als eigene Dateien liefert,
 * ersetzen diese die abgeleiteten Dateien und dieses Skript entfällt.
 *
 *   pnpm brand:build
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sharp } from "sharp";

const ROOT = process.cwd();
const rel = (path: string) => path.replace(`${ROOT}/`, "");

const CRM_ICON = join(ROOT, "public/brand/okun-crm/icon.png");
const ICON_SIZES = [512, 192, 180, 32];

/**
 * Der Claim des jeweiligen Logos: alles rechts von `fromX` und unterhalb von
 * `fromY`. Links davon steht das Bildzeichen, das erhalten bleibt.
 */
type ClaimCut = {
  source: string;
  target: string;
  fromX: number;
  fromY: number;
  /** Untergrund des Originals — damit wird der Claimbereich überdeckt. */
  fill: "transparent" | "white";
};

const CLAIM_CUTS: ClaimCut[] = [
  {
    source: "public/brand/okun-crm/logo-horizontal-inverse.png",
    target: "public/brand/okun-crm/logo-horizontal-inverse-plain.png",
    fromX: 600,
    fromY: 615,
    fill: "transparent",
  },
  {
    source: "public/brand/okun-software/logo.png",
    target: "public/brand/okun-software/logo-plain.png",
    fromX: 470,
    fromY: 370,
    fill: "white",
  },
  {
    source: "public/brand/okun-software/logo-cutout.png",
    target: "public/brand/okun-software/logo-cutout-plain.png",
    fromX: 640,
    fromY: 555,
    fill: "transparent",
  },
  {
    source: "public/brand/okun-software/logo-inverse.png",
    target: "public/brand/okun-software/logo-inverse-plain.png",
    fromX: 620,
    fromY: 575,
    fill: "transparent",
  },
];

async function buildIconSizes(sharp: typeof import("sharp").default) {
  const source = await readFile(CRM_ICON);

  for (const size of ICON_SIZES) {
    const resized = await sharp(source)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const target = join(ROOT, "public/brand/okun-crm", `icon-${size}.png`);
    await writeFile(target, resized);
    console.log(`${size}×${size} → ${rel(target)}`);
  }
}

async function cutClaim(sharp: typeof import("sharp").default, cut: ClaimCut) {
  const source = join(ROOT, cut.source);
  const target = join(ROOT, cut.target);

  const image: Sharp = sharp(await readFile(source)).ensureAlpha();
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error(`Bildmaße von ${cut.source} nicht lesbar`);

  const patch = await sharp({
    create: {
      width: width - cut.fromX,
      height: height - cut.fromY,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  // Transparente Originale: Der Bereich wird ausgestanzt (`dest-out`).
  // Das weiße Original: Der Bereich wird weiß übermalt (`over`).
  const withoutClaim = await image
    .composite([
      {
        input: patch,
        left: cut.fromX,
        top: cut.fromY,
        blend: cut.fill === "transparent" ? "dest-out" : "over",
      },
    ])
    .png()
    .toBuffer();

  // Anschließend auf den verbliebenen Inhalt beschneiden, damit das Zeichen
  // nicht in einem leeren Rahmen schwimmt.
  const trimmed = sharp(withoutClaim).trim(
    cut.fill === "transparent"
      ? { background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 }
      : { background: { r: 255, g: 255, b: 255, alpha: 1 }, threshold: 8 },
  );

  const buffer = await trimmed.png().toBuffer();
  const result = await sharp(buffer).metadata();
  await writeFile(target, buffer);
  console.log(`ohne Claim ${result.width}×${result.height} → ${rel(target)}`);
}

async function main() {
  const sharp = (await import("sharp")).default;

  await buildIconSizes(sharp);
  for (const cut of CLAIM_CUTS) await cutClaim(sharp, cut);

  console.log("Fertig. Die Originaldateien selbst bleiben unverändert.");
}

void main();
