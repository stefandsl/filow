"use client";
// OK Filow 3D view (HeyClicky 1.1.1: "builds a 3D model you can drag around and click on to ask about
// any part"). The model arrives from the panel as validated parts (lib/buddy/visuals.ts) and is shown
// in place beside the user's pointer: no panel, no title bar, no footer, only the model on a soft
// stage, lit by a key, a fill and a rim light, framed to about 70% of the view. Its biggest parts carry
// numbered labels on leader lines that follow them as the model turns (lib/buddy/model-labels.ts).
// Drag to turn, scroll to zoom, hover to see a part, click a part (or its label, also by keyboard) to
// ask OK Filow about it. Reduced motion: no turning by itself and no entry.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useLang } from "@filow/ui";
import { okFilowBridge } from "@/lib/buddy/bridge";
import { okfText } from "@/lib/buddy/text";
import { surfaceAnchor } from "@/lib/buddy/model-surface";
import { fitScale, frameDistance, labelledParts, layoutPartLabels, leaderPoints, readingOrder, type LabelSide } from "@/lib/buddy/model-labels";
import type { BuddyModel, ModelPart } from "@/lib/buddy/visuals";
import "../okfilow.css";

const DEG = Math.PI / 180;
/** The camera's field of view, and how much of the view's height the model fills. */
const FOV = 35;
const FILL = 0.7;
/** The entry: a fade and a small scale (CSS), with the camera dollying in over the same time. */
const ENTRY_MS = 350;
const DOLLY_FROM = 1.18;
/** A part label's font, padding and height (the CSS of .okf-part says the same). */
const LABEL_FONT = "600 14px system-ui, sans-serif";
const LABEL_HEIGHT = 28;
const LABEL_CHROME = 20 + 6 + 8 + 11; // number badge, its gap, left and right padding
const LABEL_MAX = 180;

function geometryFor(p: ModelPart): THREE.BufferGeometry {
  const [a, b, c] = p.size;
  switch (p.shape) {
    case "box": return new THREE.BoxGeometry(a, b || a, c || a);
    case "sphere": return new THREE.SphereGeometry(a / 2, 40, 24);
    case "cylinder": return new THREE.CylinderGeometry(a / 2, (c || a) / 2, b || a, 40);
    case "cone": return new THREE.ConeGeometry(a / 2, b || a, 40);
    case "torus": return new THREE.TorusGeometry(Math.max(0.05, a / 2 - (b || a / 8) / 2), Math.max(0.02, (b || a / 8) / 2), 18, 56);
    case "capsule": return new THREE.CapsuleGeometry(a / 2, Math.max(0, (b || a) - a), 8, 20);
  }
}

