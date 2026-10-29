import {
  BoundingSphere, BoxGeometry, Cartesian3, Color, ColorGeometryInstanceAttribute, ComponentDatatype, CylinderGeometry, Geometry, GeometryAttribute,
  GeometryAttributes, GeometryInstance, GeometryPipeline, Material, MaterialAppearance, Matrix4, PerInstanceColorAppearance,
  Primitive, PrimitiveType,
} from "cesium";

/** Rocket geometry and appearances, shared by RocketOverlay and shaderWarmup.ts:
 * the warm-up only helps if it builds exactly the same shader programs. */
export function cylinderGeometry(length: number, topRadius: number, bottomRadius: number) {
  return new CylinderGeometry({ length, topRadius, bottomRadius, slices: 32, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT });
}

/** A box `x` × `y` × `z` metres (east, north, up), centred on its offset. Same vertex format as the cylinders, so the same shader. */
export function boxGeometry(x: number, y: number, z: number) {
  return BoxGeometry.fromDimensions({ dimensions: new Cartesian3(x, y, z), vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT });
}

/** A thin triangular fin with real volume and normals, rather than a flat decal. */
export function finGeometry(angle: number) {
  const values: number[] = [];
  for (const y of [-0.55, 0.55]) for (const [x, z] of [[5.8, 12], [14, 8], [5.8, 34]]) {
    values.push(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), z);
  }
  const positions = new Float64Array(values);
  const attributes = new GeometryAttributes();
  attributes.position = new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions });
  return GeometryPipeline.computeNormal(new Geometry({
    attributes,
    indices: new Uint16Array([0, 1, 2, 3, 5, 4, 0, 4, 1, 0, 3, 4, 1, 5, 2, 1, 4, 5, 2, 3, 0, 2, 5, 3]),
    primitiveType: PrimitiveType.TRIANGLES, boundingSphere: BoundingSphere.fromVertices(positions),
  }));
}

export interface SolidPart { geometry: Geometry | CylinderGeometry | BoxGeometry; offset: Cartesian3; color: Color }

/** Many coloured parts in one primitive (one draw call). Parts are baked in
 * world coordinates at `frame` (local east-north-up offsets): geometry left near
 * the Earth's centre cannot be projected for 2D/Columbus view. Move the whole
 * group afterwards with modelMatrix = pose × inverse(frame). */
export function solidPrimitive(parts: readonly SolidPart[], frame: Matrix4) {
  return new Primitive({
    geometryInstances: parts.map(part => new GeometryInstance({
      geometry: part.geometry, modelMatrix: Matrix4.multiplyByTranslation(frame, part.offset, new Matrix4()),
      attributes: { color: ColorGeometryInstanceAttribute.fromColor(part.color) },
    })),
    appearance: new PerInstanceColorAppearance({ closed: true, translucent: false }),
    asynchronous: false, allowPicking: false,
  });
}

export function exhaustPrimitive(material: Material, modelMatrix: Matrix4, length = 52, topRadius = 3.3) {
  return new Primitive({
    geometryInstances: new GeometryInstance({ geometry: new CylinderGeometry({ length, topRadius, bottomRadius: 0.05,
      slices: 32, vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat }) }),
    appearance: new MaterialAppearance({ material, flat: true, faceForward: true, translucent: true, closed: false }),
    asynchronous: false, modelMatrix, allowPicking: false,
  });
}
