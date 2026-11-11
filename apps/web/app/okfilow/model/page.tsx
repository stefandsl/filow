"use client";
// OK Filow 3D model window (HeyClicky 1.1.1: "builds a 3D model you can drag around and click on to
// ask about any part"). The model arrives from the panel as validated parts (lib/buddy/visuals.ts).
// Drag to turn, scroll to zoom, hover to see a part's name, click a part to ask OK Filow about it.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useLang } from "@filow/ui";
import { okFilowBridge } from "@/lib/buddy/bridge";
import { okfText } from "@/lib/buddy/text";
import type { BuddyModel, ModelPart } from "@/lib/buddy/visuals";
import "../okfilow.css";

const DEG = Math.PI / 180;

function geometryFor(p: ModelPart): THREE.BufferGeometry {
  const [a, b, c] = p.size;
  switch (p.shape) {
    case "box": return new THREE.BoxGeometry(a, b || a, c || a);
    case "sphere": return new THREE.SphereGeometry(a / 2, 32, 20);
    case "cylinder": return new THREE.CylinderGeometry(a / 2, (c || a) / 2, b || a, 32);
    case "cone": return new THREE.ConeGeometry(a / 2, b || a, 32);
    case "torus": return new THREE.TorusGeometry(Math.max(0.05, a / 2 - (b || a / 8) / 2), Math.max(0.02, (b || a / 8) / 2), 16, 48);
    case "capsule": return new THREE.CapsuleGeometry(a / 2, Math.max(0, (b || a) - a), 8, 16);
  }
}

export default function OkFilowModel() {
  const host = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState<BuddyModel | null>(null);
  const [hover, setHover] = useState("");
  const [picked, setPicked] = useState("");
  const t = okfText(useLang());

  useEffect(() => {
    const b = okFilowBridge();
    if (!b) return;
    const off = b.onModel((m) => { setModel(m); setPicked(""); });
    b.modelReady();
    return off;
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !model) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(5, 4, 6);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(4, 8, 6);
    scene.add(sun);

    const group = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    for (const p of model.parts) {
      const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55, metalness: 0.15 });
      const mesh = new THREE.Mesh(geometryFor(p), mat);
      mesh.position.set(...p.pos);
      mesh.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
      mesh.userData = { name: p.name, color: p.color };
      group.add(mesh);
      meshes.push(mesh);
    }
    // A part with other parts inside it (an engine block around its pistons) turns see-through,
    // so the insides show, like a cutaway drawing.
    group.updateMatrixWorld(true);
    const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m));
    meshes.forEach((m, i) => {
      const size = boxes[i].getSize(new THREE.Vector3()).length();
      const inside = boxes.some((o, j) => j !== i && boxes[i].containsPoint(o.getCenter(new THREE.Vector3())) && size > o.getSize(new THREE.Vector3()).length());
      if (!inside) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = 0.35;
      mat.depthWrite = false;
      m.renderOrder = 1;
    });
    // Centre the model and frame it.
    const box = new THREE.Box3().setFromObject(group);
    const centre = box.getCenter(new THREE.Vector3());
    group.position.sub(centre);
    scene.add(group);
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 2;
    camera.position.setLength(radius * 3.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener("start", () => { controls.autoRotate = false; });

    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let lit: THREE.Mesh | null = null;
    const hit = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      return (ray.intersectObjects(meshes)[0]?.object as THREE.Mesh | undefined) ?? null;
    };
    const glow = (m: THREE.Mesh | null) => {
      if (lit === m) return;
      if (lit) (lit.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      lit = m;
      if (lit) (lit.material as THREE.MeshStandardMaterial).emissive.setHex(0x553300);
      setHover(m ? String(m.userData.name) : "");
      renderer.domElement.style.cursor = m ? "pointer" : "grab";
    };
    let downAt = { x: 0, y: 0 };
    const onMove = (ev: PointerEvent) => glow(hit(ev));
    const onDown = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4) return; // that was a drag
      const m = hit(ev);
      if (!m) return;
      const name = String(m.userData.name);
      setPicked(name);
      okFilowBridge()?.askAbout(`Tell me about the ${name} of the ${model.title}.`);
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      for (const m of meshes) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [model]);

  const b = typeof window === "undefined" ? null : okFilowBridge();
  return (
    <main className="okf-model">
      <header className="okf-model-head">
        <strong>{model?.title ?? "OK Filow"}</strong>
        <button type="button" className="okf-x" aria-label="Close" title="Close" onClick={() => b?.closeModel()}>×</button>
      </header>
      <div ref={host} className="okf-model-view" />
      <footer className="okf-model-foot" aria-live="polite">
        {hover ? hover : picked ? t("modelAsking").replace("{part}", picked) : t("modelHint")}
      </footer>
    </main>
  );
}
