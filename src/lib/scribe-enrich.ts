import { isS3Configured, presignGetUrl } from "@/lib/s3";

/**
 * Enrich a recorded-SOP payload so the frontend can render screenshots
 * without caring where they live. For each step that has a
 * `screenshotKey` (uploaded to S3), we swap in a short-lived presigned
 * GET URL into the `screenshot` field. Legacy steps with inline base64
 * are passed through untouched.
 *
 * TTL is 1 hour — long enough for a user to flip through a full SOP,
 * short enough that a leaked SOP-detail response doesn't hand out
 * permanent access.
 */

const SCREENSHOT_TTL_SECONDS = 60 * 60;

interface LooseStep {
  screenshot?: string | null;
  screenshotKey?: string | null;
  [k: string]: unknown;
}

interface LooseSop {
  content?: {
    steps?: LooseStep[] | null;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
}

export async function enrichScribeScreenshots<T extends LooseSop>(sop: T): Promise<T> {
  const steps = sop?.content?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return sop;
  if (!isS3Configured()) return sop;

  // Parallelize — presigning is local (HMAC) with no DB / network hop,
  // so fan-out is essentially free.
  const enrichedSteps = await Promise.all(
    steps.map(async (step) => {
      if (!step?.screenshotKey || step?.screenshot) return step;
      try {
        const url = await presignGetUrl(step.screenshotKey, SCREENSHOT_TTL_SECONDS);
        return { ...step, screenshot: url };
      } catch {
        return step;
      }
    }),
  );

  return {
    ...sop,
    content: { ...sop.content, steps: enrichedSteps },
  };
}

/** Batch helper for list endpoints. */
export async function enrichScribeScreenshotsMany<T extends LooseSop>(sops: T[]): Promise<T[]> {
  if (!isS3Configured()) return sops;
  return Promise.all(sops.map((s) => enrichScribeScreenshots(s)));
}
