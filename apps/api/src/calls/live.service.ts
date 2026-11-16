import { Inject, Injectable } from '@nestjs/common';
import type { Live, LiveList, LiveMessage, LiveMessageList, SendLiveMessageRequest, SignalRequest, StartLiveRequest } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LiveRow = { id: string; host_id: string; handle: string; display_name: string; title: string; status: 'live' | 'ended'; viewers: string; peak_viewers: number; started_at: Date; ended_at: Date | null };
const toLive = (r: LiveRow): Live => ({
  id: r.id, hostId: r.host_id, hostHandle: r.handle, hostName: r.display_name, title: r.title, status: r.status,
  viewers: Number(r.viewers), peakViewers: r.peak_viewers, startedAt: new Date(r.started_at).toISOString(), endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
});

/** Blocked either way with the host: the live does not exist for the user. */
const notBlocked = (me: string) => sql`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = l.host_id AND b.blocked_id = ${me}::uuid) OR (b.blocker_id = ${me}::uuid AND b.blocked_id = l.host_id))`;

/**
 * Live rooms: a host starts a live, viewers join, chat and exchange WebRTC signalling with the host. Counters and chat are
 * stored; the signalling payload and the media are not (see CallsService).
 * shortcut: events fan out one user room per viewer (no dedicated room), fine up to a few hundred viewers; add a live room with the Redis adapter beyond.
 */
