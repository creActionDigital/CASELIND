import { Inject, Injectable } from '@nestjs/common';
import type { Call, CallList, CreateCallRequest, SignalRequest } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A call nobody answers within this delay is a missed call. */
const RING_SECONDS = 45;

type Row = { id: string; conversation_id: string; caller_id: string; callee_id: string; kind: 'audio' | 'video'; status: Call['status']; created_at: Date; answered_at: Date | null; ended_at: Date | null };
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const toCall = (r: Row): Call => ({
  id: r.id, conversationId: r.conversation_id, callerId: r.caller_id, calleeId: r.callee_id, kind: r.kind, status: r.status,
  createdAt: new Date(r.created_at).toISOString(), answeredAt: iso(r.answered_at), endedAt: iso(r.ended_at),
});

/**
 * 1:1 calls from a direct conversation. Signalling only: the offer/answer/ICE messages are relayed over realtime to the
 * other party and never stored; media is peer-to-peer and needs a STUN/TURN server (question Q6).
 */
@Injectable()
export class CallsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly privacy: PrivacyService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Ringing calls older than RING_SECONDS become missed (lazy: no timer to keep alive). */
  private async expireStale(userId: string): Promise<void> {
    await this.db.execute(sql`UPDATE calls SET status = 'missed', ended_at = now()
      WHERE status = 'ringing' AND created_at < now() - make_interval(secs => ${RING_SECONDS}) AND (caller_id = ${userId}::uuid OR callee_id = ${userId}::uuid)`);
  }

  async start(userId: string, conversationId: string, body: CreateCallRequest): Promise<Call> {
    if (!UUID_RE.test(conversationId)) throw AppError.notFound('Conversation not found');
    const { rows: members } = await this.db.execute<{ user_id: string; kind: string }>(sql`
      SELECT m.user_id, c.kind FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ${conversationId}::uuid AND m.status = 'active'`);
    if (!members.some((m) => m.user_id === userId)) throw AppError.notFound('Conversation not found');
    if (members[0]?.kind !== 'direct') throw AppError.conflict('Only a direct conversation can start a call', { reason: 'not_direct' });
    const peer = members.find((m) => m.user_id !== userId);
    if (!peer) throw AppError.forbidden('The other participant is no longer available');
    if (await this.privacy.isBlockedEitherWay(userId, peer.user_id)) throw AppError.forbidden('You cannot call this user');
    await this.expireStale(userId);
    await this.expireStale(peer.user_id);
    const busy = await this.db.execute(sql`SELECT 1 FROM calls WHERE status IN ('ringing', 'active')
      AND (caller_id IN (${userId}::uuid, ${peer.user_id}::uuid) OR callee_id IN (${userId}::uuid, ${peer.user_id}::uuid)) LIMIT 1`);
    if (busy.rows.length > 0) throw AppError.conflict('A call is already in progress', { reason: 'busy' });
    const { rows } = await this.db.execute<Row>(sql`INSERT INTO calls (conversation_id, caller_id, callee_id, kind)
      VALUES (${conversationId}::uuid, ${userId}::uuid, ${peer.user_id}::uuid, ${body.kind}) RETURNING *`);
    const call = toCall(rows[0]!);
    this.realtime.emitToUser(peer.user_id, 'call.ringing', call);
    return call;
  }

  private async load(userId: string, id: string): Promise<Row> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Call not found');
    const { rows } = await this.db.execute<Row>(sql`SELECT * FROM calls WHERE id = ${id}::uuid AND (caller_id = ${userId}::uuid OR callee_id = ${userId}::uuid)`);
    if (!rows[0]) throw AppError.notFound('Call not found');
    return rows[0];
  }

  private async finish(row: Row, status: Call['status'], answered = false): Promise<Call> {
    const { rows } = await this.db.execute<Row>(sql`UPDATE calls SET status = ${status}, ended_at = now(),
      answered_at = CASE WHEN ${answered} THEN now() ELSE answered_at END WHERE id = ${row.id}::uuid RETURNING *`);
    const call = toCall(rows[0]!);
    for (const u of [call.callerId, call.calleeId]) this.realtime.emitToUser(u, 'call.updated', call);
    return call;
  }

  async accept(userId: string, id: string): Promise<Call> {
    await this.expireStale(userId);
    const row = await this.load(userId, id);
    if (row.callee_id !== userId) throw AppError.forbidden('Only the callee can answer');
    if (row.status !== 'ringing') throw AppError.conflict('This call is no longer ringing', { reason: 'call_closed', status: row.status });
    const { rows } = await this.db.execute<Row>(sql`UPDATE calls SET status = 'active', answered_at = now() WHERE id = ${row.id}::uuid AND status = 'ringing' RETURNING *`);
    if (!rows[0]) throw AppError.conflict('This call is no longer ringing', { reason: 'call_closed' });
    const call = toCall(rows[0]);
    for (const u of [call.callerId, call.calleeId]) this.realtime.emitToUser(u, 'call.updated', call);
    return call;
  }

  async decline(userId: string, id: string): Promise<Call> {
    const row = await this.load(userId, id);
    if (row.callee_id !== userId) throw AppError.forbidden('Only the callee can decline');
    if (row.status !== 'ringing') throw AppError.conflict('This call is no longer ringing', { reason: 'call_closed', status: row.status });
    return this.finish(row, 'declined');
  }

  /** The caller hangs up a ringing call (cancelled) or either party ends an active call. */
  async end(userId: string, id: string): Promise<Call> {
    const row = await this.load(userId, id);
    if (row.status === 'active') return this.finish(row, 'ended');
    if (row.status === 'ringing' && row.caller_id === userId) return this.finish(row, 'cancelled');
    throw AppError.conflict('This call cannot be ended', { reason: 'call_closed', status: row.status });
  }

  async signal(userId: string, id: string, body: SignalRequest): Promise<void> {
    const row = await this.load(userId, id);
    if (row.status !== 'ringing' && row.status !== 'active') throw AppError.conflict('This call is over', { reason: 'call_closed', status: row.status });
    const other = row.caller_id === userId ? row.callee_id : row.caller_id;
    this.realtime.emitToUser(other, 'call.signal', { callId: row.id, from: userId, type: body.type, payload: body.payload });
  }

  async list(userId: string): Promise<CallList> {
    await this.expireStale(userId);
    const { rows } = await this.db.execute<Row>(sql`SELECT * FROM calls WHERE caller_id = ${userId}::uuid OR callee_id = ${userId}::uuid ORDER BY created_at DESC LIMIT 50`);
    return { items: rows.map(toCall) };
  }
}
