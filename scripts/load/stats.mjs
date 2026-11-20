/** Nearest-rank percentile (p in 0..100) of a list of numbers; NaN for an empty list. */
export function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

/** Latency summary in milliseconds plus error rate and throughput. */
export function summarize(latenciesMs, failed, elapsedS) {
  const n = latenciesMs.length;
  return {
    count: n,
    failed,
    errorRate: n === 0 ? 0 : failed / n,
    rps: elapsedS > 0 ? n / elapsedS : 0,
    p50: percentile(latenciesMs, 50),
    p95: percentile(latenciesMs, 95),
    p99: percentile(latenciesMs, 99),
    max: n === 0 ? NaN : latenciesMs.reduce((a, b) => (b > a ? b : a), -Infinity),
  };
}
