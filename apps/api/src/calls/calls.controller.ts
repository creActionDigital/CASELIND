import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  type Call,
  type IceServers,
  type CallList,
  type CreateCallRequest,
  type Live,
  type LiveList,
  type LiveMessage,
  type LiveMessageList,
  type SendLiveMessageRequest,
  type SignalRequest,
  type StartLiveRequest,
  createCallRequestSchema,
  sendLiveMessageRequestSchema,
  signalRequestSchema,
  startLiveRequestSchema,
} from '@caselind/contracts';
import { ENV, type Env } from '../config/env.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { CallsService } from './calls.service.js';
import { LiveService } from './live.service.js';

/** 1:1 calls (signalling only), behind the `calls` flag. */
@Controller()
@RequireFlag('calls')
export class CallsController {
  constructor(private readonly calls: CallsService, @Inject(ENV) private readonly env: Env) {}

  /** Declared before calls/:id routes; static path, no clash. */
  @Get('calls/ice-servers')
  iceServers(): IceServers {
    const split = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
    const turn = split(this.env.TURN_URLS);
    const stun = split(this.env.ICE_STUN_URLS);
    return { iceServers: [...(stun.length ? [{ urls: stun }] : []), ...(turn.length ? [{ urls: turn, username: this.env.TURN_USERNAME, credential: this.env.TURN_CREDENTIAL }] : [])] };
  }

  @Post('conversations/:conversationId/calls')
  start(@CurrentUser() u: AuthUser, @Param('conversationId') cid: string, @Body(new ZodPipe(createCallRequestSchema)) b: CreateCallRequest): Promise<Call> {
    return this.calls.start(u.userId, cid, b);
  }

  @Get('me/calls')
  list(@CurrentUser() u: AuthUser): Promise<CallList> {
    return this.calls.list(u.userId);
  }

  @Post('calls/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Call> {
    return this.calls.accept(u.userId, id);
  }

  @Post('calls/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Call> {
    return this.calls.decline(u.userId, id);
  }

  @Post('calls/:id/end')
  @HttpCode(200)
  end(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Call> {
    return this.calls.end(u.userId, id);
  }

  @Post('calls/:id/signal')
  @HttpCode(204)
  signal(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(signalRequestSchema)) b: SignalRequest): Promise<void> {
    return this.calls.signal(u.userId, id, b);
  }
}

/** Live rooms, behind the `live` flag. */
@Controller('lives')
@RequireFlag('live')
export class LiveController {
  constructor(private readonly lives: LiveService) {}

  @Post()
  start(@CurrentUser() u: AuthUser, @Body(new ZodPipe(startLiveRequestSchema)) b: StartLiveRequest): Promise<Live> {
    return this.lives.start(u.userId, b);
  }

  @Get()
  list(@CurrentUser() u: AuthUser): Promise<LiveList> {
    return this.lives.list(u.userId);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Live> {
    return this.lives.get(u.userId, id);
  }

  @Post(':id/join')
  @HttpCode(200)
  join(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Live> {
    return this.lives.join(u.userId, id);
  }

  @Post(':id/leave')
  @HttpCode(204)
  leave(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<void> {
    return this.lives.leave(u.userId, id);
  }

  @Post(':id/end')
  @HttpCode(200)
  end(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Live> {
    return this.lives.end(u.userId, id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<LiveMessageList> {
    return this.lives.messages(u.userId, id);
  }

  @Post(':id/messages')
  send(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(sendLiveMessageRequestSchema)) b: SendLiveMessageRequest): Promise<LiveMessage> {
    return this.lives.sendMessage(u.userId, id, b);
  }

  @Post(':id/signal')
  @HttpCode(204)
  signal(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(signalRequestSchema)) b: SignalRequest): Promise<void> {
    return this.lives.signal(u.userId, id, b);
  }
}
