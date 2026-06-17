import sharp from 'sharp';
import toIco from 'to-ico';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const svgBuf = readFileSync(join(root, 'public', 'favicon.svg'));

// ICO standard sizes
const sizes = [16, 32, 48, 64, 128, 256];

console.log('Rendering SVG at sizes:', sizes.join(', '));

const pngs = await Promise.all(
  sizes.map(size =>
    sharp(svgBuf, { density: Math.round((size / 48) * 72) })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
  )
);

mkdirSync(join(root, 'build'), { recursive: true });

const ico = await toIco(pngs);
writeFileSync(join(root, 'build', 'icon.ico'), ico);

console.log(`✓ build/icon.ico created (${(ico.length / 1024).toFixed(1)} KB)`);