let measure: CanvasRenderingContext2D | null = null;
function labelWidth(text: string): number {
  if (!measure && typeof document !== "undefined") measure = document.createElement("canvas").getContext("2d");
  let w = text.length * 8;
  if (measure) {
    measure.font = LABEL_FONT;
    w = measure.measureText(text).width;
  }
  return Math.min(LABEL_MAX, Math.ceil(w) + LABEL_CHROME);
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (k: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);

export default function OkFilowModel() {
  const host = useRef<HTMLDivElement>(null);
  const leaders = useRef<SVGSVGElement>(null);
  const labelEls = useRef<Array<HTMLButtonElement | null>>([]);
  const [model, setModel] = useState<BuddyModel | null>(null);
  const [hover, setHover] = useState("");
  const [picked, setPicked] = useState("");
  /** The part whose label has the keyboard focus or the pointer: lit like a hovered part. */
  const focusPart = useRef<number | null>(null);
  const t = okfText(useLang());

  useEffect(() => {
    const b = okFilowBridge();
    if (!b) return;
    const off = b.onModel((m) => { setModel(m); setPicked(""); });
    b.modelReady();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") b.closeModel(); };
    window.addEventListener("keydown", onKey);
    return () => { off(); window.removeEventListener("keydown", onKey); };
  }, []);

  /** The parts that carry a label (the biggest, one per name), numbered 1.. in the model's order. */
  const labelled = useMemo(() => {
    if (!model) return [];
    const size = (p: ModelPart) => Math.max(p.size[0] || 0, p.size[1] || p.size[0] || 0, p.size[2] || p.size[0] || 0);
    return labelledParts(model.parts.map((p) => p.name), model.parts.map(size)).map((i, k) => ({ part: i, n: k + 1, name: model.parts[i].name, width: labelWidth(model.parts[i].name) }));
  }, [model]);

  const ask = (name: string) => {
    if (!model) return;
    setPicked(name);
    okFilowBridge()?.askAbout(`Tell me about the ${name} of the ${model.title}.`);
  };

  useEffect(() => {
    const el = host.current;
    if (!el || !model) return;
    const still = reducedMotion();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(FOV, el.clientWidth / el.clientHeight, 0.05, 200);
    // Three-point light: a warm key from the front right, a cool fill from the left, a rim from behind.
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(5, 6, 7);
    const fill = new THREE.DirectionalLight(0xdbe6ff, 0.8);
    fill.position.set(-6, 2, 4);
    const rim = new THREE.DirectionalLight(0xffffff, 2.2);
    rim.position.set(-2, 4, -7);
    scene.add(key, fill, rim, new THREE.HemisphereLight(0xffffff, 0x223344, 0.25));
    // the lights turn with the camera, so the model is always lit from the viewer's side
    const lights = new THREE.Group();
    scene.remove(key, fill, rim);
    lights.add(key, fill, rim);
    scene.add(lights);

    const group = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    const extras: Array<THREE.Material | THREE.BufferGeometry> = [];
    for (const p of model.parts) {
      const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.42, metalness: 0.2, envMapIntensity: 0.7 });
      const mesh = new THREE.Mesh(geometryFor(p), mat);
      mesh.position.set(...p.pos);
      mesh.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
      mesh.userData = { name: p.name };
      group.add(mesh);
      meshes.push(mesh);
    }
    // A part with other parts inside it (an engine casing around its insides) is drawn like a cutaway:
    // a faint glass front, a darker inner shell behind the insides, and its edges outlined.
    group.updateMatrixWorld(true);
    const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m));
    meshes.forEach((m, i) => {
      const size = boxes[i].getSize(new THREE.Vector3()).length();
      const inside = boxes.some((o, j) => j !== i && boxes[i].containsPoint(o.getCenter(new THREE.Vector3())) && size > o.getSize(new THREE.Vector3()).length());
      if (!inside) return;
      m.userData.shell = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = 0.14;
      mat.depthWrite = false;
      m.renderOrder = 2;
      const shellMat = new THREE.MeshStandardMaterial({ color: mat.color.clone().multiplyScalar(0.45), roughness: 0.8, metalness: 0, side: THREE.BackSide, transparent: true, opacity: 0.55, depthWrite: false });
      const shell = new THREE.Mesh(m.geometry, shellMat);
      shell.renderOrder = 0;
      m.add(shell);
      const edges = new THREE.EdgesGeometry(m.geometry, 25);
      // a mid grey outline reads on a white page and on a black one
      const lineMat = new THREE.LineBasicMaterial({ color: 0x8b95a7, transparent: true, opacity: 0.95 });
      m.add(new THREE.LineSegments(edges, lineMat));
      extras.push(shellMat, edges, lineMat);
    });
    // Centre the model and frame it to ~70% of the view.
    const box = new THREE.Box3().setFromObject(group);
    const centre = box.getCenter(new THREE.Vector3());
    group.position.sub(centre);
    scene.add(group);
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 2;
    const dir = new THREE.Vector3(5, 3.2, 6).normalize();
    // Framed to ~70%: a first guess from the model's size, then measured on screen over a whole turn
    // (the camera goes round the model as it turns) and corrected, so a long model stays clear of the labels.
    let framed = frameDistance(radius, FOV, camera.aspect, FILL);
    {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const v = new THREE.Vector3();
      let ew = 0;
      let eh = 0;
      for (let k = 0; k < 6; k++) {
        camera.position.copy(dir).multiplyScalar(framed).applyAxisAngle(new THREE.Vector3(0, 1, 0), (k * Math.PI) / 6);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const m of meshes) {
          const pos = m.geometry.attributes.position;
          for (let i = 0; i < pos.count; i += 2) {
            v.fromBufferAttribute(pos, i);
            m.localToWorld(v).project(camera);
            x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
          }
        }
        ew = Math.max(ew, ((x1 - x0) / 2) * w);
        eh = Math.max(eh, ((y1 - y0) / 2) * h);
      }
      const column = labelled.length ? Math.max(...labelled.map((l) => l.width)) + 22 : 0;
      framed /= fitScale({ width: ew, height: eh }, { width: w, height: h }, column, FILL);
    }
    const distance = () => framed;
    const startedAt = performance.now();
    camera.position.copy(dir).multiplyScalar(distance() * (still ? 1 : DOLLY_FROM));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = !still;
    controls.autoRotateSpeed = 0.9;
    controls.minDistance = radius * 1.2;
    controls.maxDistance = radius * 8;
    let touched = false;
    controls.addEventListener("start", () => { controls.autoRotate = false; touched = true; });

    // Each labelled part's anchor: the middle of its own box, carried along as the model turns.
    const anchors = labelled.map(({ part }) => {
      const g = meshes[part].geometry;
      g.computeBoundingBox();
      return g.boundingBox!.getCenter(new THREE.Vector3());
    });
    (el as HTMLDivElement & { __okf?: unknown }).__okf = { camera, meshes, anchors, parts: labelled.map((l) => l.part) };

    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let lit: THREE.Mesh | null = null;
    const hit = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      return (ray.intersectObjects(meshes, false)[0]?.object as THREE.Mesh | undefined) ?? null;
    };
    const glow = (m: THREE.Mesh | null) => {
      if (lit === m) return;
      if (lit) (lit.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      lit = m;
      if (lit) (lit.material as THREE.MeshStandardMaterial).emissive.setHex(0x553300);
      setHover(m ? String(m.userData.name) : "");
      renderer.domElement.style.cursor = m ? "pointer" : "grab";
      const at = m ? meshes.indexOf(m) : -1;
      labelled.forEach((l, k) => labelEls.current[k]?.classList.toggle("okf-part--on", l.part === at));
    };
    let downAt = { x: 0, y: 0 };
    const onMove = (ev: PointerEvent) => {
      const mesh = hit(ev);
      glow(mesh);
      okFilowBridge()?.modelHover?.(Boolean(mesh) || ev.buttons > 0);
    };
    const onLeave = () => {
      glow(focusPart.current === null ? null : meshes[focusPart.current]);
      okFilowBridge()?.modelHover?.(false);
    };
    const onDown = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4) return; // that was a drag
      const m = hit(ev);
      if (m) ask(String(m.userData.name));
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    const onFocusPart = () => glow(focusPart.current === null ? null : meshes[focusPart.current]);
    el.addEventListener("okf-focus-part", onFocusPart);
    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // The labels: laid out every frame from where their parts are now, in two columns inside the frame,
    // numbered in reading order; each leader runs level out of the model, then to its label, so no two
    // ever cross (its dot is always on its part). A part turned out of the frame hides its label.
    let sides: LabelSide[] | null = null;
    const world = new THREE.Vector3();
    const lines = Array.from(leaders.current?.querySelectorAll("g.okf-part-leader") ?? []);
    const placeLabels = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!labelled.length || !w || !h) return;
      const project = (v: THREE.Vector3) => {
        world.copy(v).project(camera);
        return { x: ((world.x + 1) / 2) * w, y: ((1 - world.y) / 2) * h };
      };
      const pts = anchors.map((a, k) => {
        const mesh = meshes[labelled[k].part];
        a.copy(surfaceAnchor(mesh, camera));
        return project(mesh.localToWorld(world.copy(a)).clone());
      });
      const mid = project(new THREE.Vector3(0, 0, 0)).x;
      const slots = layoutPartLabels(pts, labelled.map((l) => ({ width: l.width, height: LABEL_HEIGHT })), { width: w, height: h }, mid, sides);
      sides = slots.map((s) => s.side);
      const numbers = readingOrder(slots);
      slots.forEach((s, i) => {
        const inside = s.from.x >= 4 && s.from.x <= w - 4 && s.from.y >= 4 && s.from.y <= h - 4;
        const label = labelEls.current[i];
        if (label) {
          label.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
          label.style.visibility = inside ? "" : "hidden";
          const n = label.firstElementChild;
          if (n && n.textContent !== String(numbers[i])) n.textContent = String(numbers[i]);
        }
        const g = lines[i];
        if (!g) return;
        (g as SVGGElement).style.visibility = inside ? "" : "hidden";
        const points = leaderPoints(s).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
        for (const line of g.querySelectorAll("polyline")) line.setAttribute("points", points);
        for (const dot of g.querySelectorAll("circle")) {
          dot.setAttribute("cx", s.from.x.toFixed(1));
          dot.setAttribute("cy", s.from.y.toFixed(1));
        }
      });
    };

    let raf = 0;
    const loop = (now: number) => {
      // The entry's dolly: the camera comes in to its framing distance (until the user takes over).
      if (!still && !touched) {
        const k = easeOut((now - startedAt) / ENTRY_MS);
        if (k < 1) camera.position.setLength(distance() * (DOLLY_FROM + (1 - DOLLY_FROM) * k));
      }
      controls.update();
      lights.quaternion.copy(camera.quaternion);
      renderer.render(scene, camera);
      placeLabels();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      el.removeEventListener("okf-focus-part", onFocusPart);
      controls.dispose();
      for (const m of meshes) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      for (const x of extras) x.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // `ask` reads the model it was made with; the effect is rebuilt with each model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, labelled]);

  const b = typeof window === "undefined" ? null : okFilowBridge();
  const focus = (part: number | null) => {
    focusPart.current = part;
    host.current?.dispatchEvent(new Event("okf-focus-part"));
  };
  return (
    <main className="okf-model" aria-label={model?.title ?? "OK Filow"} key={model ? "m-" + model.title : "none"}>
      <div ref={host} className="okf-model-view" title={t("modelHint")} />
      <svg ref={leaders} className="okf-model-leaders" width="100%" height="100%" aria-hidden key={model ? model.title + labelled.length : "none"}>
        {labelled.map((l) => (
          <g key={l.part} className="okf-part-leader">
            <polyline className="okf-part-halo" points="-99,-99 -99,-99" />
            <polyline className="okf-part-ink" points="-99,-99 -99,-99" />
            <circle cx={-99} cy={-99} r={3.5} />
          </g>
        ))}
      </svg>
      <ol className="okf-model-parts" aria-label={model?.title ?? ""}>
        {labelled.map((l, k) => (
          <li key={l.part}>
            <button
              type="button"
              ref={(x) => { labelEls.current[k] = x; }}
              className="okf-part"
              style={{ maxWidth: LABEL_MAX, transform: "translate(-999px, -999px)" }}
              onClick={() => ask(l.name)}
              onFocus={() => focus(l.part)}
              onBlur={() => focus(null)}
              onPointerEnter={() => { focus(l.part); b?.modelHover?.(true); }}
              onPointerLeave={() => focus(null)}
            >
              <span className="okf-part-n" aria-hidden>{l.n}</span>
              <span className="okf-part-name">{l.name}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="okf-model-tools" onPointerEnter={() => b?.modelHover?.(true)} onPointerLeave={() => b?.modelHover?.(false)}>
        <span className="okf-model-grip" aria-hidden />
        <button type="button" className="okf-x" aria-label={t("close")} title={t("close")} onClick={() => b?.closeModel()}>×</button>
      </div>
      <p className="okf-sr">{t("modelHint")}</p>
      <p className="okf-sr" aria-live="polite">{hover ? hover : picked ? t("modelAsking").replace("{part}", picked) : ""}</p>
    </main>
  );
}
