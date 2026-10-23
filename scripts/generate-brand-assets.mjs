import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB_PUBLIC = path.join(ROOT, "apps/web/public");
const BRAND_DIR = path.join(WEB_PUBLIC, "brand");
const WEB_ONLY = process.argv.includes("--web-only");
// Outline lettering keeps exports consistent without an installed font.
const WORDMARK = JSON.parse(await fs.readFile(new URL("./brand/gotube-wordmark.json", import.meta.url), "utf8"));
const FIRETV_DRAWABLE_NODPI = path.join(ROOT, "apps/firetv/src/main/res/drawable-nodpi");
const FIRETV_MIPMAPS = [
  ["mipmap-mdpi", 96],
  ["mipmap-hdpi", 144],
  ["mipmap-xhdpi", 192],
  ["mipmap-xxhdpi", 288],
  ["mipmap-xxxhdpi", 384]
];
const FIRETV_BANNERS = [
  ["drawable-mdpi", 160, 90],
  ["drawable-hdpi", 240, 135],
  ["drawable-xhdpi", 320, 180],
  ["drawable-xxhdpi", 480, 270],
  ["drawable-xxxhdpi", 640, 360]
];
const FIRETV_LAUNCHER_ICON = "ic_launcher_firetv";
const FIRETV_LEANBACK_BANNER = "gotube_leanback_banner";

const BLUE = "#168BFF";
const BLUE_BRIGHT = "#34A3FF";
const BLUE_DEEP = "#006DFF";
const BG = "#02050B";
const PANEL = "#071021";

function escapeJson(value) {
  return JSON.stringify(value, null, 2);
}

function logoMark({ size = 1024, variant = "blue" } = {}) {
  const color = variant === "white" ? "#FFFFFF" : variant === "black" ? "#05070B" : "url(#blueFill)";
  // The play symbol is a true cutout, including in transparent/monochrome exports.
  const shape = "M332 284H692C836 284 872 320 872 464V560C872 704 836 740 692 740H332C188 740 152 704 152 560V464C152 320 188 284 332 284Z M404 411C404 393 424 381 441 391L624 497C637 505 637 519 624 527L441 633C424 643 404 631 404 612Z";
  return `<g transform="scale(${size / 1024})"><path d="${shape}" fill-rule="evenodd" ${variant === "outline" ? `fill="none" stroke="${BLUE}" stroke-width="20" stroke-linejoin="round"` : `fill="${color}"`}/></g>`;
}

function defs() {
  return `<defs>
    <linearGradient id="blueFill" x1="152" y1="284" x2="872" y2="740" gradientUnits="userSpaceOnUse">
      <stop stop-color="${BLUE_BRIGHT}"/>
      <stop offset="0.5" stop-color="${BLUE}"/>
      <stop offset="1" stop-color="${BLUE_DEEP}"/>
    </linearGradient>
  </defs>`;
}

function backdrop(width, height) {
  return `<rect width="${width}" height="${height}" fill="${BG}"/>`;
}

function wordmark({ x = 0, y = 0, width = WORDMARK.width, color = "#F8FBFF" } = {}) {
  return `<path d="${WORDMARK.path}" transform="translate(${x} ${y}) scale(${width / WORDMARK.width})" fill="${color}"/>`;
}

function stackedLockup() {
  return `<g transform="translate(88 -166)">${logoMark()}</g>${wordmark({ x: 180, y: 642, width: 840 })}`;
}

function lockupSvg(stacked = false) {
  const width = stacked ? 1200 : 1600;
  const height = stacked ? 1000 : 400;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${stacked ? stackedLockup() : `<g transform="translate(-25 -87) scale(0.56)">${logoMark()}</g>${wordmark({ x: 550, y: 101, width: 950 })}`}
  </svg>`;
}

function wordmarkSvg() {
  return `<svg width="${WORDMARK.width}" height="${WORDMARK.height}" viewBox="0 0 ${WORDMARK.width} ${WORDMARK.height}" xmlns="http://www.w3.org/2000/svg">${wordmark()}</svg>`;
}

function iconSvg(maskable = false) {
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    <rect width="1024" height="1024" rx="${maskable ? 0 : 210}" fill="${BG}"/>
    ${logoMark()}
  </svg>`;
}

function fireTvLauncherSvg() {
  return iconSvg();
}

function fireTvLauncherBannerSvg() {
  return `<svg width="1920" height="1080" viewBox="0 0 1920 1080" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${backdrop(1920, 1080)}
    <g transform="translate(614 194) scale(0.676)">
      <rect width="1024" height="1024" rx="210" fill="${BG}"/>
      ${logoMark()}
    </g>
  </svg>`;
}

