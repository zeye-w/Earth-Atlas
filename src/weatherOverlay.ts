import {
  BillboardCollection,
  Cartesian3,
  Color,
  EllipsoidalOccluder,
  Ellipsoid,
  Matrix4,
  Rectangle,
  SceneTransforms,
  SingleTileImageryProvider,
  type Viewer,
} from "cesium";
import {
  sampleWeather,
  temperatureColor,
  windRotation,
  type WeatherGrid,
} from "./weatherData";

export async function createWeatherOverlay(
  viewer: Viewer,
  data: WeatherGrid,
  temperature: boolean,
  wind: boolean,
  isCancelled: () => boolean,
) {
  const scene = viewer.scene;
  let imagery:
    | ReturnType<typeof viewer.imageryLayers.addImageryProvider>
    | undefined;
  let arrows: BillboardCollection | undefined;
  let off: (() => void) | undefined;
  if (temperature) {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!,
      image = ctx.createImageData(720, 360);
    for (let y = 0; y < 360; y++)
      for (let x = 0; x < 720; x++) {
        const color = temperatureColor(
          sampleWeather(data, 89.75 - y * 0.5, -179.75 + x * 0.5).temperature,
        );
        image.data.set([...color, 255], (y * 720 + x) * 4);
      }
    ctx.putImageData(image, 0, 0);
    const provider = await SingleTileImageryProvider.fromUrl(
      canvas.toDataURL(),
      {
        rectangle: Rectangle.MAX_VALUE,
        credit: "NOAA GFS · processed 1° grid",
      },
    );
    if (isCancelled() || viewer.isDestroyed()) return () => {};
    imagery = viewer.imageryLayers.addImageryProvider(provider);
    imagery.alpha = 0.72;
  }
  if (wind) {
    arrows = scene.primitives.add(
      new BillboardCollection(),
    ) as BillboardCollection;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 48;
    const ctx = canvas.getContext("2d")!;
    ctx.strokeStyle = "#10252e";
    ctx.lineWidth = 7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const draw = () => {
      ctx.beginPath();
      ctx.moveTo(16, 42);
      ctx.lineTo(16, 7);
      ctx.moveTo(6, 18);
      ctx.lineTo(16, 7);
      ctx.lineTo(26, 18);
      ctx.stroke();
    };
    draw();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 3;
    draw();
    const entries: {
      p: Cartesian3;
      tip: Cartesian3;
      billboard: ReturnType<BillboardCollection["add"]>;
    }[] = [];
    for (let lat = -80; lat <= 80; lat += 4)
      for (let lon = -180; lon < 180; lon += 4) {
        const { u, v } = sampleWeather(data, lat, lon),
          speed = Math.hypot(u, v);
        if (speed < 0.5) continue;
        const p = Cartesian3.fromDegrees(lon, lat, 12000),
          phi = (lat * Math.PI) / 180,
          lambda = (lon * Math.PI) / 180;
        const delta = new Cartesian3(
          -Math.sin(lambda) * u - Math.sin(phi) * Math.cos(lambda) * v,
          Math.cos(lambda) * u - Math.sin(phi) * Math.sin(lambda) * v,
          Math.cos(phi) * v,
        );
        const tip = Cartesian3.add(
          p,
          Cartesian3.multiplyByScalar(delta, 2000, new Cartesian3()),
          new Cartesian3(),
        );
        const billboard = arrows.add({
          id: `weather:${lat}:${lon}`,
          position: p,
          image: canvas,
          width: 16,
          height: 12 + Math.min(30, speed) * 0.8,
          color: Color.WHITE,
          show: false,
        });
        entries.push({ p, tip, billboard });
      }
    const update = () => {
      const occupied = new Map<string, { x: number; y: number }>(),
        occluder = new EllipsoidalOccluder(
          Ellipsoid.WGS84,
          viewer.camera.positionWC,
        );
      for (const e of entries) {
        e.billboard.show = false;
        if (!occluder.isPointVisible(e.p)) continue;
        const p = SceneTransforms.worldToWindowCoordinates(scene, e.p),
          tip = SceneTransforms.worldToWindowCoordinates(scene, e.tip);
        if (
          !p ||
          !tip ||
          p.x < 0 ||
          p.y < 0 ||
          p.x > scene.canvas.clientWidth ||
          p.y > scene.canvas.clientHeight
        )
          continue;
        const cx = Math.floor(p.x / 44),
          cy = Math.floor(p.y / 44),
          cell = `${cx},${cy}`;
        let collision = false;
        for (let x = cx - 1; x <= cx + 1; x++)
          for (let y = cy - 1; y <= cy + 1; y++) {
            const other = occupied.get(`${x},${y}`);
            if (other && Math.hypot(other.x - p.x, other.y - p.y) < 44)
              collision = true;
          }
        if (collision || Math.hypot(tip.x - p.x, tip.y - p.y) < 0.01) continue;
        occupied.set(cell, p);
        e.billboard.rotation = windRotation(tip.x - p.x, tip.y - p.y);
        e.billboard.show = true;
      }
      scene.requestRender();
    };
    const lastView = new Matrix4();
    let lastWidth = -1,
      lastHeight = -1;
    // Inspect only on frames Cesium already renders; a stationary scene has no animation loop.
    off = scene.preRender.addEventListener(() => {
      if (
        Matrix4.equalsEpsilon(lastView, viewer.camera.viewMatrix, 1e-10) &&
        lastWidth === scene.canvas.clientWidth &&
        lastHeight === scene.canvas.clientHeight
      )
        return;
      Matrix4.clone(viewer.camera.viewMatrix, lastView);
      lastWidth = scene.canvas.clientWidth;
      lastHeight = scene.canvas.clientHeight;
      update();
    });
    update();
  }
  scene.requestRender();
  return () => {
    off?.();
    if (viewer.isDestroyed()) return;
    if (imagery) viewer.imageryLayers.remove(imagery, true);
    if (arrows) scene.primitives.remove(arrows);
    scene.requestRender();
  };
}
