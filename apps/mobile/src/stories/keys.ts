export const storyKeys = {
  feed: ['stories', 'feed'] as const,
  viewers: (storyId: string) => ['stories', 'viewers', storyId] as const,
  myReports: ['reports', 'mine'] as const,
};
