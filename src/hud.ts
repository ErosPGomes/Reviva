import * as THREE from "three";
import { MAX_FLARES } from "./aircraft";
import { bankAngle, forwardOf, pitchAngle } from "./flight";
import { COLORS, type Game } from "./game";
import { clamp, formatDistance } from "./math";
import { ctx2d } from "./textures";
import { ARENA_RADIUS } from "./terrain";

const FONT = '"Chakra Petch", ui-monospace, "SFMono-Regular", Menlo, monospace';
const RADAR_RANGE = 4500;

interface Screen {
  x: number;
  y: number;
  front: boolean;
  onScreen: boolean;
}

const _cam = new THREE.Vector3();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/**
 * HUD num canvas 2D sobreposto (não DOM): dezenas de marcadores por quadro sem custo de layout/reflow.
 * Desenhado em pixels CSS com transform de DPR para ficar nítido em telas retina.
 */
export class Hud {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  touchLayout = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = ctx2d(canvas);
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  private project(p: THREE.Vector3, cam: THREE.Camera): Screen {
    _cam.copy(p).applyMatrix4(cam.matrixWorldInverse);
    const front = _cam.z < 0;
    const cx = _cam.x;
    const cy = _cam.y;
    _cam.applyMatrix4((cam as THREE.PerspectiveCamera).projectionMatrix);
    const x = ((_cam.x + 1) / 2) * this.w;
    const y = ((1 - _cam.y) / 2) * this.h;
    if (!front) {
      // Atrás da câmera a projeção inverte; usa a direção no espaço da câmera para a seta de borda.
      return { x: this.w / 2 + cx * 1e4, y: this.h / 2 - cy * 1e4, front, onScreen: false };
    }
    return { x, y, front, onScreen: x > 0 && x < this.w && y > 0 && y < this.h };
  }

  draw(g: Game): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (g.phase === "attract") return;
    const cam = g.camera;
    cam.updateMatrixWorld();
    const p = g.player;
    c.lineJoin = "round";
    c.textBaseline = "middle";

    this.vignette(g);
    if (!p.alive) {
      this.messages(g);
      return;
    }

