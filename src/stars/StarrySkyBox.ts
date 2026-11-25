import { SkyBox } from "cesium";
import type { CesiumCommand } from "./cesiumRenderer";
import type { StarField } from "./StarField";

type Sources = ConstructorParameters<typeof SkyBox>[0]["sources"];

/**
 * Cesium's sky box (the faces, without the bright stars) plus the bright
 * stars as points (StarField), standing in for `scene.skyBox`. The scene
 * draws the sky box's one command first in its environment pass, then the
 * atmosphere, the Sun and the Moon; this sky box returns a command that runs
 * the faces' command and then the stars', so the stars sit behind everything
 * else, exactly as if they were in the faces.
 */
export class StarrySkyBox {
  readonly faces: SkyBox;
  stars: StarField | null;
  show = true;
  private facesCommand: CesiumCommand | undefined;
  private starsCommand: CesiumCommand | undefined;
  private destroyed = false;
  // What Scene's executeCommand reads of a command before it calls execute().
  private readonly command = {
    derivedCommands: {},
    debugShowBoundingVolume: false,
    receiveShadows: false,
    execute: (context: unknown, passState: unknown) => {
      this.facesCommand?.execute(context, passState);
      this.starsCommand?.execute(context, passState);
    },
  };

  constructor(sources: Sources, stars: StarField | null) {
    this.faces = new SkyBox({ sources });
    this.stars = stars;
  }

  /** Called by the scene each frame, like SkyBox.update. */
  update(frameState: unknown, useHdr: boolean): unknown {
    if (!this.show || this.destroyed) return undefined;
    this.facesCommand = (this.faces as unknown as { update(f: unknown, h: boolean): CesiumCommand | undefined }).update(frameState, useHdr);
    // The stars only with the faces (the scene's 2D and Columbus views have no sky box).
    this.starsCommand = this.facesCommand && this.stars ? this.stars.update(frameState as { context: unknown }) : undefined;
    return this.facesCommand ? this.command : undefined;
  }

  isDestroyed(): boolean { return this.destroyed; }

  destroy(): undefined {
    if (!this.faces.isDestroyed()) this.faces.destroy();
    // The star field is shared between sky boxes (face sizes, constellation figures); its owner destroys it.
    this.destroyed = true;
    return undefined;
  }
}
