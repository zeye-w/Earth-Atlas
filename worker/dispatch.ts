/**
 * GitHub's scheduled workflows run late or not at all when GitHub is busy
 * (the two-hourly launch calendar ran every 5-10 hours), and the flight
 * snapshot needs a run every 15 minutes. Cloudflare's cron is punctual, so a
 * cron trigger on this Worker (wrangler.jsonc, every 15 minutes) starts the
 * data workflows through the GitHub API instead; GitHub runs dispatched
 * workflows at once. Their own schedules remain as a fallback.
 *
 * Needs the GITHUB_DISPATCH_TOKEN secret: a fine-grained token for this one
 * repository with "Actions: read and write" only. Without it nothing is sent.
 */
export const REPOSITORY = "zeye-w/Earth-Atlas";

/** Which workflows are due at a cron tick (UTC; ticks fall on minutes 0, 15, 30 and 45). */
export function dueWorkflows(scheduledTime: number): string[] {
  const at = new Date(scheduledTime);
  const hour = at.getUTCHours(), minute = Math.round(at.getUTCMinutes() / 15) * 15 % 60;
  const due = ["flight-data.yml"];
  // Two-hourly jobs on different ticks, so they do not all start together.
  if (hour % 2 === 0 && minute === 45) due.push("launch-data.yml");
  if (hour % 2 === 1 && minute === 15) due.push("site-health.yml");
  // GFS weather after each model run, as weather-data.yml's own schedule.
  if ([4, 10, 16, 22].includes(hour) && minute === 15) due.push("weather-data.yml");
  return due;
}

export interface DispatchEnv { GITHUB_DISPATCH_TOKEN?: string }

/** Start one workflow on main; the result says what happened, for the log. */
export async function dispatchWorkflow(token: string, workflow: string, network: typeof fetch = fetch): Promise<string> {
  const response = await network(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json", "User-Agent": "TerraScope-scheduler (+https://github.com/" + REPOSITORY + ")",
    },
    body: JSON.stringify({ ref: "main" }),
    signal: AbortSignal.timeout(15_000),
  });
  // GitHub answers 204 No Content when the run is queued.
  if (response.status !== 204) throw new Error(workflow + ": HTTP " + response.status + " " + (await response.text()).slice(0, 160));
  return workflow + ": started";
}

/** The cron tick: dispatch what is due and log each outcome (never throws). */
export async function runSchedule(scheduledTime: number, env: DispatchEnv, network: typeof fetch = fetch): Promise<string[]> {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) {
    console.warn("Scheduler: GITHUB_DISPATCH_TOKEN is not set; relying on GitHub's own schedules.");
    return [];
  }
  const results = await Promise.allSettled(dueWorkflows(scheduledTime).map((workflow) => dispatchWorkflow(token, workflow, network)));
  const lines = results.map((r) => (r.status === "fulfilled" ? r.value : String(r.reason instanceof Error ? r.reason.message : r.reason)));
  for (const [i, line] of lines.entries()) (results[i].status === "fulfilled" ? console.log : console.warn)("Scheduler:", line);
  return lines;
}