    const compact = this.w < 700 || (this.touchLayout && this.h < 500);
    this.bases(g, cam);
    this.ground(g, cam);
    this.enemies(g, cam);
    this.reticle(g, cam);
    this.lock(g, cam);
    if (g.cameraMode === "cockpit") this.horizon(g);
    this.flightData(g, compact);
    this.status(g, compact);
    this.radar(g, compact);
    this.scoreboard(g);
    this.warnings(g);
    this.messages(g);
    this.feed(g, compact);
  }

  private text(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", weight = 600): void {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${FONT}`;
    c.textAlign = align;
    c.lineWidth = 3;
    c.strokeStyle = "rgba(6,14,16,0.55)";
    c.strokeText(s, x, y);
    c.fillStyle = color;
    c.fillText(s, x, y);
  }

  private vignette(g: Game): void {
    const lowHp = g.player.alive ? clamp((45 - g.player.health) / 45, 0, 1) * (0.55 + 0.25 * Math.sin(g.time * 6)) : 0;
    const a = Math.max(g.damageFlash, lowHp * 0.6);
    if (a <= 0.01) return;
    const c = this.ctx;
    const r = Math.hypot(this.w, this.h) / 2;
    const grad = c.createRadialGradient(this.w / 2, this.h / 2, r * 0.45, this.w / 2, this.h / 2, r);
    grad.addColorStop(0, "rgba(180,20,10,0)");
    grad.addColorStop(1, `rgba(180,20,10,${(a * 0.6).toFixed(3)})`);
    c.fillStyle = grad;
    c.fillRect(0, 0, this.w, this.h);
  }

  private edgeArrow(s: Screen, color: string): void {
    const c = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const ang = Math.atan2(s.y - cy, s.x - cx);
    const rx = this.w * 0.44;
    const ry = this.h * 0.4;
    const x = cx + Math.cos(ang) * rx;
    const y = cy + Math.sin(ang) * ry;
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.beginPath();
    c.moveTo(10, 0);
    c.lineTo(-6, -7);
    c.lineTo(-3, 0);
    c.lineTo(-6, 7);
    c.closePath();
    c.fillStyle = color;
    c.fill();
    c.restore();
  }

  private bases(g: Game, cam: THREE.Camera): void {
    const c = this.ctx;
    for (const b of g.bases) {
      _v.copy(b.center).setY(b.center.y + 30);
      const s = this.project(_v, cam);
      if (!s.onScreen) continue;
      const color = b.captured ? COLORS.blue : COLORS.amber;
      const r = 13;
      c.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const x = s.x + Math.cos(a) * r;
        const y = s.y + Math.sin(a) * r;
        if (k) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.closePath();
      c.fillStyle = b.captured ? "rgba(40,90,160,0.55)" : "rgba(150,70,10,0.55)";
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = color;
      c.stroke();
      this.text(b.id, s.x, s.y + 1, 14, COLORS.white, "center", 700);
      const d = g.player.flight.pos.distanceTo(b.center);
      this.text(formatDistance(d), s.x, s.y + 24, 11, color);
    }
  }

  private ground(g: Game, cam: THREE.Camera): void {
    const c = this.ctx;
    const pp = g.player.flight.pos;
    for (const t of g.ground) {
      if (!t.alive) continue;
      const d = pp.distanceTo(t.position);
      if (d > 3500) continue;
      const s = this.project(t.position, cam);
      if (!s.onScreen) continue;
      const size = t.type === "aa" ? 6 : 4.5;
      c.lineWidth = 1.6;
      c.strokeStyle = t.type === "aa" ? COLORS.red : COLORS.amber;
      c.strokeRect(s.x - size, s.y - size, size * 2, size * 2);
      if (t.type === "aa" && d < 2600) this.text("AA", s.x, s.y - size - 8, 10, COLORS.red);
    }
  }

  private enemies(g: Game, cam: THREE.Camera): void {
    const c = this.ctx;
    const p = g.player;
    for (const e of g.enemies) {
      const a = e.plane;
      if (!a.alive) continue;
      const s = this.project(a.flight.pos, cam);
      if (!s.onScreen) {
        this.edgeArrow(s, COLORS.red);
        continue;
      }
      const d = p.flight.pos.distanceTo(a.flight.pos);
      const r = 8;
      c.beginPath();
      c.moveTo(s.x, s.y - r);
      c.lineTo(s.x + r, s.y);
      c.lineTo(s.x, s.y + r);
      c.lineTo(s.x - r, s.y);
      c.closePath();
      c.lineWidth = 2;
      c.strokeStyle = COLORS.red;
      c.stroke();
      this.text(formatDistance(d), s.x, s.y + 18, 11, COLORS.red);
      if (d < 2500) this.text(a.name, s.x, s.y - 17, 10, "rgba(255,170,160,0.9)", "center", 500);

      // Indicador de tiro antecipado: onde mirar para a rajada encontrar o alvo (2 iterações de t).
      if (d < 1400 && s.front) {
        let t = d / 1100;
        for (let k = 0; k < 2; k++) {
          _v.copy(a.flight.pos).addScaledVector(a.flight.vel, t).addScaledVector(p.flight.vel, -t);
          t = _v.distanceTo(p.flight.pos) / 1100;
        }
        _v.y += 0.5 * 4.9 * t * t;
        const l = this.project(_v, cam);
        if (l.onScreen) {
          c.beginPath();
          c.arc(l.x, l.y, 6, 0, Math.PI * 2);
          c.lineWidth = 1.6;
          c.strokeStyle = COLORS.amber;
          c.stroke();
          c.beginPath();
          c.moveTo(s.x, s.y);
          c.lineTo(l.x, l.y);
          c.strokeStyle = "rgba(255,160,67,0.35)";
          c.stroke();
        }
      }
    }
  }

  private reticle(g: Game, cam: THREE.Camera): void {
    const c = this.ctx;
    const f = g.player.flight;
    forwardOf(f.quat, _fwd);
    _v.copy(f.pos).addScaledVector(_fwd, 700);
    const s = this.project(_v, cam);
    if (!s.front) return;
    const hit = g.hitMarker > 0;
    c.lineWidth = 1.8;
    c.strokeStyle = g.player.overheated ? COLORS.red : COLORS.teal;
    c.beginPath();
    c.arc(s.x, s.y, 16, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      c.moveTo(s.x + dx * 20, s.y + dy * 20);
      c.lineTo(s.x + dx * 27, s.y + dy * 27);
    }
    c.stroke();
    c.fillStyle = COLORS.teal;
    c.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);

    if (hit || g.killMarker > 0) {
      const k = g.killMarker > 0;
      c.strokeStyle = k ? COLORS.red : COLORS.white;
      c.lineWidth = k ? 3 : 2;
      c.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        c.moveTo(s.x + dx * 7, s.y + dy * 7);
        c.lineTo(s.x + dx * 14, s.y + dy * 14);
      }
      c.stroke();
    }

    // Marcador do vetor velocidade (para onde o avião realmente vai).
    _v.copy(f.pos).addScaledVector(f.vel, 3);
    const m = this.project(_v, cam);
    if (m.onScreen && f.vel.lengthSq() > 100) {
      c.strokeStyle = "rgba(95,227,207,0.7)";
      c.lineWidth = 1.4;
      c.beginPath();
      c.arc(m.x, m.y, 5, 0, Math.PI * 2);
      c.moveTo(m.x - 13, m.y);
      c.lineTo(m.x - 5, m.y);
      c.moveTo(m.x + 5, m.y);
      c.lineTo(m.x + 13, m.y);
      c.moveTo(m.x, m.y - 5);
      c.lineTo(m.x, m.y - 10);
      c.stroke();
    }
  }

  private lock(g: Game, cam: THREE.Camera): void {
    const l = g.lock;
    if (!l.target) return;
    const s = this.project(l.target.position, cam);
    if (!s.onScreen) return;
    const c = this.ctx;
    const prog = clamp(l.time / 1.3, 0, 1);
    const size = l.locked ? 22 : 54 - prog * 30;
    c.lineWidth = l.locked ? 2.6 : 1.8;
    c.strokeStyle = l.locked ? COLORS.red : COLORS.amber;
    const k = size * 0.4;
    c.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const x = s.x + sx * size;
      const y = s.y + sy * size;
      c.moveTo(x - sx * k, y);
      c.lineTo(x, y);
      c.lineTo(x, y - sy * k);
    }
    c.stroke();
    if (l.locked) this.text("TRAVADO", s.x, s.y + size + 13, 12, COLORS.red, "center", 700);
  }

  private horizon(g: Game): void {
    const c = this.ctx;
    const q = g.player.flight.quat;
    const bank = bankAngle(q);
    const pitch = pitchAngle(q);
    const cam = g.camera;
    const pxPerRad = this.h / ((cam.fov * Math.PI) / 180);
    c.save();
    c.translate(this.w / 2, this.h / 2);
    c.rotate(-bank);
    c.strokeStyle = "rgba(95,227,207,0.55)";
    c.lineWidth = 1.4;
    for (let deg = -60; deg <= 60; deg += 10) {
      const y = (pitch - (deg * Math.PI) / 180) * pxPerRad;
      if (Math.abs(y) > this.h * 0.4) continue;
      const half = deg === 0 ? 140 : 50;
      c.setLineDash(deg < 0 ? [6, 5] : []);
      c.beginPath();
      c.moveTo(-half, y);
      c.lineTo(-30, y);
      c.moveTo(30, y);
      c.lineTo(half, y);
      c.stroke();
      if (deg !== 0) {
        c.setLineDash([]);
        this.text(String(Math.abs(deg)), -half - 14, y, 10, "rgba(95,227,207,0.8)");
      }
    }
    c.restore();
    c.setLineDash([]);
  }

  private box(x: number, y: number, label: string, value: string, unit: string, align: "left" | "right"): void {
    const c = this.ctx;
    const w = 86;
    const bx = align === "left" ? x : x - w;
    c.fillStyle = "rgba(8,20,24,0.45)";
    c.fillRect(bx, y - 20, w, 40);
    c.strokeStyle = "rgba(95,227,207,0.6)";
    c.lineWidth = 1;
    c.strokeRect(bx + 0.5, y - 19.5, w - 1, 39);
    this.text(label, bx + 8, y - 10, 9, "rgba(95,227,207,0.85)", "left", 600);
    this.text(value, bx + w - 8, y + 6, 18, COLORS.white, "right", 700);
    this.text(unit, bx + 8, y + 8, 9, "rgba(238,246,245,0.6)", "left", 500);
  }

  private flightData(g: Game, compact: boolean): void {
    const f = g.player.flight;
    const y = this.h / 2;
    const gap = compact ? this.w * 0.2 : 170;
    const kmh = Math.round(f.speed * 3.6);
    const alt = Math.round(f.pos.y - g.terrain.heightAt(f.pos.x, f.pos.z));
    this.box(this.w / 2 - gap - 86, y, "VEL", String(kmh), "km/h", "left");
    this.box(this.w / 2 + gap + 86, y, "ALT", String(Math.max(0, alt)), "m", "right");
    const ab = f.throttle > 0.85;
    this.text(`POT ${Math.round(f.throttle * 100)}%${ab ? " · PC" : ""}`, this.w / 2 - gap - 86, y + 32, 10, ab ? COLORS.amber : "rgba(95,227,207,0.85)", "left");
  }

  private status(g: Game, compact: boolean): void {
    const c = this.ctx;
    const p = g.player;
    const w = compact ? 150 : 220;
    const x = this.w / 2 - w / 2;
    const y = 14 + (compact ? 0 : 4);

    c.fillStyle = "rgba(8,20,24,0.5)";
    c.fillRect(x, y, w, 8);
    const hp = clamp(p.health / 100, 0, 1);
    c.fillStyle = hp > 0.45 ? COLORS.teal : hp > 0.25 ? COLORS.amber : COLORS.red;
    c.fillRect(x, y, w * hp, 8);
    this.text(`${Math.ceil(p.health)}`, x - 6, y + 4, 11, COLORS.white, "right", 700);

    c.fillStyle = "rgba(8,20,24,0.5)";
    c.fillRect(x, y + 12, w, 4);
    c.fillStyle = p.overheated ? COLORS.red : p.gunHeat > 0.7 ? COLORS.amber : "rgba(238,246,245,0.75)";
    c.fillRect(x, y + 12, w * clamp(p.gunHeat, 0, 1), 4);

    // Mísseis (2 trilhos) e flares
    const iy = y + 30;
    for (let k = 0; k < 2; k++) {
      const ready = p.rails[k]! <= 0;
      const ix = x + k * 26;
      c.fillStyle = ready ? COLORS.white : "rgba(238,246,245,0.25)";
      c.fillRect(ix, iy - 2, 18, 4);
      c.beginPath();
      c.moveTo(ix + 18, iy - 2);
      c.lineTo(ix + 23, iy);
      c.lineTo(ix + 18, iy + 2);
      c.fill();
      if (!ready) {
        c.fillStyle = COLORS.teal;
        c.fillRect(ix, iy + 5, 18 * (1 - p.rails[k]! / 5.5), 2);
      }
    }
    this.text("MSL", x + 58, iy, 10, "rgba(95,227,207,0.85)", "left");
    for (let k = 0; k < MAX_FLARES; k++) {
      c.beginPath();
      c.arc(x + w - 8 - k * 14, iy, 4.5, 0, Math.PI * 2);
      c.fillStyle = k < p.flares ? COLORS.amber : "rgba(255,160,67,0.2)";
      c.fill();
    }
    this.text("FLR", x + w - 8 - MAX_FLARES * 14 - 4, iy, 10, "rgba(255,160,67,0.85)", "right");
  }

  private radar(g: Game, compact: boolean): void {
    const c = this.ctx;
    const r = compact ? 46 : 62;
    const cx = this.w - r - 14;
    const cy = r + (this.touchLayout ? 64 : 14);
    const p = g.player.flight;
    forwardOf(p.quat, _fwd);
    const heading = Math.atan2(_fwd.x, -_fwd.z);
    c.save();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fillStyle = "rgba(8,20,24,0.5)";
    c.fill();
    c.strokeStyle = "rgba(95,227,207,0.55)";
    c.lineWidth = 1;
    c.stroke();
    c.beginPath();
    c.arc(cx, cy, r / 2, 0, Math.PI * 2);
    c.strokeStyle = "rgba(95,227,207,0.18)";
    c.stroke();
    c.clip();

    // Radar orientado pela proa: frente do avião sempre para cima.
    const toRadar = (x: number, z: number): [number, number] => {
      const dx = x - p.pos.x;
      const dz = z - p.pos.z;
      const cs = Math.cos(-heading);
      const sn = Math.sin(-heading);
      const rx = dx * cs - dz * sn;
      const rz = dx * sn + dz * cs;
      return [cx + (rx / RADAR_RANGE) * r, cy + (rz / RADAR_RANGE) * r];
    };
    // Contatos fora do alcance ficam presos na borda: o jogador sempre sabe a direção do inimigo.
    const clampRim = ([x, y]: [number, number]): [number, number] => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const max = r - 4;
      return d > max ? [cx + (dx / d) * max, cy + (dy / d) * max] : [x, y];
    };
    // Limite da arena
    c.beginPath();
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const [x, y] = toRadar(Math.cos(a) * ARENA_RADIUS, Math.sin(a) * ARENA_RADIUS);
      if (k) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.strokeStyle = "rgba(255,81,70,0.5)";
    c.stroke();

    for (const b of g.bases) {
      const [x, y] = clampRim(toRadar(b.center.x, b.center.z));
      this.text(b.id, x, y, 10, b.captured ? COLORS.blue : COLORS.amber, "center", 700);
    }
    for (const e of g.enemies) {
      if (!e.plane.alive) continue;
      const [x, y] = clampRim(toRadar(e.plane.flight.pos.x, e.plane.flight.pos.z));
      c.fillStyle = COLORS.red;
      c.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    if (Math.floor(g.time * 6) % 2 === 0) {
      for (const m of g.missiles.active) {
        if (m.target !== g.player) continue;
        const [x, y] = toRadar(m.pos.x, m.pos.z);
        c.fillStyle = COLORS.white;
        c.beginPath();
        c.arc(x, y, 2.5, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
    c.fillStyle = COLORS.teal;
    c.beginPath();
    c.moveTo(cx, cy - 5);
    c.lineTo(cx + 4, cy + 4);
    c.lineTo(cx - 4, cy + 4);
    c.closePath();
    c.fill();
  }

  private scoreboard(g: Game): void {
    const x = 16;
    const y = 22;
    this.text(g.score.toLocaleString("pt-BR"), x, y, 22, COLORS.white, "left", 700);
    const alive = g.enemies.filter((e) => e.plane.alive).length;
    this.text(`ONDA ${Math.max(1, g.wave)} · ${alive} hostil${alive === 1 ? "" : "s"}`, x, y + 20, 11, "rgba(95,227,207,0.9)", "left");
    const bases = g.bases.map((b) => `${b.id}${b.captured ? "✓" : ""}`).join("  ");
    this.text(`BASES  ${bases}`, x, y + 36, 11, COLORS.amber, "left");
  }

  private warnings(g: Game): void {
    const blink = Math.floor(g.time * 5) % 2 === 0;
    const y = this.h * 0.3;
    if (g.threat.missiles > 0) {
      if (blink) this.text(`MÍSSIL ${formatDistance(g.threat.nearest)}  ·  SOLTE FLARES`, this.w / 2, y, 16, COLORS.red, "center", 700);
      if (g.threat.from) {
        const s = this.project(g.threat.from, g.camera);
        if (!s.onScreen) this.edgeArrow(s, COLORS.white);
      }
    } else if (g.threat.locking) {
      this.text("INIMIGO TRAVANDO EM VOCÊ", this.w / 2, y, 14, COLORS.amber, "center", 700);
    }
    if (g.pullUp && blink) this.text("PUXE PARA CIMA", this.w / 2, y + 24, 16, COLORS.red, "center", 700);
    if (g.outTimer > 0) {
      this.text(`VOLTE À ÁREA DE COMBATE  ${Math.ceil(10 - g.outTimer)}`, this.w / 2, y + 48, 15, COLORS.red, "center", 700);
    }
  }

  private messages(g: Game): void {
    let y = this.h * 0.2;
    for (let i = g.messages.length - 1; i >= 0; i--) {
      const m = g.messages[i]!;
      const age = g.time - m.t;
      if (age > 3.2) continue;
      const a = clamp(3.2 - age, 0, 1);
      this.ctx.globalAlpha = a;
      this.text(m.text, this.w / 2, y, m.big ? 18 : 14, m.color, "center", 700);
      this.ctx.globalAlpha = 1;
      y += m.big ? 24 : 19;
    }
  }

  private feed(g: Game, compact: boolean): void {
    // Toque: coluna à esquerda abaixo do placar (canto inferior é do manche). Desktop: canto inferior direito.
    const touch = this.touchLayout;
    if (touch && compact && this.h < 420) return;
    const x = touch ? 16 : this.w - 16;
    let y = touch ? 92 : this.h - 22;
    for (let i = g.feed.length - 1; i >= 0; i--) {
      const f = g.feed[i]!;
      const age = g.time - f.t;
      if (age > 7) continue;
      this.ctx.globalAlpha = clamp(7 - age, 0, 1);
      this.text(f.text, x, y, 11, f.mine ? COLORS.teal : "rgba(238,246,245,0.8)", touch ? "left" : "right", 500);
      this.ctx.globalAlpha = 1;
      y += touch ? 16 : -16;
    }
  }
}
