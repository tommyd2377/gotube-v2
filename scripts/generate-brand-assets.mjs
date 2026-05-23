import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB_PUBLIC = path.join(ROOT, "apps/web/public");
const BRAND_DIR = path.join(WEB_PUBLIC, "brand");
const FIRETV_DRAWABLE_NODPI = path.join(ROOT, "apps/firetv/src/main/res/drawable-nodpi");
const FIRETV_MIPMAPS = [
  ["mipmap-mdpi", 48],
  ["mipmap-hdpi", 72],
  ["mipmap-xhdpi", 96],
  ["mipmap-xxhdpi", 144],
  ["mipmap-xxxhdpi", 192]
];

const BLUE = "#168BFF";
const BLUE_BRIGHT = "#34A3FF";
const BLUE_DEEP = "#006DFF";
const BG = "#02050B";
const PANEL = "#071021";
const STROKE = "#3A4562";

function escapeJson(value) {
  return JSON.stringify(value, null, 2);
}

function logoMark({ size = 1024, variant = "blue", frame = false } = {}) {
  const scale = size / 1024;
  const strokeColor = variant === "white" ? "#FFFFFF" : variant === "black" ? "#05070B" : "url(#blueStroke)";
  const fillColor = variant === "white" ? "#FFFFFF" : variant === "black" ? "#05070B" : "url(#blueFill)";
  const dotColor = variant === "outline" ? "transparent" : fillColor;
  const opacity = variant === "outline" ? "0.98" : "1";
  const filter = variant === "blue" ? "filter=\"url(#softGlow)\"" : "";

  return `
    <g transform="scale(${scale})" ${filter} opacity="${opacity}">
      ${frame ? `
        <rect x="72" y="72" width="880" height="880" rx="168" fill="url(#iconPanel)" stroke="${STROKE}" stroke-width="8"/>
        <rect x="94" y="94" width="836" height="836" rx="150" fill="url(#innerGlow)" opacity="0.7"/>
      ` : ""}
      <path d="M398 300C430 267 471 249 512 249C553 249 594 267 626 300"
        fill="none" stroke="${strokeColor}" stroke-width="42" stroke-linecap="round"/>
      <path d="M446 354C464 336 488 326 512 326C536 326 560 336 578 354"
        fill="none" stroke="${strokeColor}" stroke-width="35" stroke-linecap="round"/>
      <circle cx="512" cy="397" r="24" fill="${dotColor}"/>
      <rect x="248" y="440" width="528" height="286" rx="76"
        fill="${variant === "black" ? "#FFFFFF" : "#050B17"}" fill-opacity="${variant === "black" ? "0.94" : "0.42"}"
        stroke="${strokeColor}" stroke-width="43"/>
      <path d="M463 508C463 489 484 477 501 487L610 552C627 562 627 587 610 597L501 662C484 672 463 660 463 641Z"
        fill="${fillColor}"/>
      <rect x="431" y="772" width="162" height="34" rx="17" fill="${fillColor}"/>
    </g>
  `;
}

function defs() {
  return `
    <defs>
      <linearGradient id="blueStroke" x1="250" x2="776" y1="250" y2="800" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${BLUE_BRIGHT}"/>
        <stop offset="0.5" stop-color="${BLUE}"/>
        <stop offset="1" stop-color="${BLUE_DEEP}"/>
      </linearGradient>
      <linearGradient id="blueFill" x1="450" x2="620" y1="500" y2="650" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${BLUE_BRIGHT}"/>
        <stop offset="1" stop-color="${BLUE_DEEP}"/>
      </linearGradient>
      <radialGradient id="iconPanel" cx="32%" cy="15%" r="96%">
        <stop offset="0" stop-color="#101A30"/>
        <stop offset="0.55" stop-color="#071021"/>
        <stop offset="1" stop-color="${BG}"/>
      </radialGradient>
      <radialGradient id="innerGlow" cx="50%" cy="42%" r="54%">
        <stop offset="0" stop-color="#13213C" stop-opacity="0.9"/>
        <stop offset="1" stop-color="#02050B" stop-opacity="0"/>
      </radialGradient>
      <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
        <feDropShadow dx="0" dy="0" stdDeviation="18" flood-color="${BLUE}" flood-opacity="0.55"/>
        <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#001D4D" flood-opacity="0.55"/>
      </filter>
      <filter id="wordGlow" x="-20%" y="-35%" width="140%" height="170%" color-interpolation-filters="sRGB">
        <feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="${BLUE}" flood-opacity="0.44"/>
        <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000000" flood-opacity="0.7"/>
      </filter>
      <linearGradient id="wordBlue" x1="0" x2="1">
        <stop offset="0" stop-color="#0B72FF"/>
        <stop offset="0.55" stop-color="${BLUE}"/>
        <stop offset="1" stop-color="${BLUE_BRIGHT}"/>
      </linearGradient>
      <radialGradient id="deepBackdrop" cx="50%" cy="25%" r="80%">
        <stop offset="0" stop-color="#08152C"/>
        <stop offset="0.55" stop-color="#030A17"/>
        <stop offset="1" stop-color="${BG}"/>
      </radialGradient>
      <linearGradient id="streakBlue" x1="0" x2="1">
        <stop offset="0" stop-color="#003B8E" stop-opacity="0"/>
        <stop offset="0.22" stop-color="#0E8BFF" stop-opacity="0.75"/>
        <stop offset="0.5" stop-color="#35A9FF" stop-opacity="0.28"/>
        <stop offset="0.8" stop-color="#006DFF" stop-opacity="0.7"/>
        <stop offset="1" stop-color="#003B8E" stop-opacity="0"/>
      </linearGradient>
    </defs>
  `;
}

