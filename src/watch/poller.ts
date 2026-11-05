// Timed fallback for missed watcher events (network drives, deep plugin folders, dropped events).
export class Poller {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(private readonly run: () => Promise<unknown>) {}

  /** seconds <= 0 stops polling. */
  start(seconds: number): void {
    this.stop();
    if (!(seconds > 0)) return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get active(): boolean {
    return this.timer !== undefined;
  }

  /** Skips a tick while the previous one is still running. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch {
      // A failed round is retried on the next tick.
    } finally {
      this.running = false;
    }
  }
}
