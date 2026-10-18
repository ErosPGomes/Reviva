import * as THREE from "three";
import type { FighterId } from "./fighters";
import { GUNS, MISSILES, type GunId, type MissileId } from "./loadout";
import { MISSILE_DEFS, createGunModel, createJetMesh, createMissileMesh, gearHeight, type GunModel, type JetMesh } from "./models";
import { glowTexture, ctx2d } from "./textures";

/**
 * Hangar do menu: prévia 3D do caça, do míssil e da metralhadora escolhidos. Um único renderer WebGL
 * desenha as três cenas em recortes (scissor) do mesmo canvas, cada uma no retângulo do seu elemento
 * `.stage__view` — o layout fica todo no CSS e funciona igual em desktop e celular.
 */
export type HangarFocus = "jet" | "missile" | "gun";

interface Stage {
  readonly el: HTMLElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Largura (m) que precisa caber no quadro. */
  span: number; // largura (m) que precisa caber no quadro
  spanH: number; // altura (m) que precisa caber no quadro
  pop: number; // 0..1 animação de entrada após trocar a seleção
  update(dt: number, t: number): void;
}

const easeOutBack = (x: number): number => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;

function lights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x26302c, 1.5));
  const key = new THREE.DirectionalLight(0xfff3e0, 2.4);
  key.position.set(4, 6, 5);
  const rim = new THREE.DirectionalLight(0x5fe3cf, 1.6);
  rim.position.set(-5, 2, -6);
  scene.add(key, rim);
}

/** Plataforma giratória: anéis e marcas em canvas, só para dar chão e escala à prévia do caça. */
function turntableTexture(): THREE.CanvasTexture {
  const size = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = ctx2d(cv);
  const c = size / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, "rgba(95,227,207,0.16)");
  grad.addColorStop(0.85, "rgba(95,227,207,0.05)");
  grad.addColorStop(1, "rgba(95,227,207,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "rgba(95,227,207,0.55)";
  for (const [r, w] of [[0.97, 3], [0.7, 1.5], [0.42, 1]] as const) {
    g.lineWidth = w;
    g.beginPath();
    g.arc(c, c, r * c, 0, Math.PI * 2);
    g.stroke();
  }
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const l = k % 6 === 0 ? 0.88 : 0.93;
    g.lineWidth = k % 6 === 0 ? 2 : 1;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * c * l, c + Math.sin(a) * c * l);
    g.lineTo(c + Math.cos(a) * c * 0.97, c + Math.sin(a) * c * 0.97);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStage(el: HTMLElement, span: number, spanH: number, fov = 30): Omit<Stage, "update"> {
  const scene = new THREE.Scene();
  lights(scene);
  return { el, scene, camera: new THREE.PerspectiveCamera(fov, 1, 0.1, 400), span, spanH, pop: 1 };
}

