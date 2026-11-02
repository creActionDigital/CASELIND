export const sk = {
  feed: ['feed'] as const,
  userPosts: (userId: string) => ['user-posts', userId] as const,
  post: (id: string) => ['post', id] as const,
  comments: (postId: string) => ['comments', postId] as const,
  profile: (userId: string) => ['social-profile', userId] as const,
  stats: (userId: string) => ['social-stats', userId] as const,
  followers: (userId: string) => ['followers', userId] as const,
  following: (userId: string) => ['following', userId] as const,
};
