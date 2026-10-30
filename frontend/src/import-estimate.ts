/**
 * Hochrechnung für einen laufenden Import aus HelpSpot (Entscheid vom 30.10.2026): die restlichen Tickets im bisherigen
 * Tempo. Erst ab einigen übernommenen Tickets, vorher wäre sie zu ungenau.
 */
const MIN_PROCESSED = 10;

export function remainingMs(run: { startedAt: string; total: number; processed: number }, now = Date.now()): number | null {
  if (!run.total || run.processed < MIN_PROCESSED || run.processed >= run.total) return null;
  const elapsed = now - new Date(run.startedAt).getTime();
  if (elapsed <= 0) return null;
  return (elapsed / run.processed) * (run.total - run.processed);
}

/** Ungefähre Dauer, z.B. «etwa 25 Min.» oder «etwa 2 Std. 10 Min.» (ab einer Stunde auf 5 Minuten gerundet) */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'weniger als 1 Min.';
  if (minutes < 60) return `etwa ${minutes} Min.`;
  const rounded = Math.round(minutes / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `etwa ${hours} Std. ${rest} Min.` : `etwa ${hours} Std.`;
}
