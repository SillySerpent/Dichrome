import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconDir = join(root, "icons");
const sizes = [16, 32, 48, 128];

await mkdir(iconDir, {
  recursive: true
});

for (const size of sizes) {
  await writeFile(join(iconDir, `icon-${size}.png`), renderPng(size));
}

console.log(`Generated ${sizes.length} icon files.`);

function renderPng(size) {
  const scale = size / 128;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const ux = (x + 0.5) / scale;
      const uy = (y + 0.5) / scale;
      const color = sampleIcon(ux, uy);
      const offset = (y * size + x) * 4;
      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = color.a;
    }
  }

  return encodePng(size, size, pixels);
}

function sampleIcon(x, y) {
  const bgAlpha = roundedRectAlpha(x, y, 8, 8, 112, 112, 26);

  if (bgAlpha <= 0) {
    return rgba(0, 0, 0, 0);
  }

  let color = gradientColor(x, y);

  if (chatBubbleContains(x, y)) {
    color = blend(rgba(255, 255, 255, 255), color);
  }

  if (arrowContains(x, y)) {
    color = blend(gradientArrowColor(x), color);
  }

  const sparkleAlpha = circleAlpha(x, y, 95, 35, 13);

  if (sparkleAlpha > 0) {
    color = blend(rgba(248, 211, 106, Math.round(255 * sparkleAlpha)), color);
  }

  if (starContains(x, y)) {
    color = blend(rgba(20, 63, 53, 255), color);
  }

  color.a = Math.round(color.a * bgAlpha);
  return color;
}

function chatBubbleContains(x, y) {
  if (roundedRectAlpha(x, y, 19, 34, 90, 61, 15) > 0) {
    return true;
  }

  return pointInPolygon(x, y, [
    [41, 91],
    [41, 108.5],
    [62.5, 95],
    [50, 89]
  ]);
}

function arrowContains(x, y) {
  if (roundedRectAlpha(x, y, 39, 59, 43, 13, 6.5) > 0) {
    return true;
  }

  return pointInPolygon(x, y, [
    [68, 42],
    [96, 65.5],
    [68, 89],
    [66, 76],
    [80, 70.5],
    [80, 60.5],
    [66, 55]
  ]);
}

function starContains(x, y) {
  return pointInPolygon(x, y, [
    [95, 27],
    [97.3, 32.2],
    [103, 32.8],
    [98.8, 36.6],
    [100, 42.2],
    [95, 39.3],
    [90, 42.2],
    [91.2, 36.6],
    [87, 32.8],
    [92.7, 32.2]
  ]);
}

function gradientColor(x, y) {
  const t = clamp(((x - 18) + (y - 12)) / 198, 0, 1);

  if (t < 0.58) {
    return lerpColor(rgba(20, 63, 53, 255), rgba(31, 122, 92, 255), t / 0.58);
  }

  return lerpColor(rgba(31, 122, 92, 255), rgba(224, 183, 79, 255), (t - 0.58) / 0.42);
}

function gradientArrowColor(x) {
  return lerpColor(rgba(31, 122, 92, 255), rgba(224, 183, 79, 255), clamp((x - 38) / 54, 0, 1));
}

function roundedRectAlpha(x, y, rx, ry, width, height, radius) {
  const cx = clamp(x, rx + radius, rx + width - radius);
  const cy = clamp(y, ry + radius, ry + height - radius);
  const distance = Math.hypot(x - cx, y - cy);

  if (distance <= radius - 0.75) {
    return 1;
  }

  if (distance >= radius + 0.75) {
    return 0;
  }

  return clamp((radius + 0.75 - distance) / 1.5, 0, 1);
}

function circleAlpha(x, y, cx, cy, radius) {
  const distance = Math.hypot(x - cx, y - cy);

  if (distance <= radius - 0.75) {
    return 1;
  }

  if (distance >= radius + 0.75) {
    return 0;
  }

  return clamp((radius + 0.75 - distance) / 1.5, 0, 1);
}

function pointInPolygon(x, y, points) {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, 6, 0, 0, 0])
    ])),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuffer, data]);

  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(crcInput))
  ]);
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);

  return buffer;
}

function blend(source, destination) {
  const alpha = source.a / 255;
  const inverse = 1 - alpha;

  return rgba(
    Math.round(source.r * alpha + destination.r * inverse),
    Math.round(source.g * alpha + destination.g * inverse),
    Math.round(source.b * alpha + destination.b * inverse),
    Math.round(source.a + destination.a * inverse)
  );
}

function lerpColor(a, b, t) {
  return rgba(
    Math.round(a.r + (b.r - a.r) * t),
    Math.round(a.g + (b.g - a.g) * t),
    Math.round(a.b + (b.b - a.b) * t),
    Math.round(a.a + (b.a - a.a) * t)
  );
}

function rgba(r, g, b, a) {
  return {
    r,
    g,
    b,
    a
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
