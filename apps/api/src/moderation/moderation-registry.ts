import { Injectable } from '@nestjs/common';

export type ModerationTargetType = 'user' | 'post' | 'comment' | 'story' | 'message' | 'product' | 'review' | 'service' | 'service_review' | 'ride' | 'listing' | 'job' | 'mission' | 'course' | 'course_review';

/** What a content module exposes to reports and moderation. Registered in the module's onModuleInit. */
export interface ModerationTarget {
  /** Whether the reporter can currently see this item (one cannot report what one cannot see). */
  visibleTo(viewerId: string, targetId: string): Promise<boolean>;
  /** Author of the item, for the moderation queue and account sanctions. Null when unknown. */
  authorOf(targetId: string): Promise<string | null>;
  /** Hides (or restores) the item for everyone except moderators; must be idempotent. */
  setHidden(targetId: string, hidden: boolean): Promise<void>;
}

/** Registry of moderatable content types, so reports (lot 4B) never import content modules directly. */
@Injectable()
export class ModerationRegistry {
  private readonly targets = new Map<ModerationTargetType, ModerationTarget>();

  register(type: ModerationTargetType, target: ModerationTarget): void {
    this.targets.set(type, target);
  }

  get(type: ModerationTargetType): ModerationTarget | undefined {
    return this.targets.get(type);
  }
}
