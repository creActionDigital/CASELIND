import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ErrorCodes,
  type AcceptProposalRequest,
  type AdminDispute,
  type AdminDisputeList,
  type AdminDisputesQuery,
  type Contract,
  type ContractList,
  type CreateMissionRequest,
  type CreateProposalRequest,
  type Mission,
  type MissionList,
  type MissionListQuery,
  type OpenDisputeRequest,
  type Proposal,
  type ProposalList,
  type ResolveDisputeRequest,
  type ReviewContractRequest,
  type UpdateMissionRequest,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// shortcut: fixed cap per client against mission flooding, make it an env setting when operations need to tune it.
const MAX_OPEN_MISSIONS = 10;
const missionNotFound = () => AppError.notFound('Mission not found');
const contractNotFound = () => AppError.notFound('Contract not found');
const invalid = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
const iso = (d: Date | string) => new Date(d).toISOString();

type Tx = Pick<Db, 'execute'>;

const encodeCursor = (at: Date, id: string) => Buffer.from(JSON.stringify([iso(at), id])).toString('base64url');
function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && !Number.isNaN(Date.parse(v[0])) && typeof v[1] === 'string' && UUID_RE.test(v[1])) return { at: v[0], id: v[1] };
  } catch {
    // fall through
  }
  throw invalid('cursor', 'invalid cursor');
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const cursorFilter = (col: string, cursor: string | undefined): SQL[] => {
  if (!cursor) return [];
  const c = decodeCursor(cursor);
  return [sql`(${sql.raw(col)}.created_at, ${sql.raw(col)}.id) < (${c.at}::timestamptz, ${c.id}::uuid)`];
};

type MissionRow = {
  id: string;
  title: string;
  description: string;
  budget_minor: string;
  currency: string;
  deadline: string | Date | null;
  status: Mission['status'];
  created_at: Date;
  client_id: string;
  client_name: string;
  client_handle: string;
  proposal_count: number | null;
  my_proposal_id: string | null;
  contract_id: string | null;
};

/** Not blocked either way between the viewer and the mission's client. */
const unblockedSql = (viewerId: string): SQL => sql`NOT EXISTS (
  SELECT 1 FROM user_blocks b
  WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = m.client_id) OR (b.blocker_id = m.client_id AND b.blocked_id = ${viewerId}::uuid))`;

/** Who can see a mission: its client, anyone who made a proposal on it, or, while it is open and not hidden, anyone not blocked. */
const visibleSql = (viewerId: string): SQL => sql`(
  m.client_id = ${viewerId}::uuid
  OR EXISTS (SELECT 1 FROM mission_proposals p WHERE p.mission_id = m.id AND p.freelancer_id = ${viewerId}::uuid)
  OR (m.status = 'open' AND NOT m.hidden AND ${unblockedSql(viewerId)}))`;

const toMission = (r: MissionRow, viewerId: string): Mission => ({
  id: r.id,
  title: r.title,
  description: r.description,
  budgetMinor: Number(r.budget_minor),
  currency: r.currency.trim(),
  deadline: r.deadline ? iso(r.deadline).slice(0, 10) : null,
  status: r.status,
  client: { id: r.client_id, displayName: r.client_name, handle: r.client_handle },
  mine: r.client_id === viewerId,
  proposalCount: r.proposal_count,
  myProposalId: r.my_proposal_id,
  contractId: r.contract_id,
  createdAt: iso(r.created_at),
});

