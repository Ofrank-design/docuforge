/** Resolves when the process is asked to stop (Ctrl+C / SIGTERM) or when `signal` aborts (used by tests). */
export function waitForShutdown(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = (): void => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
    signal?.addEventListener("abort", done, { once: true });
  });
}
