import { BlendingState, ComponentDatatype, PrimitiveType } from "cesium";
import { Buffer, BufferUsage, DrawCommand, Pass, RenderState, ShaderProgram, VertexArray, type CesiumCommand, type Destroyable } from "./cesiumRenderer";
import { STAR_BRIGHTNESS, STAR_GROWTH, STAR_SIGMA, STAR_VERTEX_FLOATS } from "./starCatalog";

/**
 * The bright stars as points of light, sharp at any screen resolution, drawn
 * with the sky box (src/stars/StarrySkyBox.ts): after its faces, before the
 * atmosphere, the Sun and the Moon, so those cover the stars behind them.
 *
 * Like the sky box, each star is a direction turned into the Earth-fixed
 * frame (czm_temeToPseudoFixed) and then the view's rotation only: it sits at
 * infinity, with no parallax wherever the camera flies, and no depth test.
 * The sprite (starSprite in starCatalog.ts) is a Gaussian holding the star's
 * light, widening only for stars too bright for its peak.
 */
const VS = `
in vec3 position;
in vec4 color;
uniform float u_brightness;
uniform float u_sigma0;
out vec3 v_color;
out float v_peak;
out float v_sigma;
out float v_size;

void main()
{
    vec3 p = czm_viewRotation * (czm_temeToPseudoFixed * position);
    vec4 clip = czm_projection * vec4(p, 1.0);
    float pr = czm_pixelRatio;
    float s0 = u_sigma0 * pr;
    float total = color.a * u_brightness * pr * pr;
    float saturated = 6.2831853 * s0 * s0;
    float sigma = total > saturated ? s0 * pow(total / saturated, ${STAR_GROWTH.toFixed(3)}) : s0;
    float peak = min(1.0, total / (6.2831853 * sigma * sigma));
    v_color = color.rgb;
    v_peak = peak;
    v_sigma = sigma;
    float size = clamp(ceil(sigma * 6.0), 3.0, 64.0);
    v_size = size;
    // Behind the camera, or too faint to show: drop the point.
    bool hidden = clip.w <= 0.0 || peak < 0.004;
    gl_PointSize = hidden ? 0.0 : size;
    // Depth is not used (no test, no write); keep the point inside the clip volume.
    gl_Position = hidden ? vec4(0.0, 0.0, 2.0, 1.0) : vec4(clip.xy, 0.0, clip.w);
}
`;

const FS = `
in vec3 v_color;
in float v_peak;
in float v_sigma;
in float v_size;

void main()
{
    vec2 d = (gl_PointCoord - 0.5) * v_size;
    float a = v_peak * exp(-dot(d, d) / (2.0 * v_sigma * v_sigma));
    if (a < 0.002) discard;
    out_FragColor = vec4(v_color, a);
}
`;


export class StarField {
  brightness = STAR_BRIGHTNESS;
  sigma0 = STAR_SIGMA;
  show = true;
  private readonly vertices: Float32Array;
  private command: (CesiumCommand & Record<string, unknown>) | undefined;
  private resources: Destroyable[] = [];
  private destroyed = false;

  constructor(vertices: Float32Array) {
    this.vertices = vertices;
  }

  get count(): number { return this.vertices.length / STAR_VERTEX_FLOATS; }

  /** The draw command for this frame (created on first use in the scene's WebGL context). */
  update(frameState: { context: unknown }): CesiumCommand | undefined {
    if (!this.show || this.destroyed || this.count === 0) return undefined;
    if (!this.command) {
      const context = frameState.context;
      const stride = STAR_VERTEX_FLOATS * 4;
      const buffer = Buffer.createVertexBuffer({ context, typedArray: this.vertices, usage: BufferUsage.STATIC_DRAW });
      const vertexArray = new VertexArray({
        context,
        attributes: [
          { index: 0, vertexBuffer: buffer, componentsPerAttribute: 3, componentDatatype: ComponentDatatype.FLOAT, offsetInBytes: 0, strideInBytes: stride },
          { index: 1, vertexBuffer: buffer, componentsPerAttribute: 4, componentDatatype: ComponentDatatype.FLOAT, offsetInBytes: 12, strideInBytes: stride },
        ],
      });
      const shaderProgram = ShaderProgram.fromCache({ context, vertexShaderSource: VS, fragmentShaderSource: FS, attributeLocations: { position: 0, color: 1 } });
      this.resources = [vertexArray, shaderProgram];
      this.command = new DrawCommand({
        vertexArray,
        shaderProgram,
        primitiveType: PrimitiveType.POINTS,
        count: this.count,
        pass: Pass.ENVIRONMENT,
        owner: this,
        renderState: RenderState.fromCache({ depthTest: { enabled: false }, depthMask: false, blending: BlendingState.ADDITIVE_BLEND }),
        uniformMap: { u_brightness: () => this.brightness, u_sigma0: () => this.sigma0 },
      });
    }
    return this.command;
  }

  isDestroyed(): boolean { return this.destroyed; }

  destroy(): void {
    // The vertex array owns its buffer; the shader program is shared through Cesium's cache.
    for (const resource of this.resources) if (!resource.isDestroyed()) resource.destroy();
    this.resources = [];
    this.command = undefined;
    this.destroyed = true;
  }
}