function markSvg(variant) {
  const bg = variant === "white" ? PANEL : variant === "black" ? "#F7F7F4" : null;
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${bg ? `<rect width="1024" height="1024" rx="160" fill="${bg}"/>` : ""}
    ${logoMark({ variant })}
  </svg>`;
}

function splashSvg() {
  return `<svg width="3840" height="2160" viewBox="0 0 3840 2160" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${backdrop(3840, 2160)}
    <g transform="translate(900 80) scale(1.7)">${stackedLockup()}</g>
    <text x="1920" y="1750" text-anchor="middle" font-family="Inter, Avenir Next, Arial, sans-serif" font-size="58" fill="#F8FBFF">Private YouTube, no recommendations.</text>
  </svg>`;
}

function tvBannerSvg() {
  return `<svg width="1920" height="1080" viewBox="0 0 1920 1080" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${backdrop(1920, 1080)}
    <g transform="translate(360 40)">${stackedLockup()}</g>
  </svg>`;
}

function ogImageSvg() {
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${backdrop(1200, 630)}
    <g transform="translate(240 0) scale(0.6)">${stackedLockup()}</g>
    <text x="600" y="560" text-anchor="middle" font-family="Inter, Avenir Next, Arial, sans-serif" font-size="28" fill="#F8FBFF">Private YouTube, no recommendations.</text>
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
const fireTvLauncher = fireTvLauncherSvg();
const fireTvLauncherBanner = fireTvLauncherBannerSvg();
const splash = splashSvg();
const tvBanner = tvBannerSvg();
const og = ogImageSvg();
const blueTransparent = markSvg("blue");
const whiteMark = markSvg("white");
const blackMark = markSvg("black");
const outlineMark = markSvg("outline");

await fs.mkdir(BRAND_DIR, { recursive: true });

await writeText("apps/web/public/favicon.svg", icon);
await writeText("apps/web/public/brand/gotube-icon.svg", icon);
await writeText("apps/web/public/brand/gotube-wordmark.svg", wordmarkSvg());
await writeText("apps/web/public/brand/gotube-lockup-horizontal.svg", lockupSvg());
await writeText("apps/web/public/brand/gotube-lockup-stacked.svg", lockupSvg(true));
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
await renderPng(iconSvg(true), "apps/web/public/maskable-icon-512.png", 512);
await renderPng(icon, "apps/web/public/brand/gotube-icon-1024.png", 1024);
await renderPng(blueTransparent, "apps/web/public/brand/gotube-mark-blue-transparent.png", 1024);
await renderPng(wordmarkSvg(), "apps/web/public/brand/gotube-wordmark.png", Math.round(WORDMARK.width * 2), WORDMARK.height * 2);
await renderPng(lockupSvg(), "apps/web/public/brand/gotube-lockup-horizontal.png", 1600, 400);
await renderPng(lockupSvg(true), "apps/web/public/brand/gotube-lockup-stacked.png", 1200, 1000);
await renderPng(splash, "apps/web/public/brand/gotube-splash-3840x2160.png", 3840, 2160);
await renderPng(tvBanner, "apps/web/public/brand/gotube-tv-banner-1920x1080.png", 1920, 1080);
await renderPng(og, "apps/web/public/og-image.png", 1200, 630);

// Web branding can be updated while a Fire TV release is intentionally deferred.
if (!WEB_ONLY) {
  await fs.mkdir(FIRETV_DRAWABLE_NODPI, { recursive: true });
  await copyFile(path.join(WEB_PUBLIC, "brand/gotube-tv-banner-1920x1080.png"), path.join(FIRETV_DRAWABLE_NODPI, "gotube_tv_banner.png"));
  await copyFile(path.join(WEB_PUBLIC, "brand/gotube-splash-3840x2160.png"), path.join(FIRETV_DRAWABLE_NODPI, "gotube_splash.png"));

  await fs.rm(path.join(FIRETV_DRAWABLE_NODPI, "gotube_launcher_icon.png"), { force: true });
  await fs.rm(path.join(FIRETV_DRAWABLE_NODPI, "gotube_launcher_banner.png"), { force: true });

  for (const [density, size] of FIRETV_MIPMAPS) {
    await fs.rm(path.join(ROOT, `apps/firetv/src/main/res/${density}/ic_launcher.png`), { force: true });
    await renderPng(fireTvLauncher, `apps/firetv/src/main/res/${density}/${FIRETV_LAUNCHER_ICON}.png`, size);
  }

  for (const [density, width, height] of FIRETV_BANNERS) {
    await renderPng(fireTvLauncherBanner, `apps/firetv/src/main/res/${density}/${FIRETV_LEANBACK_BANNER}.png`, width, height);
  }
}

console.log(`Generated GoTube ${WEB_ONLY ? "web " : ""}brand assets.`);
