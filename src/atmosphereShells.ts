import {
  Cartesian3,
  Color,
  EllipsoidGeometry,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Primitive,
  VertexFormat,
  type Viewer,
} from "cesium";
import { ATMOSPHERE_LAYERS, shellRadii } from "./atmosphereLayers.ts";

// Fresnel rim: transparent where the shell faces the camera, glowing where
// the line of sight grazes it, so stacked shells read as layered limbs.
const SHELL_SHADER = `
uniform vec4 color;
uniform float power;

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  float facing = abs(dot(normalize(materialInput.normalEC), normalize(materialInput.positionToEyeEC)));
  float rim = pow(1.0 - facing, power);
  material.diffuse = color.rgb;
  material.emission = color.rgb * rim * 0.6;
  material.alpha = clamp(rim * color.a, 0.0, 1.0);
  return material;
}
`;

// The thick thermosphere shell would otherwise wash over the whole view from
// nearby; the Karman line is a convention, so it is drawn faintly.
const SHELL_ALPHA: Record<string, number> = { thermosphere: 0.16, karman: 0.3 };

export class AtmosphereShellOverlay {
  private readonly viewer: Viewer;
  private primitives: Primitive[] = [];

  constructor(viewer: Viewer, scale: number) {
    this.viewer = viewer;
    this.build(scale);
  }

  private build(scale: number): void {
    // Thin shells need a sharper rim so each boundary stays distinct.
    ATMOSPHERE_LAYERS.forEach((layer, index) => {
      const [x, y, z] = shellRadii(layer, scale);
      const primitive = new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: new EllipsoidGeometry({
            radii: new Cartesian3(x, y, z),
            stackPartitions: 96,
            slicePartitions: 96,
            vertexFormat: VertexFormat.POSITION_NORMAL_AND_ST,
          }),
        }),
        appearance: new MaterialAppearance({
          material: new Material({
            fabric: {
              type: "TerraScopeAtmosphereShell" + index,
              uniforms: { color: Color.fromCssColorString(layer.color).withAlpha(SHELL_ALPHA[layer.key] ?? 0.55), power: layer.key === "thermosphere" ? 4.0 : 12.0 },
              source: SHELL_SHADER,
            },
            translucent: true,
          }),
          translucent: true,
          flat: true,
          faceForward: false,
        }),
        allowPicking: false,
        asynchronous: true,
      });
      this.viewer.scene.primitives.add(primitive);
      this.primitives.push(primitive);
    });
    this.viewer.scene.requestRender();
  }

  setScale(scale: number): void {
    this.clear();
    if (!this.viewer.isDestroyed()) this.build(scale);
  }

  setVisible(visible: boolean): void {
    for (const primitive of this.primitives) primitive.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  private clear(): void {
    if (!this.viewer.isDestroyed()) {
      for (const primitive of this.primitives) this.viewer.scene.primitives.remove(primitive);
    }
    this.primitives = [];
  }

  dispose(): void {
    this.clear();
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }
}
