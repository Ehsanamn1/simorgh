export type GoalStatus = 'planned' | 'active' | 'at_risk' | 'achieved' | 'paused' | 'cancelled';

/** Return the percentage of the baseline-to-target interval completed, clamped to 0–100. */
export function goalProgressPercent(baseline: number, target: number, current: number): number | null {
  if (![baseline, target, current].every(Number.isFinite) || target <= baseline) return null;
  return Math.max(0, Math.min(100, ((current - baseline) / (target - baseline)) * 100));
}

/** A due date only counts as overdue while the goal can still be acted on. */
export function isGoalOverdue(dueDate: string | null | undefined, today: string, status: string): boolean {
  if (!dueDate || dueDate >= today) return false;
  return !(['achieved', 'cancelled', 'paused'] as string[]).includes(status);
}
