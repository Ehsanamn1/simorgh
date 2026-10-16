import { describe, expect, it } from 'vitest';
import { goalProgressPercent, isGoalOverdue } from '../lib/goals';

describe('goal progress and overdue indicators', () => {
  it('calculates percentage from baseline to target', () => {
    expect(goalProgressPercent(20, 100, 60)).toBe(50);
  });
  it('clamps progress outside the target range', () => {
    expect(goalProgressPercent(0, 10, -5)).toBe(0);
    expect(goalProgressPercent(0, 10, 15)).toBe(100);
  });
  it('returns no percentage if target is not above baseline', () => {
    expect(goalProgressPercent(5, 5, 5)).toBeNull();
    expect(goalProgressPercent(7, 3, 4)).toBeNull();
  });
  it('marks only actionable goals with a past due date as overdue', () => {
    expect(isGoalOverdue('2026-10-14', '2026-10-16', 'active')).toBe(true);
    expect(isGoalOverdue('2026-10-16', '2026-10-16', 'active')).toBe(false);
    expect(isGoalOverdue('2026-10-14', '2026-10-16', 'achieved')).toBe(false);
    expect(isGoalOverdue('2026-10-14', '2026-10-16', 'paused')).toBe(false);
    expect(isGoalOverdue(null, '2026-10-16', 'active')).toBe(false);
  });
});
