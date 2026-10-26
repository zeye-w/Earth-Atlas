import assert from "node:assert/strict";
import { test } from "node:test";
import { Event } from "cesium";

globalThis.document ??= { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };
globalThis.window ??= { matchMedia: () => ({ matches: true }) };
const { FireworksOverlay } = await import("../src/fireworks/FireworksOverlay.ts");

function fakeViewer() {
  const camera = {
    moveEnd: new Event(),
    positionCartographic: { height: 20_000_000 },
    flyToBoundingSphere() {}, // Never completes: the show itself is not under test here.
    cancelFlight() {},
    lookAtTransform() {},
  };
  const scene = {
    screenSpaceCameraController: { minimumZoomDistance: 15_000 },
    primitives: { add: (p) => p, remove() {} },
    requestRender() {},
  };
  return { camera, scene, isDestroyed: () => false };
}

test("stopping a show near the ground does not pull the camera back up", () => {
  const viewer = fakeViewer();
  const controller = viewer.scene.screenSpaceCameraController;
  const overlay = new FireworksOverlay(viewer, () => {});
  assert.equal(overlay.launch({ longitude: 139.7, latitude: 35.7, label: "东京" }, "bloom"), true);
  assert.equal(controller.minimumZoomDistance, 100);

  viewer.camera.positionCartographic.height = 700;
  overlay.stop();
  assert.equal(controller.minimumZoomDistance, 100, "restoring 15 km here would yank the camera up");
  viewer.camera.moveEnd.raiseEvent();
  assert.equal(controller.minimumZoomDistance, 100);

  viewer.camera.positionCartographic.height = 16_000;
  viewer.camera.moveEnd.raiseEvent();
  assert.equal(controller.minimumZoomDistance, 15_000);
  assert.equal(viewer.camera.moveEnd.numberOfListeners, 0);
  overlay.dispose();
});

test("a pending restore keeps the original minimum across shows and on dispose", () => {
  const viewer = fakeViewer();
  const controller = viewer.scene.screenSpaceCameraController;
  const overlay = new FireworksOverlay(viewer, () => {});
  overlay.launch({ longitude: 0, latitude: 0, label: "a" }, "ring");
  viewer.camera.positionCartographic.height = 700;
  overlay.stop();
  overlay.launch({ longitude: 1, latitude: 1, label: "b" }, "willow");
  assert.equal(controller.minimumZoomDistance, 100);
  overlay.stop();
  overlay.dispose();
  assert.equal(controller.minimumZoomDistance, 15_000);
  assert.equal(viewer.camera.moveEnd.numberOfListeners, 0);
});

test("stopping high above the minimum restores it at once", () => {
  const viewer = fakeViewer();
  const overlay = new FireworksOverlay(viewer, () => {});
  overlay.launch({ longitude: 0, latitude: 0, label: "a" }, "bloom");
  overlay.stop();
  assert.equal(viewer.scene.screenSpaceCameraController.minimumZoomDistance, 15_000);
  assert.equal(viewer.camera.moveEnd.numberOfListeners, 0);
  overlay.dispose();
});
