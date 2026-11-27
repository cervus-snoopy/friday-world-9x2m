// news-image-20261127 — "The World in One Image: Friday 27 November 2026"
// Morning edition: 50 stories first reported on 27 Nov 2026 (any timezone),
// drawn as vector art on a 1024x1024 canvas with a hand-built 5x7 bitmap font.
// Pure Node stdlib: pixel buffer + PNG encoder (zlib deflate). No network, no assets.
// Deterministic: same bytes on every run.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const buf = Buffer.alloc(W * H * 4);

// ---------- palette ----------
const PAPER = [247, 243, 232];
const INK = [26, 26, 26];
const MUTED = [107, 107, 107];
const RULE = [216, 210, 192];
const WHITE = [255, 255, 255];
const RED = [192, 57, 43];
const BLUE = [31, 78, 121];
const GOLD = [183, 121, 31];
const TEAL = [20, 112, 122];
const GREEN = [39, 106, 66];
const ORANGE = [214, 106, 22];
const PURPLE = [96, 62, 128];
const SKY = [52, 110, 160];
const NIGHT = [18, 28, 48];
const CREAM = [250, 246, 236];

type RGB = [number, number, number];

// ---------- pixel primitives ----------
function px(x: number, y: number, c: RGB): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * 4;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
  buf[i + 3] = 255;
}
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 4;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      buf[i + 3] = 255;
    }
  }
}
function line(x0: number, y0: number, x1: number, y1: number, c: RGB, w = 1): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let s = 0; s <= steps; s++) {
    const x = x0 + (dx * s) / steps;
    const y = y0 + (dy * s) / steps;
    if (w <= 1) px(x, y, c);
    else rect(x - w / 2, y - w / 2, w, w, c);
  }
}
function circle(cx: number, cy: number, r: number, c: RGB): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) px(x, y, c);
    }
  }
}
function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < t; k++) {
      px(cx + (r + k - t / 2) * Math.cos(rad), cy + (r + k - t / 2) * Math.sin(rad), c);
    }
  }
}
function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const minX = Math.floor(Math.min(x0, x1, x2));
  const maxX = Math.ceil(Math.max(x0, x1, x2));
  const minY = Math.floor(Math.min(y0, y1, y2));
  const maxY = Math.ceil(Math.max(y0, y1, y2));
  const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = ((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x)) / d;
      const b = ((x2 - x) * (y0 - y) - (y2 - y) * (x0 - x)) / d;
      const g = 1 - a - b;
      if (a >= 0 && b >= 0 && g >= 0) px(x, y, c);
    }
  }
}
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(x, y, c);
    }
  }
}
function shade(c: RGB, f: number): RGB {
  return [
    Math.max(0, Math.min(255, Math.round(c[0] * f))),
    Math.max(0, Math.min(255, Math.round(c[1] * f))),
    Math.max(0, Math.min(255, Math.round(c[2] * f))),
  ];
}

