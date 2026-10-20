/**
 * The bouncer operator flag controls availability, never a source-code switch.
 * Probe once without blocking gameplay. Failure, redirects and late responses
 * all preserve SoundCloud; this endpoint contains no secrets or media paths.
 */
export async function loadGameAudioConfig({
  fetchImpl = globalThis.fetch,
  timeoutMs = 1500,
  timers = globalThis,
} = {}) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        const response = await fetchImpl('/game-audio/v1/config', {
          method: 'GET',
          credentials: 'same-origin',
          mode: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) return false;
        const config = await response.json();
        return config?.enabled === true;
      }),
      new Promise((resolve) => {
        timer = timers.setTimeout(() => {
          controller.abort();
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    timers.clearTimeout(timer);
  }
}