@Injectable()
export class LiveService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  private select(where: ReturnType<typeof sql>) {
    return sql`SELECT l.id, l.host_id, u.handle, u.display_name, l.title, l.status, l.peak_viewers, l.started_at, l.ended_at,
      (SELECT count(*) FROM live_viewers v WHERE v.live_id = l.id AND v.left_at IS NULL) AS viewers
      FROM lives l JOIN users u ON u.id = l.host_id WHERE ${where}`;
  }

  private async one(userId: string, id: string): Promise<Live> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Live not found');
    const { rows } = await this.db.execute<LiveRow>(this.select(sql`l.id = ${id}::uuid AND ${notBlocked(userId)}`));
    if (!rows[0]) throw AppError.notFound('Live not found');
    return toLive(rows[0]);
  }

  async start(userId: string, body: StartLiveRequest): Promise<Live> {
    try {
      const { rows } = await this.db.execute<{ id: string }>(sql`INSERT INTO lives (host_id, title) VALUES (${userId}::uuid, ${body.title}) RETURNING id`);
      return this.one(userId, rows[0]!.id);
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } });
      if (code.code === '23505' || code.cause?.code === '23505') throw AppError.conflict('You are already live', { reason: 'already_live' });
      throw e;
    }
  }

  async list(userId: string): Promise<LiveList> {
    const { rows } = await this.db.execute<LiveRow>(sql`${this.select(sql`l.status = 'live' AND ${notBlocked(userId)}`)} ORDER BY l.started_at DESC LIMIT 50`);
    return { items: rows.map(toLive) };
  }

  get(userId: string, id: string): Promise<Live> {
    return this.one(userId, id);
  }

  private async viewerIds(liveId: string): Promise<string[]> {
    const { rows } = await this.db.execute<{ user_id: string }>(sql`SELECT user_id FROM live_viewers WHERE live_id = ${liveId}::uuid AND left_at IS NULL`);
    return rows.map((r) => r.user_id);
  }

  private async openLive(userId: string, id: string): Promise<Live> {
    const live = await this.one(userId, id);
    if (live.status !== 'live') throw AppError.conflict('This live has ended', { reason: 'live_ended' });
    return live;
  }

  async join(userId: string, id: string): Promise<Live> {
    const live = await this.openLive(userId, id);
    if (live.hostId === userId) return live;
    await this.db.execute(sql`INSERT INTO live_viewers (live_id, user_id) VALUES (${id}::uuid, ${userId}::uuid)
      ON CONFLICT (live_id, user_id) DO UPDATE SET left_at = NULL, joined_at = now()`);
    await this.db.execute(sql`UPDATE lives SET peak_viewers = GREATEST(peak_viewers, (SELECT count(*) FROM live_viewers WHERE live_id = ${id}::uuid AND left_at IS NULL)) WHERE id = ${id}::uuid`);
    const fresh = await this.one(userId, id);
    this.realtime.emitToUser(live.hostId, 'live.viewers', { liveId: id, viewers: fresh.viewers });
    return fresh;
  }

  async leave(userId: string, id: string): Promise<void> {
    const live = await this.one(userId, id);
    await this.db.execute(sql`UPDATE live_viewers SET left_at = now() WHERE live_id = ${id}::uuid AND user_id = ${userId}::uuid AND left_at IS NULL`);
    const fresh = await this.one(userId, id);
    this.realtime.emitToUser(live.hostId, 'live.viewers', { liveId: id, viewers: fresh.viewers });
  }

  async end(userId: string, id: string): Promise<Live> {
    const live = await this.one(userId, id);
    if (live.hostId !== userId) throw AppError.forbidden('Only the host can end the live');
    if (live.status === 'ended') return live;
    const viewers = await this.viewerIds(id);
    await this.db.execute(sql`UPDATE live_viewers SET left_at = now() WHERE live_id = ${id}::uuid AND left_at IS NULL`);
    await this.db.execute(sql`UPDATE lives SET status = 'ended', ended_at = now() WHERE id = ${id}::uuid`);
    const ended = await this.one(userId, id);
    for (const u of viewers) this.realtime.emitToUser(u, 'live.ended', { liveId: id });
    return ended;
  }

  /** The host or a current viewer. */
  private async participant(userId: string, id: string): Promise<{ live: Live; viewers: string[] }> {
    const live = await this.openLive(userId, id);
    const viewers = await this.viewerIds(id);
    if (live.hostId !== userId && !viewers.includes(userId)) throw AppError.conflict('Join the live first', { reason: 'not_in_live' });
    return { live, viewers };
  }

  async sendMessage(userId: string, id: string, body: SendLiveMessageRequest): Promise<LiveMessage> {
    const { live, viewers } = await this.participant(userId, id);
    const { rows } = await this.db.execute<{ id: string; created_at: Date; handle: string }>(sql`
      WITH m AS (INSERT INTO live_messages (live_id, user_id, body) VALUES (${id}::uuid, ${userId}::uuid, ${body.body}) RETURNING id, created_at)
      SELECT m.id, m.created_at, (SELECT handle FROM users WHERE id = ${userId}::uuid) AS handle FROM m`);
    const msg: LiveMessage = { id: rows[0]!.id, userId, handle: rows[0]!.handle, body: body.body, createdAt: new Date(rows[0]!.created_at).toISOString() };
    for (const u of new Set([live.hostId, ...viewers])) this.realtime.emitToUser(u, 'live.message', { liveId: id, ...msg });
    return msg;
  }

  async messages(userId: string, id: string): Promise<LiveMessageList> {
    await this.participant(userId, id);
    const { rows } = await this.db.execute<{ id: string; user_id: string; handle: string; body: string; created_at: Date }>(sql`
      SELECT m.id, m.user_id, u.handle, m.body, m.created_at FROM live_messages m JOIN users u ON u.id = m.user_id
      WHERE m.live_id = ${id}::uuid ORDER BY m.created_at DESC LIMIT 100`);
    return { items: rows.reverse().map((r) => ({ id: r.id, userId: r.user_id, handle: r.handle, body: r.body, createdAt: new Date(r.created_at).toISOString() })) };
  }

  /** Host → one viewer (`to` required), viewer → host. */
  async signal(userId: string, id: string, body: SignalRequest): Promise<void> {
    const { live, viewers } = await this.participant(userId, id);
    let target = live.hostId;
    if (live.hostId === userId) {
      if (!body.to || !viewers.includes(body.to)) throw AppError.notFound('Viewer not found');
      target = body.to;
    }
    this.realtime.emitToUser(target, 'live.signal', { liveId: id, from: userId, type: body.type, payload: body.payload });
  }
}
