import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type NaturalFiltersRequest,
  naturalFiltersRequestSchema,
  type NaturalQuery,
  naturalQuerySchema,
  type NaturalSearchResult,
  type SearchHistory,
  type SearchHistorySettings,
  searchHistorySettingsSchema,
  type SearchQuery,
  searchQuerySchema,
  type SearchResult,
} from '@caselind/contracts';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { NaturalSearchService } from './natural-search.service.js';
import { SearchHistoryService } from './search-history.service.js';
import { SearchService } from './search.service.js';

/** Name of the throttled handler (app.module.ts gives it its own budget). */
export const SEARCH_HANDLER = 'search';
/** The natural-language routes share the search budget. */
export const NATURAL_HANDLERS = ['naturalSearch', 'naturalSearchWith'];

/** Lot 7 : universal search and its history. Behind the `search` flag; every route is authenticated. */
@Controller()
@RequireFlag('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly history: SearchHistoryService,
    private readonly natural: NaturalSearchService,
  ) {}

  /** A phrase (fr/en/sw) turned into validated filters, then the usual search. A model only refines it with the ai_processing consent. */
  @Get('search/natural')
  naturalSearch(@CurrentUser() user: AuthUser, @Query(new ZodPipe(naturalQuerySchema)) query: NaturalQuery): Promise<NaturalSearchResult> {
    return this.natural.search(user.userId, query.q);
  }

  /** Same search with the filters edited by the user (chips): no model involved. */
  @Post('search/natural/filters')
  @HttpCode(200)
  naturalSearchWith(@CurrentUser() user: AuthUser, @Body(new ZodPipe(naturalFiltersRequestSchema)) body: NaturalFiltersRequest): Promise<NaturalSearchResult> {
    return this.natural.searchWith(user.userId, body.filters);
  }

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query(new ZodPipe(searchQuerySchema)) query: SearchQuery): Promise<SearchResult> {
    return this.searchService.search(user.userId, user.roles, query);
  }

  @Get('me/search-history')
  list(@CurrentUser() user: AuthUser): Promise<SearchHistory> {
    return this.history.list(user.userId);
  }

  @Patch('me/search-history/settings')
  settings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(searchHistorySettingsSchema)) body: SearchHistorySettings,
  ): Promise<SearchHistorySettings> {
    return this.history.setEnabled(user.userId, body.enabled);
  }

  @Delete('me/search-history')
  @HttpCode(204)
  async clear(@CurrentUser() user: AuthUser): Promise<void> {
    await this.history.clear(user.userId);
  }

  @Delete('me/search-history/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.history.remove(user.userId, id);
  }
}
