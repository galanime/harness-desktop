// 生成全部品牌图标：icns、PNG、托盘模板、DMG 背景。
// 用法：npm run build:icons
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brand = path.join(root, 'brand');
const build = path.join(root, 'build');

fs.mkdirSync(build, { recursive: true });

async function renderSvg(svgPath, size, outPath) {
  await sharp(svgPath, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(outPath);
}

async function main() {
  const logoSvg = path.join(brand, 'logo.svg');

  // 1) macOS 图标集 → icns
  const iconset = path.join(build, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  const map = {
    'icon_16x16.png': 16,
    'icon_16x16@2x.png': 32,
    'icon_32x32.png': 32,
    'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128,
    'icon_128x128@2x.png': 256,
    'icon_256x256.png': 256,
    'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512,
    'icon_512x512@2x.png': 1024,
  };
  for (const [name, size] of Object.entries(map)) {
    await renderSvg(logoSvg, size, path.join(iconset, name));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(build, 'icon.icns')], {
    stdio: 'inherit',
  });
  console.log('✔ build/icon.icns');

  // 2) 通用 PNG（关于页/文档/linux 用）
  await renderSvg(logoSvg, 512, path.join(brand, 'icon.png'));
  await renderSvg(logoSvg, 256, path.join(build, 'icon.png'));
  console.log('✔ brand/icon.png, build/icon.png');

  // 3) 托盘模板图标
  await renderSvg(path.join(brand, 'trayTemplate.svg'), 16, path.join(brand, 'trayTemplate.png'));
  await renderSvg(path.join(brand, 'trayTemplate.svg'), 32, path.join(brand, 'trayTemplate@2x.png'));
  console.log('✔ brand/trayTemplate.png (+@2x)');

  // 4) DMG 背景
  await sharp(path.join(brand, 'dmg-background.svg'), { density: 144 })
    .resize(1080, 800)
    .png()
    .toFile(path.join(build, 'dmg-background.png'));
  console.log('✔ build/dmg-background.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