function backdrop(width, height, intensity = 1) {
  const midY = Math.round(height * 0.52);
  const lowerY = Math.round(height * 0.65);
  return `
    <rect width="${width}" height="${height}" fill="url(#deepBackdrop)"/>
    <rect width="${width}" height="${height}" fill="#01040A" opacity="0.2"/>
    <path d="M-${width * 0.08} ${midY}C${width * 0.2} ${midY + 90},${width * 0.32} ${midY + 180},${width * 0.54} ${midY + 30}C${width * 0.72} ${midY - 90},${width * 0.86} ${midY - 120},${width * 1.08} ${midY - 180}"
      fill="none" stroke="url(#streakBlue)" stroke-width="${9 * intensity}" opacity="0.82"/>
    <path d="M-${width * 0.04} ${midY + 44}C${width * 0.22} ${midY + 116},${width * 0.36} ${lowerY + 110},${width * 0.57} ${lowerY - 8}C${width * 0.76} ${lowerY - 116},${width * 0.88} ${lowerY - 150},${width * 1.06} ${lowerY - 214}"
      fill="none" stroke="#077CFF" stroke-width="${3.5 * intensity}" opacity="0.58"/>
    <path d="M-${width * 0.03} ${midY - 40}C${width * 0.25} ${midY + 40},${width * 0.36} ${midY + 120},${width * 0.54} ${midY + 12}C${width * 0.73} ${midY - 94},${width * 0.87} ${midY - 130},${width * 1.05} ${midY - 208}"
      fill="none" stroke="#55B6FF" stroke-width="${2 * intensity}" opacity="0.38"/>
    <path d="M-${width * 0.02} ${midY + 8}C${width * 0.24} ${midY + 78},${width * 0.35} ${midY + 158},${width * 0.55} ${midY + 42}C${width * 0.72} ${midY - 62},${width * 0.86} ${midY - 105},${width * 1.06} ${midY - 158}"
      fill="none" stroke="#0B4DBA" stroke-width="${18 * intensity}" opacity="0.16"/>
  `;
}

function iconSvg() {
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    <rect width="1024" height="1024" rx="210" fill="${BG}"/>
    ${logoMark({ frame: true })}
  </svg>`;
}

function markSvg(variant) {
  const bg =
    variant === "white"
      ? `<rect width="1024" height="1024" rx="160" fill="${PANEL}"/><rect x="4" y="4" width="1016" height="1016" rx="156" fill="none" stroke="#46506C" stroke-width="8"/>`
      : variant === "black"
        ? `<rect width="1024" height="1024" rx="160" fill="#F7F7F4"/><rect x="4" y="4" width="1016" height="1016" rx="156" fill="none" stroke="#E5E1DA" stroke-width="8"/>`
        : "";
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${bg}
    ${logoMark({ variant })}
  </svg>`;
}

function splashSvg() {
  return `<svg width="3840" height="2160" viewBox="0 0 3840 2160" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${backdrop(3840, 2160, 1.45)}
    <g transform="translate(1528 250) scale(0.765)">
      ${logoMark({ variant: "blue" })}
    </g>
    <text x="1920" y="1390" text-anchor="middle"
      font-family="Inter, Avenir Next, Helvetica Neue, Arial, sans-serif"
      font-size="232" font-weight="850" letter-spacing="0" fill="url(#wordBlue)" filter="url(#wordGlow)">GoTube</text>
    <text x="1920" y="1518" text-anchor="middle"
      font-family="Inter, Avenir Next, Helvetica Neue, Arial, sans-serif"
      font-size="58" font-weight="450" fill="#F8FBFF">Private YouTube, no recommendations.</text>
  </svg>`;
}

