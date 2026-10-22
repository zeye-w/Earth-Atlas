/** Print the per-frame timeline the post step needs (take, white/black fades), as JSON. */
import { FRAMES, frameTime, takeAt, whiteAt, blackAt } from "./story.mjs";

const frames = Array.from({ length: FRAMES }, (_, frame) => {
  const t = frameTime(frame);
  return { frame, t, take: takeAt(t).id, white: whiteAt(t), black: blackAt(t) };
});
process.stdout.write(JSON.stringify(frames));
