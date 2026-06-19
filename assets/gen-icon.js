// 从 SVG 生成应用图标 PNG（256x256）
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, 'icon.svg');
const outPath = path.join(__dirname, 'icon.png');

const svg = fs.readFileSync(svgPath, 'utf-8');

sharp(Buffer.from(svg))
  .resize(256, 256)
  .png()
  .toFile(outPath)
  .then(() => console.log('✅ icon.png generated'))
  .catch(e => console.error('❌', e.message));
