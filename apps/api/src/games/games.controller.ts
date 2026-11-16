import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type AdminGameQuestion,
  type AdminGameQuestionList,
  type CreateGameQuestionRequest,
  type CreateTournamentRequest,
  createTournamentRequestSchema,
  type GameBadgeList,
  type Tournament,
  type TournamentList,
  type TournamentRanking,
  createGameQuestionRequestSchema,
  type Leaderboard,
  type LeaderboardQuery,
  leaderboardQuerySchema,
  type GameQuizResult,
  type QuizSession,
  type SubmitQuizAnswersRequest,
  submitQuizAnswersRequestSchema,
  type UpdateGameQuestionRequest,
  updateGameQuestionRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { GamesService } from './games.service.js';

/** Play & Win quiz éclair for any signed-in user. Behind the `games` flag. */
@Controller('games/quiz')
@RequireFlag('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Post('sessions')
  start(@CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta): Promise<QuizSession> {
    return this.games.start(u.userId, meta);
  }

  @Post('sessions/:id/answers')
  @HttpCode(200)
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(submitQuizAnswersRequestSchema)) b: SubmitQuizAnswersRequest, @ReqMeta() meta: RequestMeta): Promise<GameQuizResult> {
    return this.games.submit(u.userId, id, b, meta);
  }

  @Get('leaderboard')
  leaderboard(@CurrentUser() u: AuthUser, @Query(new ZodPipe(leaderboardQuerySchema)) q: LeaderboardQuery): Promise<Leaderboard> {
    return this.games.leaderboard(u.userId, q);
  }

  @Get('badges')
  badges(@CurrentUser() u: AuthUser): Promise<GameBadgeList> {
    return this.games.badges(u.userId);
  }

  @Get('tournaments')
  tournaments(): Promise<TournamentList> {
    return this.games.listTournaments();
  }

  @Get('tournaments/:id')
  ranking(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<TournamentRanking> {
    return this.games.tournamentRanking(u.userId, id);
  }
}

/** Administrators maintain the questions. */
@Controller('admin/games/questions')
@RequireFlag('games')
@Roles('admin')
export class AdminGamesController {
  constructor(private readonly games: GamesService) {}

  @Post()
  create(@Body(new ZodPipe(createGameQuestionRequestSchema)) b: CreateGameQuestionRequest): Promise<AdminGameQuestion> {
    return this.games.createQuestion(b);
  }

  @Get()
  list(): Promise<AdminGameQuestionList> {
    return this.games.listQuestions();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(updateGameQuestionRequestSchema)) b: UpdateGameQuestionRequest): Promise<AdminGameQuestion> {
    return this.games.setActive(id, b.active);
  }
}

/** Administrators open tournaments. */
@Controller('admin/games/tournaments')
@RequireFlag('games')
@Roles('admin')
export class AdminTournamentsController {
  constructor(private readonly games: GamesService) {}

  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createTournamentRequestSchema)) b: CreateTournamentRequest, @ReqMeta() meta: RequestMeta): Promise<Tournament> {
    return this.games.createTournament(u.userId, b, meta);
  }
}
