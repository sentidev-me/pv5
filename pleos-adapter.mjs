/**
 * Simulation-only Pleos integration boundary.
 * No vehicle SDK, account, network call, location feed, or door signal is used.
 * Production integration must replace this boundary after platform validation.
 */
import { randomUUID } from 'node:crypto';

export const MAX_WAYPOINTS = 2;

export function simulateDispatch({ requestId, itinerary }) {
  if (!requestId || !Array.isArray(itinerary) || itinerary.length === 0) {
    throw new Error('A request and a complete server-side itinerary are required.');
  }
  const waypoints = itinerary.slice(0, MAX_WAYPOINTS).map(({ id, label, time, type }) => ({ id, label, time, type }));
  return {
    dispatchId: `sim-${randomUUID()}`,
    requestId,
    mode: 'simulation',
    accepted: true,
    executionConfirmed: false,
    maxWaypoints: MAX_WAYPOINTS,
    fullItineraryStopCount: itinerary.length,
    waypoints,
    warning: 'Pleos SDK 미연결 · 데모 전송 접수이며 실제 차량 실행 확인이 아닙니다.',
  };
}