function tvBannerSvg() {
  return `<svg width="1920" height="1080" viewBox="0 0 1920 1080" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${backdrop(1920, 1080, 1.2)}
    <g transform="translate(520 290) scale(0.34)">
      ${logoMark({ variant: "blue" })}
    </g>
    <rect x="915" y="360" width="2" height="360" fill="#5F6C86" opacity="0.72"/>
    <text x="990" y="540"
      font-family="Inter, Avenir Next, Helvetica Neue, Arial, sans-serif"
      font-size="138" font-weight="850" letter-spacing="0" fill="url(#wordBlue)" filter="url(#wordGlow)">GoTube</text>
    <text x="996" y="635"
      font-family="Inter, Avenir Next, Helvetica Neue, Arial, sans-serif"
      font-size="40" font-weight="450" fill="#F8FBFF">Private YouTube, no recommendations.</text>
  </svg>`;
}

function ogImageSvg() {
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${backdrop(1200, 630, 0.9)}
    <g transform="translate(168 155) scale(0.29)">
      ${logoMark({ variant: "blue" })}
    </g>
    <text x="480" y="292"
      font-family="Inter, Avenir Next, Helvetica Neue, Arial, sans-serif"
      font-size="104" font-weight="850" letter-spacing="0" fill="url(#wordBlue)" filter="url(#wordGlow)">GoTube</text>
    <text x="486" y="360"
      font-family="Inter, Avenir Next, Helvetica Neue, Arial, sans-serif"
      font-size="32" fill="#F8FBFF">Private YouTube, no recommendations.</text>
  </svg>`;
}

async function writeText(relativePath, contents) {
  const file = path.join(ROOT, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${contents.trim()}\n`);
}

async function renderPng(svg, relativePath, width, height = width) {
  const file = path.join(ROOT, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg))
    .resize(width, height, { fit: "cover" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(file);
}

async function copyFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

const icon = iconSvg();
const splash = splashSvg();
const tvBanner = tvBannerSvg();
const og = ogImageSvg();
const blueTransparent = markSvg("blue");
const whiteMark = markSvg("white");
const blackMark = markSvg("black");
const outlineMark = markSvg("outline");

await fs.mkdir(BRAND_DIR, { recursive: true });
await fs.mkdir(FIRETV_DRAWABLE_NODPI, { recursive: true });

await writeText("apps/web/public/favicon.svg", icon);
await writeText("apps/web/public/brand/gotube-icon.svg", icon);
await writeText("apps/web/public/brand/gotube-mark-blue-transparent.svg", blueTransparent);
await writeText("apps/web/public/brand/gotube-mark-white-on-dark.svg", whiteMark);
await writeText("apps/web/public/brand/gotube-mark-black-on-light.svg", blackMark);
await writeText("apps/web/public/brand/gotube-mark-single-color-outline.svg", outlineMark);
await writeText("apps/web/public/brand/gotube-splash.svg", splash);
await writeText("apps/web/public/brand/gotube-tv-banner.svg", tvBanner);
await writeText("apps/web/public/brand/gotube-og-image.svg", og);
await writeText(
  "apps/web/public/manifest.webmanifest",
  escapeJson({
    name: "GoTube",
    short_name: "GoTube",
    description: "Private YouTube, no recommendations.",
    start_url: "/",
    display: "standalone",
    background_color: BG,
    theme_color: BG,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/maskable-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  })
);

await renderPng(icon, "apps/web/public/apple-touch-icon.png", 180);
await renderPng(icon, "apps/web/public/icon-192.png", 192);
await renderPng(icon, "apps/web/public/icon-512.png", 512);
await renderPng(icon, "apps/web/public/maskable-icon-512.png", 512);
await renderPng(icon, "apps/web/public/brand/gotube-icon-1024.png", 1024);
await renderPng(splash, "apps/web/public/brand/gotube-splash-3840x2160.png", 3840, 2160);
await renderPng(tvBanner, "apps/web/public/brand/gotube-tv-banner-1920x1080.png", 1920, 1080);
await renderPng(og, "apps/web/public/og-image.png", 1200, 630);

await copyFile(path.join(WEB_PUBLIC, "brand/gotube-icon-1024.png"), path.join(FIRETV_DRAWABLE_NODPI, "gotube_launcher_icon.png"));
await copyFile(path.join(WEB_PUBLIC, "brand/gotube-tv-banner-1920x1080.png"), path.join(FIRETV_DRAWABLE_NODPI, "gotube_tv_banner.png"));
await copyFile(path.join(WEB_PUBLIC, "brand/gotube-splash-3840x2160.png"), path.join(FIRETV_DRAWABLE_NODPI, "gotube_splash.png"));

for (const [density, size] of FIRETV_MIPMAPS) {
  await renderPng(icon, `apps/firetv/src/main/res/${density}/ic_launcher.png`, size);
}

console.log("Generated GoTube brand assets.");
