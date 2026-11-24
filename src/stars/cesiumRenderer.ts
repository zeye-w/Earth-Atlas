/**
 * Cesium's low-level renderer classes. The "cesium" package exports them (its
 * own sky box, sun and moon are built from them) but its type definitions
 * leave them out, so they are typed here only as far as src/stars/ uses them.
 */
// @ts-expect-error -- exported by Cesium, not in its type definitions
import { Buffer as CesiumBuffer, BufferUsage as CesiumBufferUsage, DrawCommand as CesiumDrawCommand, Pass as CesiumPass, RenderState as CesiumRenderState, ShaderProgram as CesiumShaderProgram, VertexArray as CesiumVertexArray } from "cesium";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Destroyable { destroy(): void; isDestroyed(): boolean }
export interface CesiumCommand { execute(context: unknown, passState: unknown): void }

export const Buffer = CesiumBuffer as { createVertexBuffer(options: { context: unknown; typedArray: Float32Array; usage: unknown }): Destroyable };
export const BufferUsage = CesiumBufferUsage as { STATIC_DRAW: unknown };
export const DrawCommand = CesiumDrawCommand as new (options: Record<string, unknown>) => CesiumCommand & Record<string, any>;
export const Pass = CesiumPass as { ENVIRONMENT: number };
export const RenderState = CesiumRenderState as { fromCache(options: Record<string, unknown>): unknown };
export const ShaderProgram = CesiumShaderProgram as {
  fromCache(options: { context: unknown; vertexShaderSource: string; fragmentShaderSource: string; attributeLocations: Record<string, number> }): Destroyable;
};
export const VertexArray = CesiumVertexArray as new (options: { context: unknown; attributes: Record<string, unknown>[] }) => Destroyable;
