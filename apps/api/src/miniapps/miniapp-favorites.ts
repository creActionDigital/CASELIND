import { Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Put } from '@nestjs/common';
import type { MiniAppFavoriteList } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { toPublicApp, type PublicAppRow } from './miniapps.shared.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT = sql.raw(
  `a.id, a.org_id, a.name, a.description, a.icon_media_id, a.launch_url, a.redirect_uris, a.scopes, a.confidential, a.client_id,
   a.client_secret_hash, a.status, a.review_note, a.reviewed_at, a.published_at, a.current_version, a.rate_limit_per_minute, a.manifest, a.certified_at, a.certification_note, a.revenue_share_bps, a.category, a.created_at, a.updated_at,
   o.name AS org_name, o.verification_status AS org_verification`,
);

/** Mini-apps favorites of the signed-in user (only published apps of active organisations are listed). */
@Injectable()
export class MiniAppFavoritesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async add(userId: string, appId: string): Promise<void> {
    if (!UUID.test(appId)) throw AppError.notFound('Application not found');
    const ok = await this.db.execute(sql`SELECT 1 FROM miniapps WHERE id = ${appId}::uuid AND status = 'published'`);
    if (ok.rows.length === 0) throw AppError.notFound('Application not found');
    await this.db.execute(sql`INSERT INTO miniapp_favorites (user_id, app_id) VALUES (${userId}::uuid, ${appId}::uuid) ON CONFLICT DO NOTHING`);
  }

  async remove(userId: string, appId: string): Promise<void> {
    if (!UUID.test(appId)) return;
    await this.db.execute(sql`DELETE FROM miniapp_favorites WHERE user_id = ${userId}::uuid AND app_id = ${appId}::uuid`);
  }

  async list(userId: string): Promise<MiniAppFavoriteList> {
    const res = await this.db.execute<PublicAppRow>(sql`
      SELECT ${SELECT} FROM miniapp_favorites f JOIN miniapps a ON a.id = f.app_id JOIN organizations o ON o.id = a.org_id
      WHERE f.user_id = ${userId}::uuid AND a.status = 'published' AND o.status = 'active'
      ORDER BY f.created_at DESC LIMIT 100`);
    return { items: res.rows.map(toPublicApp) };
  }
}

@Controller('me/miniapp-favorites')
export class MiniAppFavoritesController {
  constructor(private readonly favorites: MiniAppFavoritesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser): Promise<MiniAppFavoriteList> {
    return this.favorites.list(u.userId);
  }

  @Put(':appId')
  @HttpCode(204)
  async add(@CurrentUser() u: AuthUser, @Param('appId') appId: string): Promise<void> {
    await this.favorites.add(u.userId, appId);
  }

  @Delete(':appId')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('appId') appId: string): Promise<void> {
    await this.favorites.remove(u.userId, appId);
  }
}
