import * as THREE from "three";

/**
 * Visão térmica (FLIR "branco quente") do drone, em duas partes:
 * 1) objetos quentes (motores, veículos) trocam o material por branco puro sem iluminação;
 * 2) a cena é renderizada num render target e um shader converte luminância em escala de calor,
 *    com granulação, linhas de varredura e vinheta de sensor.
 * Custa um passe extra só enquanto o drone está ativo.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float heat = pow(smoothstep(0.015, 0.9, l), 0.85);
  float grain = (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime * 7.0)) - 0.5) * 0.07;
  float scan = 0.965 + 0.035 * sin(vUv.y * 900.0 + uTime * 30.0);
  float vig = smoothstep(1.05, 0.35, length((vUv - 0.5) * vec2(1.25, 1.0)));
  vec3 col = vec3(heat * scan * vig + grain);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export const HOT = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
export const WARM = new THREE.MeshBasicMaterial({ color: 0x8a8a8a, fog: false });
const COLD_BG = new THREE.Color(0x0c0c0c);

export class ThermalView {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  private readonly touched = new Set<THREE.Mesh>();

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.target.texture }, uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Marca objetos como quentes/mornos; chamado a cada quadro (novos inimigos também esquentam). */
  heat(obj: THREE.Object3D, warm = false): void {
    const m = warm ? WARM : HOT;
    obj.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.material === m) return;
      const ud = o.userData as { thermalPrev?: THREE.Material | THREE.Material[] };
      if (o.material !== HOT && o.material !== WARM) ud.thermalPrev = o.material as THREE.Material;
      o.material = m;
      this.touched.add(o);
    });
  }

  /** Devolve todos os materiais originais. */
  restore(): void {
    for (const o of this.touched) {
      const ud = o.userData as { thermalPrev?: THREE.Material };
      if (ud.thermalPrev) o.material = ud.thermalPrev;
      delete ud.thermalPrev;
    }
    this.touched.clear();
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number, hide: readonly THREE.Object3D[]): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.target.width !== size.x || this.target.height !== size.y) this.target.setSize(size.x, size.y);
    // Céu e nuvens são "frios" no infravermelho: escondidos e fundo quase preto.
    const fog = scene.fog as THREE.Fog | null;
    const fogColor = fog?.color.clone();
    const bg = scene.background;
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    fog?.color.copy(COLD_BG);
    scene.background = COLD_BG;

    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    this.mat.uniforms.uTime!.value = time;
    renderer.render(this.quadScene, this.quadCam);

    hide.forEach((o, i) => (o.visible = vis[i]!));
    if (fog && fogColor) fog.color.copy(fogColor);
    scene.background = bg;
  }
}
