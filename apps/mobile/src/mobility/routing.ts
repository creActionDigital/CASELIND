export type RideTarget = { pathname: '/rides/[rideId]'; params: { rideId: string } };

/** Destination d'une notification de course (`data.rideId`, catégories `system` ou `message`). */
export function rideTarget(data: unknown): RideTarget | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const rideId = d.rideId;
  if (typeof rideId !== 'string' || rideId.length === 0) return null;
  return { pathname: '/rides/[rideId]', params: { rideId } };
}
