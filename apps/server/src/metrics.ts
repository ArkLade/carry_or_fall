/**
 * Server metrics (technical plan §32.2). Tracks the subset of that list this
 * milestone can actually produce — active rooms, average and maximum room tick
 * duration, event-loop lag, and process memory — and reports them periodically
 * as one structured log line.
 *
 * These are the numbers that answer "is the server still healthy after running
 * for a while", which §38 M8 makes a requirement rather than a nicety. They are
 * also what turns "a late test is mysteriously slower" into a measurement: a
 * tick duration or an event-loop lag that climbs across a session is a server
 * defect, and without this it is invisible.
 *
 * Deliberately dependency-free and cheap: two counters and a running maximum per
 * interval, reset when reported, so the cost does not grow with uptime.
 */
import type { Logger } from "./logger";

/** How often metrics are reported. Frequent enough to show a trend within one test session. */
export const DEFAULT_METRICS_INTERVAL_MS = 5_000;

/**
 * Accumulates tick timings between reports. One instance is shared by every
 * room, because the question is whether *the server* is keeping up, not whether
 * one room is.
 */
export class MatchMetrics {
  private ticks = 0;
  private totalMs = 0;
  private maxMs = 0;

  /** Record one completed simulation step. */
  recordTick(durationMs: number): void {
    this.ticks += 1;
    this.totalMs += durationMs;
    if (durationMs > this.maxMs) {
      this.maxMs = durationMs;
    }
  }

  /** Read the interval's totals and start a fresh one. */
  drain(): { readonly ticks: number; readonly averageMs: number; readonly maxMs: number } {
    const { ticks, totalMs, maxMs } = this;
    this.ticks = 0;
    this.totalMs = 0;
    this.maxMs = 0;
    return { ticks, averageMs: ticks === 0 ? 0 : totalMs / ticks, maxMs };
  }
}

/** The registry rooms report into. */
export const matchMetrics = new MatchMetrics();

export interface MetricsReporterDeps {
  readonly logger: Logger;
  /** How many rooms are currently alive. Supplied by the caller so this module needs no Colyseus import. */
  readonly getActiveRooms: () => number | Promise<number>;
  readonly intervalMs?: number;
}

/**
 * Start reporting metrics. Returns a stop function; the interval is `unref`'d so
 * it never by itself keeps the process alive.
 */
export function startMetricsReporter(deps: MetricsReporterDeps): () => void {
  const intervalMs = deps.intervalMs ?? DEFAULT_METRICS_INTERVAL_MS;
  let lastAt = performance.now();

  const timer = setInterval(() => {
    // Event-loop lag: how much later than scheduled this callback actually ran.
    // The most direct signal that something is monopolising the loop.
    const now = performance.now();
    const lagMs = Math.max(0, now - lastAt - intervalMs);
    lastAt = now;

    const { ticks, averageMs, maxMs } = matchMetrics.drain();

    void (async () => {
      const activeRooms = await deps.getActiveRooms();
      deps.logger.info("server metrics", {
        activeRooms,
        ticks,
        tickAverageMs: Number(averageMs.toFixed(3)),
        tickMaxMs: Number(maxMs.toFixed(3)),
        eventLoopLagMs: Number(lagMs.toFixed(1)),
        heapUsedMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)),
        rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      });
    })();
  }, intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
  };
}
