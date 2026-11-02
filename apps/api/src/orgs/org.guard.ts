import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { OrgRole } from '@caselind/contracts';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { organizations, orgMembers } from '../db/schema.js';
import { type OrgPermissionKey, roleHasPermission } from './org-permissions.js';

/** The caller's active membership in the org named by `:orgId`, set by OrgGuard. */
export interface OrgMembership {
  orgId: string;
  role: OrgRole;
  orgStatus: 'active' | 'suspended';
}

declare module 'express' {
  interface Request {
    orgMembership?: OrgMembership;
  }
}

const ORG_PERMISSION = 'caselind:orgPermission';

/** Any syntactically valid UUID (what Postgres accepts); anything else cannot name an org or user. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route takes an `:orgId` param and requires an ACTIVE membership in that org whose role carries
 * `permission` (`org.view` = any member).
 *
 * Route-level rather than global: the decorator attaches the guard itself, so the metadata can
 * never be declared without the check running, and routes without `:orgId` pay nothing. Route
 * guards run after the global ones (Throttler, Auth, Flag), so `req.auth` is already set and a
 * disabled feature flag still wins over org checks.
 */
export const OrgPermission = (permission: OrgPermissionKey) =>
  applyDecorators(SetMetadata(ORG_PERMISSION, permission), UseGuards(OrgGuard));

const ORG_SELF_LEAVE = 'caselind:orgSelfLeaveWhenSuspended';

/**
 * Marks a route whose `:userId` param names the target member: when it is the caller's own id the
 * route stays open on a suspended org (leaving must always be possible; the service still applies
 * the last-owner rule). Every other use of the route on a suspended org remains 403.
 */
export const AllowSelfLeaveWhenSuspended = () => SetMetadata(ORG_SELF_LEAVE, true);

/** The membership OrgGuard loaded. Only valid on @OrgPermission routes. */
export const CurrentMembership = createParamDecorator((_: unknown, ctx: ExecutionContext): OrgMembership => {
  const m = ctx.switchToHttp().getRequest<Request>().orgMembership;
  if (!m) throw AppError.forbidden();
  return m;
});

export const orgNotFound = () => AppError.notFound('Organization not found');

/**
 * - malformed id, unknown org, or caller not an active member (invitees included): 404, so a
 *   private org's existence is never revealed;
 * - suspended org: 403 for everything except reads by an owner and leaving (own `:userId` on an
 *   @AllowSelfLeaveWhenSuspended route);
 * - role without the permission: 403.
 * The membership is read from the database on every request: a role change or removal takes
 * effect immediately. Services re-check under a row lock before mutating (see OrgMembersService).
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.get<OrgPermissionKey | undefined>(ORG_PERMISSION, ctx.getHandler());
    if (!permission) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const userId = req.auth?.userId;
    if (!userId) throw AppError.unauthenticated();
    const orgId = req.params.orgId;
    if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) throw orgNotFound();

    const [row] = await this.db
      .select({ role: orgMembers.role, orgStatus: organizations.status })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId), eq(orgMembers.status, 'active')))
      .limit(1);
    if (!row) throw orgNotFound();

    const selfLeave =
      this.reflector.get<boolean | undefined>(ORG_SELF_LEAVE, ctx.getHandler()) === true &&
      typeof req.params.userId === 'string' &&
      req.params.userId.toLowerCase() === userId.toLowerCase();
    if (row.orgStatus === 'suspended' && !selfLeave && !(row.role === 'owner' && req.method === 'GET')) {
      throw AppError.forbidden('This organization is suspended');
    }
    if (!roleHasPermission(row.role, permission)) throw AppError.forbidden();

    req.orgMembership = { orgId, role: row.role, orgStatus: row.orgStatus };
    return true;
  }
}
