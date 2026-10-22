import {
  Rectangle,
  SingleTileImageryProvider,
  type Viewer,
} from "cesium";
import {
  sampleWeather,
  temperatureColor,
  type WeatherGrid,
} from "./weatherData";

export async function createWeatherOverlay(
  viewer: Viewer,
  data: WeatherGrid,
  temperature: boolean,
  isCancelled: () => boolean,
) {
  const scene = viewer.scene;
  let imagery:
    | ReturnType<typeof viewer.imageryLayers.addImageryProvider>
    | undefined;
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
  scene.requestRender();
  return () => {
    if (viewer.isDestroyed()) return;
    if (imagery) viewer.imageryLayers.remove(imagery, true);
    scene.requestRender();
  };
}
