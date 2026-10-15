import * as THREE from "three";
import { hash2, valueNoise } from "./noise";

export function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível");
  return ctx;
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  return [cv, ctx2d(cv)];
}

/** Camuflagem digital (pixelada) como a do jato do vídeo: blocos de 4 px decididos por ruído em 2 escalas. */
export function camoTexture(base: string, tones: readonly [string, string, string], seed: number): THREE.CanvasTexture {
  const size = 128;
  const cell = 4;
  const [cv, g] = canvas(size);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const n = valueNoise(x / 22, y / 22, seed) * 0.7 + valueNoise(x / 7, y / 7, seed + 9) * 0.3;
      const tone = n < 0.36 ? tones[0] : n < 0.5 ? null : n < 0.64 ? tones[1] : tones[2];
      if (!tone) continue;
      g.fillStyle = tone;
      g.fillRect(x, y, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Fumaça: gradiente radial + lóbulos aleatórios. RGB funciona como sombreado (centro mais claro). */
export function smokeTexture(): THREE.CanvasTexture {
  const size = 64;
  const [cv, g] = canvas(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const n = valueNoise(x / 9, y / 9, 3) * 0.6 + valueNoise(x / 4, y / 4, 8) * 0.4;
      const a = Math.max(0, 1 - d) ** 1.4 * (0.55 + n * 0.6);
      const shade = 0.75 + 0.25 * (1 - dy * 1.6) * (0.8 + n * 0.3);
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.min(255, shade * 255);
      img.data[o + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function glowTexture(): THREE.CanvasTexture {
  const size = 64;
  const [cv, g] = canvas(size);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function cloudTexture(): THREE.CanvasTexture {
  const size = 128;
  const [cv, g] = canvas(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const n = valueNoise(x / 14, y / 14, 31) * 0.55 + valueNoise(x / 6, y / 6, 37) * 0.3 + hash2(x, y, 4) * 0.15;
      const a = Math.max(0, 1 - d) ** 1.1 * Math.min(1, n * 1.5);
      const shade = 0.82 + 0.18 * (1 - (dy + 0.5));
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = shade * 255;
      img.data[o + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Silhueta do jato vista de cima, para a sombra projetada no chão (sensação de voo rasante). */
export function shadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const [cv, g] = canvas(size);
  g.filter = "blur(2px)";
  g.fillStyle = "rgba(255,255,255,0.9)";
  const s = size / 20; // 20 m de quadro
  const P = (x: number, z: number): [number, number] => [size / 2 + x * s, size / 2 + z * s];
  const poly = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
    g.closePath();
    g.fill();
  };
  poly([[0, -9.3], [1.3, -5], [1.3, 8.6], [-1.3, 8.6], [-1.3, -5]]);
  poly([[1, -1.8], [6.8, 2.8], [6.8, 3.7], [1, 4.6]]);
  poly([[-1, -1.8], [-6.8, 2.8], [-6.8, 3.7], [-1, 4.6]]);
  poly([[0.9, 5.6], [3.9, 7.6], [3.9, 8.4], [0.9, 8.6]]);
  poly([[-0.9, 5.6], [-3.9, 7.6], [-3.9, 8.4], [-0.9, 8.6]]);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
