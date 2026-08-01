#!/usr/bin/env node
/**
 * PWA アイコンを生成する。
 *
 * 外部CDNや画像素材を持ち込まない方針のため、図形をコードで描いて PNG を書き出す。
 * 生成物はリポジトリへコミットするので、CI では再生成しない。
 *
 *   npm run generate:icons
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCanvas, downsample, encodePng, fillRoundedRect } from './lib/png.mjs';

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SUPERSAMPLE = 4;

const COLORS = {
  backdrop: [15, 23, 32, 255],
  plate: [23, 41, 63, 255],
  sheetBack: [77, 163, 255, 90],
  sheetMid: [77, 163, 255, 160],
  sheetFront: [232, 238, 245, 255],
  line: [47, 111, 181, 255],
};

const TARGETS = [
  { file: 'icon-192.png', size: 192, glyphScale: 0.56, plate: true },
  { file: 'icon-512.png', size: 512, glyphScale: 0.56, plate: true },
  // maskable はセーフゾーン（中央80%の円）に収める必要があるため、図案を小さくする。
  { file: 'icon-maskable-512.png', size: 512, glyphScale: 0.42, plate: false },
  { file: 'apple-touch-icon.png', size: 180, glyphScale: 0.56, plate: true },
];

/**
 * 文書が積み重なった図案を描く。
 * @param {{width: number, height: number, data: Uint8ClampedArray}} canvas
 */
function drawIcon(canvas, { glyphScale, plate }) {
  const size = canvas.width;

  fillRoundedRect(canvas, 0, 0, size, size, 0, COLORS.backdrop);

  if (plate) {
    const inset = size * 0.07;
    fillRoundedRect(
      canvas,
      inset,
      inset,
      size - inset * 2,
      size - inset * 2,
      size * 0.22,
      COLORS.plate,
    );
  }

  const g = size * glyphScale;
  const cx = size / 2;
  const cy = size / 2;
  const sheetW = g * 0.66;
  const sheetH = g * 0.84;
  const radius = g * 0.09;

  const sheets = [
    { dx: -0.42, dy: -0.5, color: COLORS.sheetBack },
    { dx: -0.3, dy: -0.42, color: COLORS.sheetMid },
    { dx: -0.18, dy: -0.34, color: COLORS.sheetFront },
  ];

  for (const sheet of sheets) {
    fillRoundedRect(
      canvas,
      cx + g * sheet.dx,
      cy + g * sheet.dy,
      sheetW,
      sheetH,
      radius,
      sheet.color,
    );
  }

  // 前面のシートへ本文を示す3本のライン。
  const front = sheets[sheets.length - 1];
  const frontX = cx + g * front.dx;
  const frontY = cy + g * front.dy;
  const lineH = sheetH * 0.075;
  const lineR = lineH / 2;
  const lineX = frontX + sheetW * 0.16;
  const lineWidths = [0.68, 0.68, 0.44];

  lineWidths.forEach((widthRatio, index) => {
    fillRoundedRect(
      canvas,
      lineX,
      frontY + sheetH * (0.26 + index * 0.19),
      sheetW * widthRatio,
      lineH,
      lineR,
      COLORS.line,
    );
  });
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const target of TARGETS) {
    const large = createCanvas(target.size * SUPERSAMPLE, target.size * SUPERSAMPLE);
    drawIcon(large, target);
    const image = downsample(large, SUPERSAMPLE);
    const outputPath = join(OUTPUT_DIR, target.file);
    writeFileSync(outputPath, encodePng(image));
    console.log(`生成しました：public/icons/${target.file} (${target.size}x${target.size})`);
  }
}

main();
