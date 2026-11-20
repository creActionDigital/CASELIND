export function percentile(values: number[], p: number): number;
export function summarize(
  latenciesMs: number[],
  failed: number,
  elapsedS: number,
): { count: number; failed: number; errorRate: number; rps: number; p50: number; p95: number; p99: number; max: number };
