import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Minimal Prometheus registry (no dependency). Label values come from code only: the HTTP route is
 * the Nest route template, never the raw URL, so no identifier can reach a label.
 * shortcut: process-wide singleton (several apps in one process share counters), fine for one instance per process.
 */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

type Labels = Record<string, string>;
const key = (labels: Labels): string => JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const fmt = (labels: Labels): string => {
  const e = Object.entries(labels);
  return e.length ? `{${e.map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}` : '';
};

const counters = new Map<string, { help: string; series: Map<string, { labels: Labels; value: number }> }>();
const histograms = new Map<string, { help: string; series: Map<string, { labels: Labels; counts: number[]; sum: number; count: number }> }>();
let socketConnections = 0;

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

export function incCounter(name: string, help: string, labels: Labels = {}, by = 1): void {
  let c = counters.get(name);
  if (!c) counters.set(name, (c = { help, series: new Map() }));
  const k = key(labels);
  const s = c.series.get(k);
  if (s) s.value += by;
  else c.series.set(k, { labels, value: by });
}

export function observeHistogram(name: string, help: string, labels: Labels, seconds: number): void {
  let h = histograms.get(name);
  if (!h) histograms.set(name, (h = { help, series: new Map() }));
  const k = key(labels);
  let s = h.series.get(k);
  if (!s) h.series.set(k, (s = { labels, counts: BUCKETS.map(() => 0), sum: 0, count: 0 }));
  BUCKETS.forEach((b, i) => {
    if (seconds <= b) s.counts[i]! += 1;
  });
  s.sum += seconds;
  s.count += 1;
}

export const trackSocket = (delta: 1 | -1): void => {
  socketConnections = Math.max(0, socketConnections + delta);
};
export const countMaintenanceRun = (result: 'success' | 'failure'): void =>
  incCounter('caselind_maintenance_runs_total', 'Maintenance runs by outcome.', { result });
export const countWebhookDelivery = (status: 'delivered' | 'retry' | 'failed'): void =>
  incCounter('caselind_webhook_deliveries_total', 'Webhook delivery attempts by outcome.', { status });
export const countPosOperation = (type: 'sale' | 'void' | 'shift_open'): void =>
  incCounter('caselind_pos_operations_total', 'Point-of-sale (cash register) operations.', { type });

/** Express middleware: counts and times every request once the response is finished. */
export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const template = req.route?.path ? `${req.baseUrl ?? ''}${String(req.route.path)}` : '';
    // Nest's catch-all 404 route is a wildcard: every unknown URL shares one label.
    const route = template && !template.includes('*') ? template : 'unmatched';
    const method = KNOWN_METHODS.has(req.method) ? req.method : 'OTHER';
    incCounter('http_requests_total', 'HTTP requests by method, route template and status class.', { method, route, status_class: `${Math.floor(res.statusCode / 100)}xx` });
    observeHistogram('http_request_duration_seconds', 'HTTP request duration in seconds.', { method, route }, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
}

export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

/** Prometheus text exposition (v0.0.4). */
export function renderMetrics(pool?: PoolStats): string {
  const out: string[] = [];
  const gauge = (name: string, help: string, value: number, type = 'gauge'): void => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${Number.isFinite(value) ? value : 0}`);
  };
  for (const [name, c] of counters) {
    out.push(`# HELP ${name} ${c.help}`, `# TYPE ${name} counter`);
    for (const s of c.series.values()) out.push(`${name}${fmt(s.labels)} ${s.value}`);
  }
  for (const [name, h] of histograms) {
    out.push(`# HELP ${name} ${h.help}`, `# TYPE ${name} histogram`);
    for (const s of h.series.values()) {
      BUCKETS.forEach((b, i) => out.push(`${name}_bucket${fmt({ ...s.labels, le: String(b) })} ${s.counts[i]}`));
      out.push(`${name}_bucket${fmt({ ...s.labels, le: '+Inf' })} ${s.count}`, `${name}_sum${fmt(s.labels)} ${s.sum}`, `${name}_count${fmt(s.labels)} ${s.count}`);
    }
  }
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  gauge('process_resident_memory_bytes', 'Resident memory size.', mem.rss);
  gauge('process_heap_used_bytes', 'V8 heap in use.', mem.heapUsed);
  gauge('process_cpu_seconds_total', 'User plus system CPU time.', (cpu.user + cpu.system) / 1e6, 'counter');
  gauge('process_uptime_seconds', 'Process uptime.', process.uptime());
  gauge('nodejs_eventloop_lag_mean_seconds', 'Mean event loop delay since the last scrape.', loop.mean / 1e9);
  gauge('nodejs_eventloop_lag_p99_seconds', 'p99 event loop delay since the last scrape.', loop.percentile(99) / 1e9);
  gauge('nodejs_eventloop_lag_max_seconds', 'Max event loop delay since the last scrape.', loop.max / 1e9);
  loop.reset();
  if (pool) {
    gauge('pg_pool_connections_total', 'PostgreSQL pool: open connections.', pool.totalCount);
    gauge('pg_pool_connections_idle', 'PostgreSQL pool: idle connections.', pool.idleCount);
    gauge('pg_pool_waiting_requests', 'PostgreSQL pool: queries waiting for a connection.', pool.waitingCount);
  }
  gauge('socketio_connections_active', 'Active Socket.IO connections.', socketConnections);
  return `${out.join('\n')}\n`;
}
