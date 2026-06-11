type WebHapticsModule = typeof import("npm:web-haptics@0.0.6");
type WebHapticsInstance = InstanceType<WebHapticsModule["WebHaptics"]>;

let hapticsPromise: Promise<WebHapticsInstance | null> | null = null;

function getHapticsPromise() {
  if (hapticsPromise) return hapticsPromise;

  hapticsPromise = import("npm:web-haptics@0.0.6")
    .then(({ WebHaptics }) => new WebHaptics())
    .catch(() => null);

  return hapticsPromise;
}

async function trigger(
  input: Parameters<WebHapticsInstance["trigger"]>[0],
  intensity?: number,
) {
  try {
    const haptics = await getHapticsPromise();
    if (!haptics) return;
    await haptics.trigger(
      input,
      intensity === undefined ? undefined : { intensity },
    );
  } catch {
    // Haptics are best-effort and should never interfere with gameplay.
  }
}

export function triggerLightTap() {
  void trigger(35, 0.45);
}

export function triggerShortBuzz() {
  void trigger(90, 0.65);
}

export function triggerStrongBuzz() {
  void trigger(220, 0.9);
}

export function triggerErrorBuzz() {
  void trigger([45, 35, 45], 0.75);
}