// ---------- CRC32 + PNG ----------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}
function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    buf.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 5x7 bitmap font (7 rows of 5 bits) ----------
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  b: ["10000", "10000", "10110", "11001", "10001", "10001", "11110"],
  c: ["00000", "00000", "01110", "10001", "10000", "10001", "01110"],
  d: ["00001", "00001", "01101", "10011", "10001", "10001", "01111"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  f: ["00110", "01001", "01000", "11110", "01000", "01000", "01000"],
  g: ["00000", "01111", "10001", "10001", "01111", "00001", "01110"],
  h: ["10000", "10000", "10110", "11001", "10001", "10001", "10001"],
  i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
  j: ["00010", "00000", "00110", "00010", "00010", "10010", "01100"],
  k: ["10000", "10000", "10010", "10100", "11000", "10100", "10010"],
  l: ["01100", "00100", "00100", "00100", "00100", "00100", "01110"],
  m: ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  n: ["00000", "00000", "10110", "11001", "10001", "10001", "10001"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  p: ["00000", "10110", "11001", "10001", "10001", "11110", "10000"],
  q: ["00000", "00000", "01101", "10011", "10001", "01111", "00001"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  t: ["01000", "01000", "11110", "01000", "01000", "01000", "00110"],
  u: ["00000", "00000", "10001", "10001", "10001", "10011", "01101"],
  v: ["00000", "00000", "10001", "10001", "10001", "01010", "00100"],
  w: ["00000", "00000", "10001", "10101", "10101", "10101", "01010"],
  x: ["00000", "00000", "10001", "01010", "00100", "01010", "10001"],
  y: ["00000", "00000", "10001", "10001", "01111", "00001", "01110"],
  z: ["00000", "00000", "11111", "00010", "00100", "01000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  '"': ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "\u2022": ["00000", "00000", "01100", "01100", "00000", "00000", "00000"],
};

// ---------- text rendering ----------
function drawChar(ch: string, x: number, y: number, s: number, c: RGB): void {
  const g = FONT[ch];
  if (!g) return;
  for (let r = 0; r < 7; r++) {
    const row = g[r];
    for (let col = 0; col < 5; col++) {
      if (row[col] === "1") rect(x + col * s, y + r * s, s, s, c);
    }
  }
}
function textWidth(s: string, scale: number): number {
  let w = 0;
  for (const ch of s) w += 6 * scale;
  return w - scale;
}
function drawText(s: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    drawChar(ch, cx, y, scale, c);
    cx += 6 * scale;
  }
}
function drawTextCentered(s: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(s, cx - Math.floor(textWidth(s, scale) / 2), y, scale, c);
}
function wrapText(s: string, scale: number, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (textWidth(test, scale) <= maxW) cur = test;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- story data: 50 stories, all first reported Fri 27 Nov 2026 ----------
// region: ME Middle East | NA North America | UK United Kingdom | WE Western Europe
//         EE Eastern Europe | SA South Asia | EA East Asia | OC Oceania | AF Africa | LA Latin America
// time: UTC unless marked IST (India, UTC+5:30) or NZ (UTC+13) — all are 27 Nov in their zone.
type Story = { h: string; region: string; field: string; time: string; src: string };
const STORIES: Story[] = [
  { h: "Iran drone strike on Kuwait kills 2 Italians; Tehran denies it", region: "ME", field: "Conflict", time: "01:03 UTC", src: "NYT/BBC" },
  { h: "Israel kills 10 in Gaza; Hamas weighs its response", region: "ME", field: "Conflict", time: "02:26 UTC", src: "Reuters" },
  { h: "Storm postpones 100th Macy's parade; 500,000 lose power", region: "NA", field: "Weather", time: "27 Nov", src: "News Fix" },
  { h: "Gukesh, Sindarov draw marathon Game 3 of chess title match", region: "EA", field: "Sport", time: "00:26 UTC", src: "India Today" },
  { h: "Musk: every US child will get two SpaceX shares", region: "NA", field: "Tech", time: "01:49 UTC", src: "The Hindu" },
  { h: "Diesel tanker capsizes off Ibiza; 1 dead, 7,000 tonnes aboard", region: "WE", field: "Disaster", time: "03:31 UTC", src: "BBC" },
  { h: "Depardieu to stand trial over alleged 2018 rape", region: "WE", field: "Courts", time: "02:11 UTC", src: "BBC" },
  { h: "UK net migration falls to lowest since 1997", region: "UK", field: "Migration", time: "00:22 UTC", src: "NYT" },
  { h: "Black Friday: half of NZ deals no cheaper, study finds", region: "OC", field: "Economy", time: "27 Nov", src: "Consumer NZ" },
  { h: "Pant plays NZ club cricket as 'Stan Stan'", region: "OC", field: "Sport", time: "27 Nov", src: "BBC" },
  { h: "New evidence of a giant planet beyond Neptune", region: "EA", field: "Science", time: "27 Nov", src: "News" },
  { h: "Anthropic Claude turns artifacts into apps", region: "NA", field: "Tech", time: "27 Nov", src: "Mashable" },
  { h: "Australia braces for severe bushfire season", region: "OC", field: "Climate", time: "27 Nov", src: "News" },
  { h: "NZ final count due; coalition holds slim 67 of 131", region: "OC", field: "Politics", time: "27 Nov", src: "News Fix" },
  { h: "India top court: bench must sit to confirm PMLA seizures", region: "SA", field: "Courts", time: "03:46 IST", src: "TOI" },
  { h: "India court quashes Anand Mohan early release", region: "SA", field: "Courts", time: "03:43 IST", src: "TOI" },
  { h: "India cabinet backs Rs 11,000 cr equipment scheme", region: "SA", field: "Economy", time: "02:36 IST", src: "News On AIR" },
  { h: "China's drones are reshaping Asia's militaries", region: "EA", field: "Defence", time: "02:55 IST", src: "Mint" },
  { h: "Trump seeks probe into 'fake' GDP after 4.3% revision", region: "NA", field: "Politics", time: "00:03 UTC", src: "Mint" },
  { h: "Kim vows more nuclear arms, spurns Trump offer", region: "EA", field: "Diplomacy", time: "01:02 UTC", src: "News" },
  { h: "Decisive Ukraine moment may come in 2027, says Rinkevics", region: "EE", field: "War", time: "01:02 UTC", src: "News" },
  { h: "Zelenskyy warns of major Russian strike on power grid", region: "EE", field: "War", time: "27 Nov", src: "News" },
  { h: "EU leaders weigh new financial aid for Ukraine", region: "WE", field: "Diplomacy", time: "27 Nov", src: "News" },
  { h: "Nepal declares 4,000 landslide victims dead", region: "SA", field: "Disaster", time: "27 Nov", src: "News" },
  { h: "Iraq lifts oil exports to 3.6m barrels a day", region: "ME", field: "Energy", time: "27 Nov", src: "News" },
  { h: "Sudan army says it downed a drone in South Kordofan", region: "AF", field: "Conflict", time: "27 Nov", src: "News" },
  { h: "Colombia hostage tells of 17-hour supermarket siege", region: "LA", field: "Crime", time: "27 Nov", src: "Arab News" },
  { h: "Macron hits back at Le Pen 'arrogance'", region: "WE", field: "Politics", time: "27 Nov", src: "Arab News" },
  { h: "Germany arrests two over synagogue attack plot", region: "WE", field: "Security", time: "27 Nov", src: "Arab News" },
  { h: "Hong Kong marks deadly fire anniversary", region: "EA", field: "Society", time: "27 Nov", src: "Arab News" },
  { h: "Five nations buy BAE combat vehicles, Finland says", region: "WE", field: "Defence", time: "27 Nov", src: "Arab News" },
  { h: "Romania seeks bigger German role as Russia provokes", region: "EE", field: "Diplomacy", time: "27 Nov", src: "Arab News" },
  { h: "Duran Duran guitarist Andy Taylor dies at 65", region: "UK", field: "Culture", time: "27 Nov", src: "BBC" },
  { h: "Boxing chiefs to assess Fury before next fight", region: "UK", field: "Sport", time: "27 Nov", src: "BBC" },
  { h: "UK youth jobless total nears one million", region: "UK", field: "Society", time: "27 Nov", src: "BBC" },
  { h: "NHS warns of 'horrible' flu spike in England", region: "UK", field: "Health", time: "27 Nov", src: "BBC" },
  { h: "Princess of Wales visits Borders arts project", region: "UK", field: "Royalty", time: "27 Nov", src: "BBC" },
  { h: "Tommy Robinson charged over phone PIN refusal", region: "UK", field: "Courts", time: "27 Nov", src: "BBC" },
  { h: "Rugby voice Starmer-Smith dies aged 81", region: "UK", field: "Sport", time: "27 Nov", src: "BBC" },
  { h: "Calvert-Lewin signs new Leeds deal to 2029", region: "UK", field: "Sport", time: "27 Nov", src: "BBC" },
  { h: "Bournemouth dream of Europa League final", region: "UK", field: "Sport", time: "27 Nov", src: "BBC" },
  { h: "Ferrari sets Hamilton, Leclerc a clear target", region: "WE", field: "Sport", time: "01:06 UTC", src: "RacingNews365" },
  { h: "India A face Sri Lanka A in Rising Stars semi", region: "SA", field: "Sport", time: "27 Nov", src: "News" },
  { h: "India women beat Japan 4-0 in hockey trophy", region: "SA", field: "Sport", time: "27 Nov", src: "News" },
  { h: "Barrett to captain All Blacks for first time", region: "OC", field: "Sport", time: "27 Nov", src: "News Fix" },
  { h: "Kibori tied second at Australian PGA", region: "OC", field: "Sport", time: "27 Nov", src: "News Fix" },
  { h: "Pakistan astronaut to fly to China's station", region: "SA", field: "Space", time: "27 Nov", src: "News" },
  { h: "TB fight faltering as aid cuts bite, say campaigners", region: "EA", field: "Health", time: "27 Nov", src: "News" },
  { h: "Diana's charity files for insolvency", region: "UK", field: "Society", time: "27 Nov", src: "News" },
  { h: "Iran monarchists disrupt Paris event", region: "WE", field: "Politics", time: "27 Nov", src: "Arab News" },
];
const REGION_COLOR: Record<string, RGB> = {
  ME: RED, NA: BLUE, UK: PURPLE, WE: SKY, EE: [120, 60, 60],
  SA: ORANGE, EA: TEAL, OC: GREEN, AF: GOLD, LA: [160, 40, 90],
};
const REGION_NAME: Record<string, string> = {
  ME: "MIDDLE EAST", NA: "N. AMERICA", UK: "UK", WE: "W. EUROPE", EE: "E. EUROPE",
  SA: "S. ASIA", EA: "E. ASIA", OC: "OCEANIA", AF: "AFRICA", LA: "LATIN AMERICA",
};

// ---------- scenes (each draws inside x,y,w,h) ----------
function panel(x: number, y: number, w: number, h: number, bg: RGB): void {
  rect(x, y, w, h, bg);
  rect(x, y, w, 2, INK);
  rect(x, y + h - 2, w, 2, INK);
  rect(x, y, 2, h, INK);
  rect(x + w - 2, y, 2, h, INK);
}
function stars(x: number, y: number, w: number, h: number, n: number, seed: number): void {
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const sx = x + (s % Math.max(1, w - 4)) + 2;
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const sy = y + (s % Math.max(1, h - 4)) + 2;
    px(sx, sy, WHITE);
    if (s % 3 === 0) px(sx + 1, sy, WHITE);
  }
}
function sceneKuwait(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, NIGHT);
  stars(x, y, w, Math.floor(h * 0.6), 26, 7);
  // drone silhouette
  const dx = x + w * 0.62;
  const dy = y + h * 0.3;
  rect(dx - 14, dy - 4, 28, 8, INK);
  line(dx - 20, dy - 12, dx + 20, dy - 12, [120, 120, 120], 2);
  line(dx - 20, dy + 12, dx + 20, dy + 12, [120, 120, 120], 2);
  circle(dx - 20, dy - 12, 4, [150, 150, 150]);
  circle(dx + 20, dy - 12, 4, [150, 150, 150]);
  circle(dx - 20, dy + 12, 4, [150, 150, 150]);
  circle(dx + 20, dy + 12, 4, [150, 150, 150]);
  circle(dx, dy + 2, 3, RED);
  // explosion burst over the gulf
  const ex = x + w * 0.28;
  const ey = y + h * 0.62;
  circle(ex, ey, 26, ORANGE);
  circle(ex, ey, 17, GOLD);
  circle(ex, ey, 9, [255, 220, 120]);
  for (let a = 0; a < 8; a++) {
    const ang = (a * Math.PI) / 4;
    line(ex, ey, ex + 34 * Math.cos(ang), ey + 34 * Math.sin(ang), ORANGE, 3);
  }
  // sea
  rect(x, y + h - 18, w, 18, [16, 60, 96]);
  line(x + 8, y + h - 10, x + w - 8, y + h - 10, [90, 140, 190], 2);
  line(x + 20, y + h - 5, x + w - 20, y + h - 5, [90, 140, 190], 2);
}
function sceneGaza(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, [232, 196, 150]);
  rect(x, y, w, Math.floor(h * 0.45), [214, 150, 96]);
  circle(x + w * 0.78, y + h * 0.2, 16, [255, 220, 150]);
  // skyline, broken
  const base = y + h - 16;
  const hs = [52, 78, 44, 92, 60, 84, 38];
  let bx = x + 6;
  for (let i = 0; i < hs.length; i++) {
    const bw = (w - 12) / hs.length - 3;
    rect(bx, base - hs[i], bw, hs[i], [52, 48, 48]);
    bx += bw + 3;
  }
  // leaning broken tower
  tri(x + w * 0.42, base - 60, x + w * 0.42 + 16, base - 60, x + w * 0.42 + 26, base, [52, 48, 48]);
  // smoke columns
  circle(x + w * 0.3, y + h * 0.32, 12, [120, 116, 110]);
  circle(x + w * 0.3, y + h * 0.2, 16, [140, 136, 130]);
  circle(x + w * 0.66, y + h * 0.26, 10, [120, 116, 110]);
  rect(x, y + h - 16, w, 16, [70, 64, 58]);
}
function sceneStorm(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, [58, 74, 96]);
  // storm clouds
  circle(x + w * 0.25, y + h * 0.22, 26, [40, 48, 64]);
  circle(x + w * 0.5, y + h * 0.16, 32, [34, 42, 58]);
  circle(x + w * 0.76, y + h * 0.24, 26, [40, 48, 64]);
  rect(x, y + h * 0.3, w, 10, [40, 48, 64]);
  // rain
  for (let i = 0; i < 22; i++) {
    const rx = x + 8 + i * 14;
    line(rx, y + h * 0.42, rx - 6, y + h * 0.42 + 26, [150, 180, 210], 2);
  }
  // grounded parade balloon, deflated on the street
  ellipse(x + w * 0.5, y + h * 0.78, 52, 16, RED);
  ellipse(x + w * 0.5, y + h * 0.78, 34, 9, [255, 120, 110]);
  rect(x, y + h - 12, w, 12, [30, 34, 44]);
  line(x + 10, y + h - 12, x + w - 10, y + h - 12, [200, 200, 200], 2);
}
function sceneChess(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, CREAM);
  const s = Math.min(w, h - 26) / 8;
  const ox = x + (w - s * 8) / 2;
  const oy = y + 8;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 0) rect(ox + c * s, oy + r * s, s, s, [90, 60, 40]);
      else rect(ox + c * s, oy + r * s, s, s, [240, 220, 190]);
    }
  }
  // white king and black king facing off
  circle(ox + 2.5 * s, oy + 3.5 * s, s * 0.42, WHITE);
  rect(ox + 2.5 * s - 1, oy + 3.5 * s - s * 0.7, 2, s * 0.5, WHITE);
  circle(ox + 5.5 * s, oy + 4.5 * s, s * 0.42, INK);
  rect(ox + 5.5 * s - 1, oy + 4.5 * s - s * 0.7, 2, s * 0.5, INK);
}
function sceneRocket(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, NIGHT);
  stars(x, y, w, h - 26, 18, 21);
  const cx = x + w / 2;
  const top = y + 14;
  // flame
  tri(cx - 8, y + h - 52, cx + 8, y + h - 52, cx, y + h - 30, ORANGE);
  tri(cx - 5, y + h - 52, cx + 5, y + h - 52, cx, y + h - 38, GOLD);
  // body
  rect(cx - 10, top + 22, 20, 52, WHITE);
  tri(cx - 10, top + 22, cx + 10, top + 22, cx, top, RED);
  tri(cx - 10, y + h - 52, cx - 20, y + h - 40, cx - 10, y + h - 40, RED);
  tri(cx + 10, y + h - 52, cx + 20, y + h - 40, cx + 10, y + h - 40, RED);
  circle(cx, top + 34, 5, SKY);
  // two gold share coins
  circle(x + 16, y + h - 40, 9, GOLD);
  circle(x + w - 16, y + h - 40, 9, GOLD);
  drawText("S", x + 13, y + h - 44, 1, INK);
  drawText("S", x + w - 19, y + h - 44, 1, INK);
}
function sceneTanker(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, [168, 200, 220]);
  // sea
  rect(x, y + h * 0.55, w, Math.floor(h * 0.45), [24, 80, 130]);
  // capsized hull, tilted
  tri(x + w * 0.2, y + h * 0.5, x + w * 0.8, y + h * 0.38, x + w * 0.86, y + h * 0.56, [120, 30, 30]);
  tri(x + w * 0.2, y + h * 0.5, x + w * 0.86, y + h * 0.56, x + w * 0.3, y + h * 0.62, [90, 22, 22]);
  // oil slick
  ellipse(x + w * 0.55, y + h * 0.78, 46, 10, [16, 16, 20]);
  ellipse(x + w * 0.3, y + h * 0.86, 26, 7, [16, 16, 20]);
  // waves
  line(x + 6, y + h * 0.68, x + w - 6, y + h * 0.68, [140, 190, 220], 2);
}
function sceneCourt(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, CREAM);
  // pediment + columns
  tri(x + 10, y + 26, x + w - 10, y + 26, x + w / 2, y + 8, [120, 100, 70]);
  for (let i = 0; i < 4; i++) {
    const cx = x + 22 + i * ((w - 44) / 3);
    rect(cx - 5, y + 30, 10, h - 56, [200, 190, 170]);
  }
  rect(x + 8, y + h - 26, w - 16, 6, [120, 100, 70]);
  rect(x + 8, y + h - 18, w - 16, 4, [160, 140, 110]);
  // gavel
  rect(x + w * 0.62, y + h - 44, 26, 7, [90, 60, 40]);
  line(x + w * 0.62 + 13, y + h - 44, x + w * 0.62 + 20, y + h - 32, [90, 60, 40], 3);
}
function sceneMigration(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, WHITE);
  const ox = x + 16;
  const oy = y + h - 30;
  line(ox, y + 12, ox, oy, INK, 2);
  line(ox, oy, x + w - 12, oy, INK, 2);
  // falling line 1997 -> 2026
  line(ox + 6, y + 18, ox + 30, y + 26, RED, 3);
  line(ox + 30, y + 26, ox + 58, y + 30, RED, 3);
  line(ox + 58, y + 30, ox + 92, y + 52, RED, 3);
  line(ox + 92, y + 52, ox + 118, y + 66, RED, 3);
  // down arrow
  tri(ox + 118, y + 74, ox + 110, y + 60, ox + 126, y + 60, RED);
  circle(ox + 6, y + 18, 4, RED);
  circle(ox + 118, y + 66, 4, RED);
}
function sceneBag(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, [250, 238, 220]);
  const cx = x + w / 2;
  // handle
  ring(cx, y + 30, 14, 3, INK);
  // bag body
  tri(cx - 34, y + 34, cx + 34, y + 34, cx + 28, y + h - 30, RED);
  tri(cx - 34, y + 34, cx + 28, y + h - 30, cx - 28, y + h - 30, RED);
  rect(cx - 34, y + 34, 68, 8, [150, 30, 30]);
  // price tag
  rect(x + w - 34, y + h - 44, 26, 16, GOLD);
  line(x + w - 34, y + h - 36, x + w - 20, y + h - 36, INK, 2);
  circle(x + w - 30, y + h - 36, 2, WHITE);
}
function sceneCricket(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, [190, 220, 160]);
  // pitch
  rect(x, y + h - 34, w, 34, [210, 190, 140]);
  // stumps
  for (let i = 0; i < 3; i++) rect(x + w * 0.72 + i * 6, y + h - 58, 3, 24, GOLD);
  // bat, swung
  line(x + w * 0.3, y + h * 0.62, x + w * 0.52, y + h * 0.3, [220, 190, 130], 7);
  line(x + w * 0.52, y + h * 0.3, x + w * 0.58, y + h * 0.2, [120, 90, 60], 4);
  // ball
  circle(x + w * 0.68, y + h * 0.24, 7, RED);
  circle(x + w * 0.68, y + h * 0.24, 3, [255, 120, 110]);
}
function scenePlanet(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, NIGHT);
  stars(x, y, w, h - 26, 22, 33);
  const cx = x + w * 0.55;
  const cy = y + h * 0.45;
  circle(cx, cy, 26, TEAL);
  circle(cx - 8, cy - 8, 10, shade(TEAL, 1.3));
  // ring band
  line(cx - 44, cy + 12, cx + 44, cy - 12, GOLD, 3);
  line(cx - 40, cy + 18, cx + 40, cy - 6, shade(GOLD, 0.7), 2);
  // telescope hint
  line(x + 14, y + h - 30, x + 34, y + h - 52, [200, 200, 200], 3);
  circle(x + 36, y + h - 54, 5, SKY);
}
function sceneLaptop(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, [228, 236, 242]);
  const cx = x + w / 2;
  // screen
  rect(cx - 44, y + 14, 88, 58, INK);
  rect(cx - 40, y + 18, 80, 50, [250, 250, 250]);
  // app blocks inside
  rect(cx - 34, y + 24, 22, 16, BLUE);
  rect(cx - 8, y + 24, 22, 16, TEAL);
  rect(cx - 34, y + 44, 22, 16, ORANGE);
  rect(cx - 8, y + 44, 22, 16, GREEN);
  // base
  tri(cx - 52, y + 78, cx + 52, y + 78, cx + 58, y + h - 32, [180, 180, 180]);
  tri(cx - 52, y + 78, cx + 58, y + h - 32, cx - 58, y + h - 32, [180, 180, 180]);
}
function sceneFire(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, [240, 200, 140]);
  // dry ground
  rect(x, y + h - 26, w, 26, [150, 110, 60]);
  // eucalyptus silhouette
  rect(x + 18, y + h - 56, 6, 30, [60, 50, 40]);
  circle(x + 21, y + h - 62, 14, [40, 80, 50]);
  // flames
  tri(x + w * 0.55, y + h - 30, x + w * 0.7, y + h - 30, x + w * 0.62, y + h - 78, ORANGE);
  tri(x + w * 0.68, y + h - 30, x + w * 0.86, y + h - 30, x + w * 0.78, y + h - 62, RED);
  circle(x + w * 0.62, y + h - 34, 12, GOLD);
  // smoke
  circle(x + w * 0.62, y + h - 84, 12, [120, 116, 110]);
  circle(x + w * 0.66, y + h - 96, 9, [140, 136, 130]);
}
function sceneBallot(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, CREAM);
  const cx = x + w / 2;
  // ballot box
  rect(cx - 34, y + 34, 68, 52, BLUE);
  rect(cx - 40, y + 28, 80, 10, shade(BLUE, 0.7));
  rect(cx - 12, y + 30, 24, 4, INK);
  // ballot paper going in
  tri(cx - 16, y + 30, cx + 4, y + 30, cx - 2, y + 12, WHITE);
  tri(cx - 16, y + 30, cx - 2, y + 12, cx - 20, y + 12, WHITE);
  // check mark on the box
  line(cx - 20, y + 58, cx - 10, y + 68, WHITE, 3);
  line(cx - 10, y + 68, cx + 14, y + 44, WHITE, 3);
}
function sceneScales(x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, CREAM);
  const cx = x + w / 2;
  const top = y + 16;
  // pillar + beam
  rect(cx - 2, top + 6, 4, h - 44, [120, 100, 70]);
  line(cx - 40, top + 10, cx + 40, top + 10, [120, 100, 70], 3);
  circle(cx, top + 4, 5, GOLD);
  // left pan (heavy, lower)
  line(cx - 40, top + 10, cx - 40, top + 34, [120, 100, 70], 2);
  tri(cx - 54, top + 34, cx - 26, top + 34, cx - 40, top + 52, GOLD);
  // right pan (higher)
  line(cx + 40, top + 10, cx + 40, top + 26, [120, 100, 70], 2);
  tri(cx + 26, top + 26, cx + 54, top + 26, cx + 40, top + 44, GOLD);
  // base
  rect(cx - 22, y + h - 34, 44, 6, [120, 100, 70]);
}