/** Enquadra `span` × `spanH` metros (o que for mais restritivo para o formato do recorte) olhando para `target`. */
function frame(cam: THREE.PerspectiveCamera, span: number, spanH: number, aspect: number, elev: number, target: THREE.Vector3): void {
  cam.aspect = aspect;
  const vfov = THREE.MathUtils.degToRad(cam.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const d = Math.max(span / 2 / Math.tan(hfov / 2), spanH / 2 / Math.tan(vfov / 2));
  cam.position.set(target.x, target.y + Math.sin(elev) * d, target.z + Math.cos(elev) * d);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
}

export class Hangar {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly stages: Record<HangarFocus, Stage>;
  private time = 0;
  private focusKind: HangarFocus = "jet";

  /* Caça */
  private jet: JetMesh | null = null;
  private fighter: FighterId | null = null;
  private readonly jetPivot = new THREE.Group();
  private readonly table: THREE.Mesh;
  /* Míssil */
  private missileId: MissileId = "ir";
  private readonly missilePivot = new THREE.Group();
  /* Metralhadora */
  private gunId: GunId = "cal50";
  private gun: GunModel | null = null;
  private readonly gunPivot = new THREE.Group();
  private readonly flash: THREE.Sprite;
  private readonly tracers: { mesh: THREE.Mesh; age: number; live: boolean }[] = [];
  private tracerTimer = 0;

  constructor(private readonly canvas: HTMLCanvasElement, views: Record<HangarFocus, HTMLElement>) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setScissorTest(true);

    const jet = makeStage(views.jet, 27, 12, 28);
    this.table = new THREE.Mesh(
      new THREE.CircleGeometry(12.5, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: turntableTexture(), transparent: true, depthWrite: false }),
    );
    jet.scene.add(this.table, this.jetPivot);

    const missile = makeStage(views.missile, 4.2, 1.1, 26);
    missile.scene.add(this.missilePivot);

    const gun = makeStage(views.gun, 2.3, 0.75, 26);
    gun.scene.add(this.gunPivot);
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd38a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flash = new THREE.Sprite(glowMat);
    this.flash.visible = false;
    this.gunPivot.add(this.flash);
    const tracerGeo = new THREE.BoxGeometry(0.42, 0.012, 0.012);
    for (let k = 0; k < 14; k++) {
      const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffd38a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.visible = false;
      gun.scene.add(mesh);
      this.tracers.push({ mesh, age: 0, live: false });
    }

    this.stages = {
      jet: { ...jet, update: (dt, t) => this.updateJet(dt, t) },
      missile: { ...missile, update: (dt, t) => this.updateMissile(dt, t) },
      gun: { ...gun, update: (dt, t) => this.updateGun(dt, t) },
    };
  }

  setFighter(id: FighterId): void {
    if (id === this.fighter) return;
    this.fighter = id;
    if (this.jet) this.jetPivot.remove(this.jet.group);
    this.jet = createJetMesh("blue", id);
    this.jet.setGear(1);
    this.jet.setLoadout(MISSILES[this.missileId].pylon);
    this.jet.group.position.y = gearHeight(id);
    this.jetPivot.add(this.jet.group);
    this.pop("jet");
  }

  setMissile(id: MissileId): void {
    this.missileId = id;
    this.jet?.setLoadout(MISSILES[id].pylon);
    this.missilePivot.clear();
    const look = MISSILES[id].pylon;
    const model = createMissileMesh(look);
    // Ponta para +X (direita da tela); o pivô gira o míssil em torno do próprio eixo.
    model.rotation.y = -Math.PI / 2;
    this.missilePivot.add(model);
    const def = MISSILE_DEFS[look];
    this.stages.missile.span = def.len + 0.9;
    this.stages.missile.spanH = Math.max(1.1, 2 * (def.r + Math.max(0, ...def.fins.map((f) => f[1]))) + 0.45);
    this.pop("missile");
  }

  setGun(id: GunId): void {
    this.gunId = id;
    if (this.gun) this.gunPivot.remove(this.gun.group);
    this.gun = createGunModel(id);
    this.gun.group.rotation.y = -Math.PI / 2;
    // Centraliza pela caixa do modelo (boca à direita) e enquadra pelo tamanho real de cada arma.
    this.gun.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.gun.group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.gun.group.position.set(-center.x, -center.y, -center.z);
    this.stages.gun.span = size.x + 0.45;
    this.stages.gun.spanH = size.y + 0.3;
    this.gunPivot.add(this.gun.group);
    const color = GUNS[id].color;
    for (const tr of this.tracers) (tr.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.flash.material as THREE.SpriteMaterial).color.setHex(color);
    this.pop("gun");
  }

  /** Destaca a categoria que acabou de mudar (CSS) e reinicia a animação de entrada da cena. */
  private pop(kind: HangarFocus): void {
    this.stages[kind].pop = 0;
    this.focusKind = kind;
    for (const k of Object.keys(this.stages) as HangarFocus[]) {
      this.stages[k].el.closest(".stage")?.classList.toggle("is-focus", k === kind);
    }
  }

  get focus(): HangarFocus {
    return this.focusKind;
  }

  private updateJet(dt: number, t: number): void {
    const s = this.stages.jet;
    const k = easeOutBack(Math.min(1, s.pop));
    this.jetPivot.scale.setScalar(0.55 + 0.45 * k);
    // Giro lento constante + meia volta rápida ao trocar de caça.
    this.jetPivot.rotation.y += dt * (0.32 + (1 - Math.min(1, s.pop)) * 5);
    this.jet?.setThrottle(0.12 + 0.04 * Math.sin(t * 3), t);
  }

  private updateMissile(dt: number, t: number): void {
    const s = this.stages.missile;
    const k = easeOutBack(Math.min(1, s.pop));
    // Entra deslizando da esquerda, como saindo do trilho.
    this.missilePivot.position.x = (1 - k) * -3;
    this.missilePivot.rotation.x += dt * 0.7;
    this.missilePivot.rotation.y = Math.sin(t * 0.6) * 0.35;
  }

  private updateGun(dt: number, t: number): void {
    const s = this.stages.gun;
    const spec = GUNS[this.gunId];
    const k = easeOutBack(Math.min(1, s.pop));
    this.gunPivot.scale.setScalar(0.6 + 0.4 * k);
    this.gunPivot.rotation.y = -0.45 + Math.sin(t * 0.5) * 0.3;
    this.gunPivot.rotation.x = 0.12;
    // Rajada de 0,9 s a cada 2,4 s: mostra cadência e cor do traçante.
    const firing = t % 2.4 < 0.9;
    const g = this.gun;
    if (!g) return;
    if (this.gunId === "m61") {
      g.barrels.rotation.z += dt * (firing ? 38 : 3);
    } else {
      g.barrels.position.z = firing ? Math.abs(Math.sin(t * Math.PI / spec.interval)) * 0.035 : 0;
    }
    this.flash.visible = firing && Math.sin(t * 90) > -0.2;
    const muzzle = g.muzzle.clone().applyMatrix4(g.group.matrix);
    this.flash.position.copy(muzzle);
    this.flash.scale.setScalar(this.gunId === "cal30" ? 0.35 : this.gunId === "cal50" ? 0.55 : 0.6);

    // Traçantes: velocidade e alcance proporcionais à arma (escala reduzida para caber no quadro).
    this.gunPivot.updateMatrixWorld();
    this.tracerTimer -= dt;
    if (firing && this.tracerTimer <= 0) {
      this.tracerTimer = Math.max(spec.interval * 3, 0.06);
      const tr = this.tracers.find((x) => !x.live);
      if (tr) {
        tr.live = true;
        tr.age = 0;
        tr.mesh.visible = true;
        tr.mesh.position.copy(muzzle).applyMatrix4(this.gunPivot.matrixWorld);
        tr.mesh.quaternion.setFromRotationMatrix(this.gunPivot.matrixWorld);
        tr.mesh.userData.dir = new THREE.Vector3(1, 0, 0).applyQuaternion(tr.mesh.quaternion);
      }
    }
    const life = (spec.life / 2.2) * 0.45;
    for (const tr of this.tracers) {
      if (!tr.live) continue;
      tr.age += dt;
      tr.mesh.position.addScaledVector(tr.mesh.userData.dir as THREE.Vector3, (spec.speed / 900) * 9 * dt);
      (tr.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - tr.age / life);
      if (tr.age > life) {
        tr.live = false;
        tr.mesh.visible = false;
      }
    }
  }

  render(dt: number): void {
    this.time += dt;
    const r = this.renderer;
    const box = this.canvas.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (w < 2 || h < 2) return;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.setSize(w, h, false);
    r.setScissor(0, 0, w, h);
    r.clear();
    const target = new THREE.Vector3();
    for (const kind of ["jet", "missile", "gun"] as const) {
      const s = this.stages[kind];
      s.pop = Math.min(1, s.pop + dt * 1.8);
      const rect = s.el.getBoundingClientRect();
      const x = rect.left - box.left;
      const y = rect.top - box.top;
      if (rect.width < 4 || rect.height < 4 || y > h || y + rect.height < 0) continue;
      s.update(dt, this.time);
      const elev = kind === "jet" ? 0.36 : 0.12;
      target.set(0, kind === "jet" ? 1.4 : 0, 0);
      frame(s.camera, s.span, s.spanH, rect.width / rect.height, elev, target);
      // WebGL conta y de baixo para cima.
      const by = h - y - rect.height;
      r.setViewport(x, by, rect.width, rect.height);
      r.setScissor(x, by, rect.width, rect.height);
      r.render(s.scene, s.camera);
    }
  }
}
