import * as THREE from "three";
/** A ray from the viewer meets the actual geometry, including an open or transparent shell. */
export function surfaceAnchor(mesh: THREE.Mesh, camera: THREE.Camera): THREE.Vector3 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const centre = mesh.localToWorld(mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()));
  if (mesh.userData.shell) {
    // A transparent front projects over the inner machinery. Choose the upper shell instead,
    // so its label reads as casing even when the surface itself is see-through.
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    centre.addScaledVector(up, Math.min(size.x, size.y, size.z) * 0.35);
  }
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const ray = new THREE.Raycaster(eye, centre.clone().sub(eye).normalize());
  const hit = ray.intersectObject(mesh, false)[0];
  return hit ? mesh.worldToLocal(hit.point.clone()) : mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
}