// ---------- layout ----------
function tagChip(x: number, y: number, region: string): void {
  rect(x, y, 10, 10, REGION_COLOR[region]);
  drawText(REGION_NAME[region], x + 14, y + 1, 1, MUTED);
}
function leadPanel(x: number, scene: (x: number, y: number, w: number, h: number) => void, story: Story, title: string, detail: string): void {
  scene(x, 124, 312, 138);
  tagChip(x, 270, story.region);
  drawText(title, x, 286, 2, INK);
  drawText(detail, x, 302, 1, MUTED);
}
function stripPanel(x: number, scene: (x: number, y: number, w: number, h: number) => void, label: string, yTop: number): void {
  scene(x, yTop, 156, 100);
  const lines = wrapText(label, 2, 148);
  for (let i = 0; i < Math.min(2, lines.length); i++) {
    drawText(lines[i], x + 4, yTop + 106 + i * 14, 2, INK);
  }
}
function timeline(): void {
  const y0 = 362;
  line(60, y0, 996, y0, INK, 2);
  for (let h = 0; h <= 4; h++) {
    const tx = 60 + (h / 4) * 936;
    line(tx, y0 - 5, tx, y0 + 5, INK, 2);
    drawTextCentered("0" + h + ":00", tx, y0 + 10, 1, MUTED);
  }
  type Ev = { m: number; label: string; slot: number };
  const evs: Ev[] = [
    { m: 3, label: "TRUMP GDP", slot: 1 },
    { m: 22, label: "UK MIGRATION", slot: 2 },
    { m: 26, label: "GUKESH DRAW", slot: 0 },
    { m: 63, label: "KUWAIT STRIKE", slot: 2 },
    { m: 109, label: "MUSK SHARES", slot: 1 },
    { m: 131, label: "DEPARDIEU TRIAL", slot: 2 },
    { m: 146, label: "GAZA 10 DEAD", slot: 0 },
    { m: 211, label: "IBIZA TANKER", slot: 2 },
  ];
  for (const e of evs) {
    const ex = 60 + (e.m / 240) * 936;
    circle(ex, y0, 5, RED);
    circle(ex, y0, 2, WHITE);
    const ly = e.slot === 0 ? 330 : e.slot === 1 ? 342 : 384;
    drawTextCentered(e.label, Math.max(40, Math.min(984, ex)), ly, 1, INK);
  }
}
function grid(): void {
  drawText("THE REST OF THE DAY", 28, 686, 2, INK);
  rect(28, 706, 968, 2, RULE);
  const rest = STORIES.slice(15);
  for (let i = 0; i < rest.length; i++) {
    const col = i < 18 ? 0 : 1;
    const row = i < 18 ? i : i - 18;
    const gx = col === 0 ? 28 : 526;
    const gy = 716 + row * 14;
    const s = rest[i];
    rect(gx, gy + 1, 8, 8, REGION_COLOR[s.region]);
    drawText(s.h, gx + 12, gy, 1, INK);
  }
}
function main(): void {
  if (STORIES.length !== 50) throw new Error("need exactly 50 stories, have " + STORIES.length);
  rect(0, 0, W, H, PAPER);
  // outer frame
  rect(8, 8, W - 16, 2, INK);
  rect(8, H - 10, W - 16, 2, INK);
  rect(8, 8, 2, H - 16, INK);
  rect(W - 10, 8, 2, H - 16, INK);
  // header
  drawText("MAKE.FUN DAILY NEWS IMAGE", 28, 24, 1, MUTED);
  drawText("FRIDAY 27 NOVEMBER 2026", 28, 40, 5, INK);
  drawText("THE WORLD IN ONE IMAGE - 50 STORIES - 10 REGIONS - 22 FIELDS", 28, 86, 2, RED);
  rect(28, 110, 968, 2, INK);
  // three lead scenes
  leadPanel(28, sceneKuwait, STORIES[0], "DRONE STRIKE ON KUWAIT", "2 Italians killed; Tehran denies it");
  leadPanel(356, sceneGaza, STORIES[1], "GAZA: 10 KILLED", "Hamas weighs response after strikes");
  leadPanel(684, sceneStorm, STORIES[2], "STORM STOPS THE PARADE", "100th Macy's parade off; 500k in dark");
  // UTC timeline of the morning
  timeline();
  // twelve inline scenes, two rows of six
  const row1: Array<[number, (x: number, y: number, w: number, h: number) => void, string]> = [
    [0, sceneChess, "GUKESH DRAWS"],
    [1, sceneRocket, "MUSK: 2 SHARES"],
    [2, sceneTanker, "TANKER SINKS"],
    [3, sceneCourt, "DEPARDIEU TRIAL"],
    [4, sceneMigration, "MIGRATION FALLS"],
    [5, sceneBag, "BLACK FRIDAY"],
  ];
  const row2: Array<[number, (x: number, y: number, w: number, h: number) => void, string]> = [
    [0, sceneCricket, "PANT'S SECRET GAME"],
    [1, scenePlanet, "PLANET NEPTUNE"],
    [2, sceneLaptop, "CLAUDE BUILDS APPS"],
    [3, sceneFire, "BUSHFIRE SEASON"],
    [4, sceneBallot, "NZ FINAL COUNT"],
    [5, sceneScales, "COURT: PMLA BENCH"],
  ];
  for (const [i, fn, label] of row1) stripPanel(28 + i * 162, fn, label, 396);
  for (const [i, fn, label] of row2) stripPanel(28 + i * 162, fn, label, 540);
  // story grid
  grid();
  // footer: date check + sources
  rect(28, 972, 968, 2, INK);
  drawTextCentered("ALL 50 STORIES FIRST REPORTED FRIDAY 27 NOVEMBER 2026, ANY TIME ZONE", 512, 982, 1, INK);
  drawTextCentered("SOURCES: NYT - BBC - REUTERS - TOI - INDIA TODAY - MINT - NDTV - THE HINDU - ARAB NEWS - NEWS FIX", 512, 994, 1, MUTED);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "entry.png");
  const png = encodePNG();
  fs.writeFileSync(outPath, png);
  fs.chmodSync(outPath, 0o644);
  console.log("wrote " + outPath + " (" + png.length + " bytes, " + STORIES.length + " stories)");
}
main();