/** Freelance: missions, proposals, contracts with milestones, reviews and disputes. Payments are external (no money moves here). */
@Injectable()
export class FreelanceService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly moderation: ModerationRegistry,
  ) {}

  onModuleInit(): void {
    this.moderation.register('mission', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const res = await this.db.execute(sql`SELECT 1 FROM missions m WHERE m.id = ${id}::uuid AND ${visibleSql(viewerId)}`);
        return res.rows.length > 0;
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const res = await this.db.execute<{ client_id: string }>(sql`SELECT client_id FROM missions WHERE id = ${id}::uuid`);
        return res.rows[0]?.client_id ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.execute(sql`UPDATE missions SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
  }

  // ---- Missions ---------------------------------------------------------------------------------

  async createMission(userId: string, body: CreateMissionRequest, meta: RequestMeta): Promise<Mission> {
    this.assertCurrency(body.currency);
    if (body.deadline) this.assertDeadline(body.deadline);
    const id = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM missions WHERE client_id = ${userId}::uuid AND status = 'open'`);
      if ((n.rows[0]?.n ?? 0) >= MAX_OPEN_MISSIONS) throw AppError.conflict(`At most ${MAX_OPEN_MISSIONS} open missions`, { reason: 'mission_limit', max: MAX_OPEN_MISSIONS });
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO missions (client_id, title, description, budget_minor, currency, deadline)
        VALUES (${userId}::uuid, ${body.title}, ${body.description}, ${body.budgetMinor}, ${body.currency}, ${body.deadline}::date) RETURNING id`);
      const missionId = res.rows[0]!.id;
      await this.audit.record({ action: 'freelance.mission_created', actorUserId: userId, meta, metadata: { missionId } }, tx);
      return missionId;
    });
    return this.getMission(userId, id);
  }

  async updateMission(userId: string, id: string, body: UpdateMissionRequest, meta: RequestMeta): Promise<Mission> {
    const cur = await this.getMission(userId, id);
    if (!cur.mine) throw missionNotFound();
    if (cur.status !== 'open') throw AppError.conflict('Only an open mission can be edited', { reason: 'mission_not_open' });
    const deadline = body.deadline !== undefined ? body.deadline : cur.deadline;
    if (body.deadline) this.assertDeadline(body.deadline);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE missions SET title = ${body.title ?? cur.title}, description = ${body.description ?? cur.description},
          budget_minor = ${body.budgetMinor ?? cur.budgetMinor}, deadline = ${deadline}::date, updated_at = now() WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'freelance.mission_updated', actorUserId: userId, meta, metadata: { missionId: id } }, tx);
    });
    return this.getMission(userId, id);
  }

  /** The client stops taking proposals; pending proposals are rejected. Idempotent. */
  async closeMission(userId: string, id: string, meta: RequestMeta): Promise<Mission> {
    const cur = await this.getMission(userId, id);
    if (!cur.mine) throw missionNotFound();
    if (cur.status === 'awarded') throw AppError.conflict('The mission is awarded', { reason: 'mission_awarded' });
    if (cur.status === 'open') {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE missions SET status = 'closed', updated_at = now() WHERE id = ${id}::uuid`);
        await tx.execute(sql`UPDATE mission_proposals SET status = 'rejected', updated_at = now() WHERE mission_id = ${id}::uuid AND status = 'proposed'`);
        await this.audit.record({ action: 'freelance.mission_closed', actorUserId: userId, meta, metadata: { missionId: id } }, tx);
      });
    }
    return this.getMission(userId, id);
  }

  async getMission(viewerId: string, id: string): Promise<Mission> {
    if (!UUID_RE.test(id)) throw missionNotFound();
    const res = await this.db.execute<MissionRow>(sql`${this.missionBase(viewerId)} WHERE m.id = ${id}::uuid AND ${visibleSql(viewerId)}`);
    if (!res.rows[0]) throw missionNotFound();
    return toMission(res.rows[0], viewerId);
  }

  async listMissions(viewerId: string, q: MissionListQuery): Promise<MissionList> {
    const f: SQL[] = [sql`m.status = 'open'`, sql`NOT m.hidden`, unblockedSql(viewerId), ...cursorFilter('m', q.cursor)];
    if (q.currency) f.push(sql`m.currency = ${q.currency}`);
    if (q.minBudgetMinor !== undefined) f.push(sql`m.budget_minor >= ${q.minBudgetMinor}`);
    if (q.maxBudgetMinor !== undefined) f.push(sql`m.budget_minor <= ${q.maxBudgetMinor}`);
    if (q.q) f.push(sql`(m.title ILIKE ${'%' + escapeLike(q.q) + '%'} OR m.description ILIKE ${'%' + escapeLike(q.q) + '%'})`);
    return this.missionPage(viewerId, f, q.limit);
  }

  async myMissions(userId: string, q: { limit: number; cursor?: string }): Promise<MissionList> {
    return this.missionPage(userId, [sql`m.client_id = ${userId}::uuid`, ...cursorFilter('m', q.cursor)], q.limit);
  }

  private async missionPage(viewerId: string, filters: SQL[], limit: number): Promise<MissionList> {
    const res = await this.db.execute<MissionRow>(sql`${this.missionBase(viewerId)} WHERE ${sql.join(filters, sql` AND `)} ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit + 1}`);
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => toMission(r, viewerId)), nextCursor: res.rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null };
  }

  private missionBase(viewerId: string): SQL {
    return sql`
      SELECT m.id, m.title, m.description, m.budget_minor, m.currency, m.deadline, m.status, m.created_at,
        u.id AS client_id, u.display_name AS client_name, u.handle::text AS client_handle,
        CASE WHEN m.client_id = ${viewerId}::uuid THEN (SELECT count(*)::int FROM mission_proposals p WHERE p.mission_id = m.id AND p.status <> 'withdrawn') END AS proposal_count,
        (SELECT p.id FROM mission_proposals p WHERE p.mission_id = m.id AND p.freelancer_id = ${viewerId}::uuid) AS my_proposal_id,
        (SELECT c.id FROM freelance_contracts c WHERE c.mission_id = m.id AND (c.client_id = ${viewerId}::uuid OR c.freelancer_id = ${viewerId}::uuid)) AS contract_id
      FROM missions m JOIN users u ON u.id = m.client_id`;
  }

  // ---- Proposals --------------------------------------------------------------------------------

  async propose(userId: string, missionId: string, body: CreateProposalRequest, meta: RequestMeta): Promise<Proposal> {
    const mission = await this.getMission(userId, missionId);
    if (mission.mine) throw AppError.forbidden('You cannot propose on your own mission');
    if (mission.status !== 'open') throw AppError.conflict('This mission no longer takes proposals', { reason: 'mission_not_open' });
    const id = await this.db.transaction(async (tx) => {
      const cur = await tx.execute<{ id: string; status: string }>(sql`SELECT id, status FROM mission_proposals WHERE mission_id = ${missionId}::uuid AND freelancer_id = ${userId}::uuid FOR UPDATE`);
      const existing = cur.rows[0];
      if (existing && existing.status !== 'withdrawn') throw AppError.conflict('You already made a proposal', { reason: 'already_proposed' });
      let proposalId: string;
      if (existing) {
        proposalId = existing.id;
        await tx.execute(sql`UPDATE mission_proposals SET amount_minor = ${body.amountMinor}, delivery_days = ${body.deliveryDays}, message = ${body.message}, status = 'proposed', updated_at = now() WHERE id = ${proposalId}::uuid`);
      } else {
        const ins = await tx.execute<{ id: string }>(sql`
          INSERT INTO mission_proposals (mission_id, freelancer_id, amount_minor, delivery_days, message)
          VALUES (${missionId}::uuid, ${userId}::uuid, ${body.amountMinor}, ${body.deliveryDays}, ${body.message}) RETURNING id`);
        proposalId = ins.rows[0]!.id;
      }
      await this.audit.record({ action: 'freelance.proposal_sent', actorUserId: userId, meta, metadata: { missionId, proposalId } }, tx);
      return proposalId;
    });
    await this.notifications.notify({ userId: mission.client.id, category: 'job', title: mission.title, body: 'Nouvelle proposition reçue.', data: { missionId } });
    return (await this.proposalById(id))!;
  }

  /** Client only: the proposals of a mission (withdrawn ones are left out). */
  async missionProposals(userId: string, missionId: string, q: { limit: number; cursor?: string }): Promise<ProposalList> {
    const mission = await this.getMission(userId, missionId);
    if (!mission.mine) throw missionNotFound();
    return this.proposalPage([sql`p.mission_id = ${missionId}::uuid`, sql`p.status <> 'withdrawn'`, ...cursorFilter('p', q.cursor)], q.limit);
  }

  async myProposals(userId: string, q: { limit: number; cursor?: string }): Promise<ProposalList> {
    return this.proposalPage([sql`p.freelancer_id = ${userId}::uuid`, ...cursorFilter('p', q.cursor)], q.limit);
  }

  async withdrawProposal(userId: string, proposalId: string, meta: RequestMeta): Promise<Proposal> {
    if (!UUID_RE.test(proposalId)) throw AppError.notFound('Proposal not found');
    await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ status: string }>(sql`SELECT status FROM mission_proposals WHERE id = ${proposalId}::uuid AND freelancer_id = ${userId}::uuid FOR UPDATE`);
      const cur = res.rows[0];
      if (!cur) throw AppError.notFound('Proposal not found');
      if (cur.status === 'withdrawn') return;
      if (cur.status !== 'proposed') throw AppError.conflict('This proposal is already decided', { reason: 'proposal_final' });
      await tx.execute(sql`UPDATE mission_proposals SET status = 'withdrawn', updated_at = now() WHERE id = ${proposalId}::uuid`);
      await this.audit.record({ action: 'freelance.proposal_withdrawn', actorUserId: userId, meta, metadata: { proposalId } }, tx);
    });
    return (await this.proposalById(proposalId))!;
  }

  /** The client accepts one proposal: the contract opens with its milestones, the others are rejected. */
  async acceptProposal(userId: string, proposalId: string, body: AcceptProposalRequest, meta: RequestMeta): Promise<Contract> {
    if (!UUID_RE.test(proposalId)) throw AppError.notFound('Proposal not found');
    const { contractId, freelancerId, title, rejected } = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ mission_id: string; freelancer_id: string; amount_minor: string; currency: string; status: string; m_status: string; title: string }>(sql`
        SELECT p.mission_id, p.freelancer_id, p.amount_minor, m.currency, p.status, m.status AS m_status, m.title
        FROM mission_proposals p JOIN missions m ON m.id = p.mission_id
        WHERE p.id = ${proposalId}::uuid AND m.client_id = ${userId}::uuid FOR UPDATE OF p, m`);
      const p = res.rows[0];
      if (!p) throw AppError.notFound('Proposal not found');
      if (p.status !== 'proposed' || p.m_status !== 'open') throw AppError.conflict('This proposal can no longer be accepted', { reason: 'proposal_not_open' });
      const amount = Number(p.amount_minor);
      const milestones = body.milestones ?? [{ title: 'Livraison', amountMinor: amount }];
      if (milestones.reduce((s, m) => s + m.amountMinor, 0) !== amount) throw invalid('milestones', 'milestones must add up to the proposed amount');
      const c = await tx.execute<{ id: string }>(sql`
        INSERT INTO freelance_contracts (mission_id, client_id, freelancer_id, amount_minor, currency)
        VALUES (${p.mission_id}::uuid, ${userId}::uuid, ${p.freelancer_id}::uuid, ${amount}, ${p.currency}) RETURNING id`);
      const cid = c.rows[0]!.id;
      for (const [position, m] of milestones.entries()) {
        await tx.execute(sql`INSERT INTO contract_milestones (contract_id, position, title, amount_minor) VALUES (${cid}::uuid, ${position}, ${m.title}, ${m.amountMinor})`);
      }
      await tx.execute(sql`UPDATE mission_proposals SET status = 'accepted', updated_at = now() WHERE id = ${proposalId}::uuid`);
      const others = await tx.execute<{ freelancer_id: string }>(sql`
        UPDATE mission_proposals SET status = 'rejected', updated_at = now() WHERE mission_id = ${p.mission_id}::uuid AND status = 'proposed' RETURNING freelancer_id`);
      await tx.execute(sql`UPDATE missions SET status = 'awarded', updated_at = now() WHERE id = ${p.mission_id}::uuid`);
      await this.audit.record({ action: 'freelance.proposal_accepted', actorUserId: userId, meta, metadata: { missionId: p.mission_id, proposalId, contractId: cid } }, tx);
      return { contractId: cid, freelancerId: p.freelancer_id, title: p.title, rejected: others.rows.map((r) => r.freelancer_id) };
    });
    await this.notifications.notify({ userId: freelancerId, category: 'job', title, body: 'Votre proposition est acceptée : le contrat est ouvert.', data: { contractId } });
    await this.notifications.notifyMany(rejected.map((u) => ({ userId: u, category: 'job' as const, title, body: 'Une autre proposition a été retenue.', data: {} })));
    return this.getContract(userId, contractId);
  }

  private async proposalById(id: string): Promise<Proposal | undefined> {
    return (await this.proposalPage([sql`p.id = ${id}::uuid`], 1)).items[0];
  }

  private async proposalPage(filters: SQL[], limit: number): Promise<ProposalList> {
    const res = await this.db.execute<{ id: string; mission_id: string; title: string; amount_minor: string; currency: string; delivery_days: number; message: string; status: Proposal['status']; created_at: Date; user_id: string; display_name: string; handle: string }>(sql`
      SELECT p.id, p.mission_id, m.title, p.amount_minor, m.currency, p.delivery_days, p.message, p.status, p.created_at,
        u.id AS user_id, u.display_name, u.handle::text AS handle
      FROM mission_proposals p JOIN missions m ON m.id = p.mission_id JOIN users u ON u.id = p.freelancer_id
      WHERE ${sql.join(filters, sql` AND `)} ORDER BY p.created_at DESC, p.id DESC LIMIT ${limit + 1}`);
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({
        id: r.id,
        missionId: r.mission_id,
        missionTitle: r.title,
        amountMinor: Number(r.amount_minor),
        currency: r.currency.trim(),
        deliveryDays: r.delivery_days,
        message: r.message,
        status: r.status,
        freelancer: { id: r.user_id, displayName: r.display_name, handle: r.handle },
        createdAt: iso(r.created_at),
      })),
      nextCursor: res.rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  // ---- Contracts --------------------------------------------------------------------------------

  async myContracts(userId: string, q: { limit: number; cursor?: string }): Promise<ContractList> {
    const res = await this.db.execute<{ id: string; created_at: Date }>(sql`
      SELECT c.id, c.created_at FROM freelance_contracts c
      WHERE (c.client_id = ${userId}::uuid OR c.freelancer_id = ${userId}::uuid) ${q.cursor ? sql`AND (c.created_at, c.id) < (${decodeCursor(q.cursor).at}::timestamptz, ${decodeCursor(q.cursor).id}::uuid)` : sql``}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    const items = await Promise.all(rows.map((r) => this.getContract(userId, r.id)));
    return { items, nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.created_at, last.id) : null };
  }

  async getContract(userId: string, id: string): Promise<Contract> {
    if (!UUID_RE.test(id)) throw contractNotFound();
    const res = await this.db.execute<{
      id: string; mission_id: string; title: string; amount_minor: string; currency: string; payment_mode: 'external'; status: Contract['status']; created_at: Date;
      client_id: string; client_name: string; client_handle: string; fl_id: string; fl_name: string; fl_handle: string;
    }>(sql`
      SELECT c.id, c.mission_id, m.title, c.amount_minor, c.currency, c.payment_mode, c.status, c.created_at,
        cu.id AS client_id, cu.display_name AS client_name, cu.handle::text AS client_handle,
        fu.id AS fl_id, fu.display_name AS fl_name, fu.handle::text AS fl_handle
      FROM freelance_contracts c JOIN missions m ON m.id = c.mission_id JOIN users cu ON cu.id = c.client_id JOIN users fu ON fu.id = c.freelancer_id
      WHERE c.id = ${id}::uuid AND (c.client_id = ${userId}::uuid OR c.freelancer_id = ${userId}::uuid)`);
    const c = res.rows[0];
    if (!c) throw contractNotFound();
    const [ms, reviews, dispute] = await Promise.all([
      this.db.execute<{ id: string; position: number; title: string; amount_minor: string; status: Contract['milestones'][number]['status']; note: string }>(sql`
        SELECT id, position, title, amount_minor, status, note FROM contract_milestones WHERE contract_id = ${id}::uuid ORDER BY position`),
      this.db.execute<{ reviewer_id: string; rating: number; body: string }>(sql`SELECT reviewer_id, rating, body FROM freelance_reviews WHERE contract_id = ${id}::uuid`),
      this.db.execute<{ id: string; status: 'open' | 'resolved'; reason: string; outcome: 'resume' | 'cancel' | null; resolution: string }>(sql`
        SELECT id, status, reason, outcome, resolution FROM contract_disputes WHERE contract_id = ${id}::uuid ORDER BY created_at DESC LIMIT 1`),
    ]);
    const mine = reviews.rows.find((r) => r.reviewer_id === userId);
    const theirs = reviews.rows.find((r) => r.reviewer_id !== userId);
    return {
      id: c.id,
      missionId: c.mission_id,
      missionTitle: c.title,
      amountMinor: Number(c.amount_minor),
      currency: c.currency.trim(),
      paymentMode: c.payment_mode,
      status: c.status,
      client: { id: c.client_id, displayName: c.client_name, handle: c.client_handle },
      freelancer: { id: c.fl_id, displayName: c.fl_name, handle: c.fl_handle },
      role: c.client_id === userId ? 'client' : 'freelancer',
      milestones: ms.rows.map((m) => ({ id: m.id, position: m.position, title: m.title, amountMinor: Number(m.amount_minor), status: m.status, note: m.note })),
      myReview: mine ? { rating: mine.rating, body: mine.body } : null,
      theirReview: theirs ? { rating: theirs.rating, body: theirs.body } : null,
      dispute: dispute.rows[0] ?? null,
      createdAt: iso(c.created_at),
    };
  }

  /** Freelancer hands in a milestone (first delivery or after a revision request). */
  async deliver(userId: string, contractId: string, milestoneId: string, note: string, meta: RequestMeta): Promise<Contract> {
    await this.moveMilestone(userId, 'freelancer', contractId, milestoneId, ['pending', 'revision'], 'delivered', note, 'freelance.milestone_delivered', meta, 'Un jalon a été livré.');
    return this.getContract(userId, contractId);
  }

  /** Client approves a delivered milestone; the last approval completes the contract. */
  async approve(userId: string, contractId: string, milestoneId: string, meta: RequestMeta): Promise<Contract> {
    await this.moveMilestone(userId, 'client', contractId, milestoneId, ['delivered'], 'approved', null, 'freelance.milestone_approved', meta, 'Un jalon a été approuvé.');
    await this.db.transaction(async (tx) => {
      const left = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM contract_milestones WHERE contract_id = ${contractId}::uuid AND status <> 'approved'`);
      if ((left.rows[0]?.n ?? 1) === 0) {
        const done = await tx.execute(sql`UPDATE freelance_contracts SET status = 'completed', updated_at = now() WHERE id = ${contractId}::uuid AND status = 'active'`);
        if ((done.rowCount ?? 0) > 0) await this.audit.record({ action: 'freelance.contract_completed', actorUserId: userId, meta, metadata: { contractId } }, tx);
      }
    });
    return this.getContract(userId, contractId);
  }

  /** Client asks for changes on a delivered milestone. */
  async requestRevision(userId: string, contractId: string, milestoneId: string, note: string, meta: RequestMeta): Promise<Contract> {
    await this.moveMilestone(userId, 'client', contractId, milestoneId, ['delivered'], 'revision', note, 'freelance.milestone_revision', meta, 'Le client demande une révision.');
    return this.getContract(userId, contractId);
  }

  private async moveMilestone(
    userId: string,
    side: 'client' | 'freelancer',
    contractId: string,
    milestoneId: string,
    from: string[],
    to: string,
    note: string | null,
    action: 'freelance.milestone_delivered' | 'freelance.milestone_approved' | 'freelance.milestone_revision',
    meta: RequestMeta,
    notice: string,
  ): Promise<void> {
    if (!UUID_RE.test(contractId) || !UUID_RE.test(milestoneId)) throw contractNotFound();
    const other = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ client_id: string; freelancer_id: string; status: string; m_status: string; title: string }>(sql`
        SELECT c.client_id, c.freelancer_id, c.status, ms.status AS m_status, mi.title
        FROM freelance_contracts c JOIN contract_milestones ms ON ms.contract_id = c.id JOIN missions mi ON mi.id = c.mission_id
        WHERE c.id = ${contractId}::uuid AND ms.id = ${milestoneId}::uuid FOR UPDATE OF c, ms`);
      const row = res.rows[0];
      const mine = row && (side === 'client' ? row.client_id : row.freelancer_id) === userId;
      if (!row || !mine) throw contractNotFound();
      if (row.status !== 'active') throw AppError.conflict(`The contract is ${row.status}`, { reason: 'contract_not_active', status: row.status });
      if (!from.includes(row.m_status)) throw AppError.conflict(`A ${row.m_status} milestone cannot become ${to}`, { reason: 'invalid_transition', from: row.m_status, to });
      await tx.execute(sql`UPDATE contract_milestones SET status = ${to}, note = ${note ?? sql`note`}, updated_at = now() WHERE id = ${milestoneId}::uuid`);
      await this.audit.record({ action, actorUserId: userId, meta, metadata: { contractId, milestoneId } }, tx);
      return { id: side === 'client' ? row.freelancer_id : row.client_id, title: row.title };
    });
    await this.notifications.notify({ userId: other.id, category: 'job', title: other.title, body: notice, data: { contractId } });
  }

  /** Either side may cancel while nothing was approved; afterwards a dispute is the way out. */
  async cancel(userId: string, contractId: string, meta: RequestMeta): Promise<Contract> {
    const otherId = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ client_id: string; freelancer_id: string; status: string }>(sql`
        SELECT client_id, freelancer_id, status FROM freelance_contracts WHERE id = ${contractId}::uuid AND (client_id = ${userId}::uuid OR freelancer_id = ${userId}::uuid) FOR UPDATE`);
      const c = res.rows[0];
      if (!c) throw contractNotFound();
      if (c.status === 'cancelled') return null;
      if (c.status !== 'active') throw AppError.conflict(`The contract is ${c.status}`, { reason: 'contract_not_active', status: c.status });
      const approved = await tx.execute(sql`SELECT 1 FROM contract_milestones WHERE contract_id = ${contractId}::uuid AND status = 'approved' LIMIT 1`);
      if (approved.rows.length > 0) throw AppError.conflict('A milestone is already approved: open a dispute instead', { reason: 'has_approved_milestones' });
      await tx.execute(sql`UPDATE freelance_contracts SET status = 'cancelled', updated_at = now() WHERE id = ${contractId}::uuid`);
      await this.audit.record({ action: 'freelance.contract_cancelled', actorUserId: userId, meta, metadata: { contractId } }, tx);
      return c.client_id === userId ? c.freelancer_id : c.client_id;
    });
    if (otherId) await this.notifications.notify({ userId: otherId, category: 'job', title: 'Contrat', body: 'Le contrat a été annulé.', data: { contractId } });
    return this.getContract(userId, contractId);
  }

  /** One review per side, once the contract is completed. */
  async review(userId: string, contractId: string, body: ReviewContractRequest, meta: RequestMeta): Promise<Contract> {
    const cur = await this.getContract(userId, contractId);
    if (cur.status !== 'completed') throw AppError.conflict('Only a completed contract can be reviewed', { reason: 'contract_not_completed' });
    if (cur.myReview) throw AppError.conflict('You already left a review', { reason: 'already_reviewed' });
    const reviewee = cur.role === 'client' ? cur.freelancer.id : cur.client.id;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO freelance_reviews (contract_id, reviewer_id, reviewee_id, rating, body) VALUES (${contractId}::uuid, ${userId}::uuid, ${reviewee}::uuid, ${body.rating}, ${body.body})`);
      await this.audit.record({ action: 'freelance.review_left', actorUserId: userId, meta, metadata: { contractId, rating: body.rating } }, tx);
    });
    return this.getContract(userId, contractId);
  }

  // ---- Disputes ---------------------------------------------------------------------------------

  async openDispute(userId: string, contractId: string, body: OpenDisputeRequest, meta: RequestMeta): Promise<Contract> {
    const otherId = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ client_id: string; freelancer_id: string; status: string }>(sql`
        SELECT client_id, freelancer_id, status FROM freelance_contracts WHERE id = ${contractId}::uuid AND (client_id = ${userId}::uuid OR freelancer_id = ${userId}::uuid) FOR UPDATE`);
      const c = res.rows[0];
      if (!c) throw contractNotFound();
      if (c.status !== 'active') throw AppError.conflict(`The contract is ${c.status}`, { reason: 'contract_not_active', status: c.status });
      await tx.execute(sql`INSERT INTO contract_disputes (contract_id, opened_by, reason) VALUES (${contractId}::uuid, ${userId}::uuid, ${body.reason})`);
      await tx.execute(sql`UPDATE freelance_contracts SET status = 'disputed', updated_at = now() WHERE id = ${contractId}::uuid`);
      await this.audit.record({ action: 'freelance.dispute_opened', actorUserId: userId, meta, metadata: { contractId } }, tx);
      return c.client_id === userId ? c.freelancer_id : c.client_id;
    });
    await this.notifications.notify({ userId: otherId, category: 'job', title: 'Contrat', body: 'Un litige a été ouvert sur votre contrat.', data: { contractId } });
    return this.getContract(userId, contractId);
  }

  async adminDisputes(q: AdminDisputesQuery, only?: string): Promise<AdminDisputeList> {
    const f: SQL[] = [sql`TRUE`, ...cursorFilter('d', q.cursor)];
    if (only) f.push(sql`d.id = ${only}::uuid`);
    if (q.status) f.push(sql`d.status = ${q.status}`);
    const res = await this.db.execute<{ id: string; contract_id: string; title: string; user_id: string; handle: string; reason: string; status: 'open' | 'resolved'; outcome: 'resume' | 'cancel' | null; resolution: string; created_at: Date }>(sql`
      SELECT d.id, d.contract_id, m.title, u.id AS user_id, u.handle::text AS handle, d.reason, d.status, d.outcome, d.resolution, d.created_at
      FROM contract_disputes d JOIN freelance_contracts c ON c.id = d.contract_id JOIN missions m ON m.id = c.mission_id JOIN users u ON u.id = d.opened_by
      WHERE ${sql.join(f, sql` AND `)} ORDER BY d.created_at DESC, d.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r): AdminDispute => ({
        id: r.id,
        contractId: r.contract_id,
        missionTitle: r.title,
        openedBy: { id: r.user_id, handle: r.handle },
        reason: r.reason,
        status: r.status,
        outcome: r.outcome,
        resolution: r.resolution,
        createdAt: iso(r.created_at),
      })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  /** Platform admin closes a dispute: the contract resumes or is cancelled. Nothing is paid or refunded by CASELIND. */
  async resolveDispute(adminId: string, disputeId: string, body: ResolveDisputeRequest, meta: RequestMeta): Promise<AdminDispute> {
    if (!UUID_RE.test(disputeId)) throw AppError.notFound('Dispute not found');
    const parties = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ contract_id: string; status: string; client_id: string; freelancer_id: string }>(sql`
        SELECT d.contract_id, d.status, c.client_id, c.freelancer_id FROM contract_disputes d JOIN freelance_contracts c ON c.id = d.contract_id
        WHERE d.id = ${disputeId}::uuid FOR UPDATE OF d, c`);
      const d = res.rows[0];
      if (!d) throw AppError.notFound('Dispute not found');
      if (d.status !== 'open') throw AppError.conflict('This dispute is already resolved', { reason: 'dispute_resolved' });
      await tx.execute(sql`UPDATE contract_disputes SET status = 'resolved', outcome = ${body.outcome}, resolution = ${body.resolution}, resolved_by = ${adminId}::uuid, resolved_at = now() WHERE id = ${disputeId}::uuid`);
      await tx.execute(sql`UPDATE freelance_contracts SET status = ${body.outcome === 'resume' ? 'active' : 'cancelled'}, updated_at = now() WHERE id = ${d.contract_id}::uuid`);
      await this.audit.record({ action: 'freelance.dispute_resolved', actorUserId: adminId, meta, metadata: { disputeId, contractId: d.contract_id, outcome: body.outcome } }, tx);
      return [d.client_id, d.freelancer_id];
    });
    await this.notifications.notifyMany(parties.map((u) => ({ userId: u, category: 'job' as const, title: 'Contrat', body: 'Le litige a été tranché.', data: {} })));
    return (await this.adminDisputes({ limit: 1 }, disputeId)).items[0]!;
  }

  private assertCurrency(currency: string): void {
    if (!this.env.COMMERCE_CURRENCIES.includes(currency)) throw invalid('currency', `supported currencies: ${this.env.COMMERCE_CURRENCIES.join(', ')}`);
  }

  private assertDeadline(deadline: string): void {
    if (Number.isNaN(Date.parse(deadline)) || deadline < new Date().toISOString().slice(0, 10)) throw invalid('deadline', 'the deadline must be a valid date, today or later');
  }
}
