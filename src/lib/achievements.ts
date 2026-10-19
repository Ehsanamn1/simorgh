export type SetupMetric = 'suppliers' | 'capacity' | 'members' | 'tasks' | 'shipments';
export type SetupCounts = Record<SetupMetric, number>;

export const SETUP_MILESTONES = [
  { id: 'suppliers', metric: 'suppliers', title: 'شبکه تأمین', description: 'یک تأمین‌کننده معتبر ثبت کن', route: '/app/suppliers' },
  { id: 'capacity', metric: 'capacity', title: 'ظرفیت قابل اتکا', description: 'یک تعهد ظرفیت تأییدشده ثبت کن', route: '/app/capacity' },
  { id: 'members', metric: 'members', title: 'دسترسی همکاران', description: 'حساب تأمین‌کننده یا راننده را بساز', route: '/app/members' },
  { id: 'tasks', metric: 'tasks', title: 'اولین مأموریت', description: 'یک وظیفه واقعی واگذار کن', route: '/app/operational-tasks' },
  { id: 'shipments', metric: 'shipments', title: 'حمل‌ونقل فعال', description: 'یک محموله را تا تحویل پیگیری کن', route: '/app/shipments' },
] as const;

export type SetupMilestoneId = (typeof SETUP_MILESTONES)[number]['id'];
export type EvaluatedSetupMilestone = (typeof SETUP_MILESTONES)[number] & { achieved: boolean };

export function evaluateSetupMilestones(counts: SetupCounts): EvaluatedSetupMilestone[] {
  return SETUP_MILESTONES.map(milestone => ({
    ...milestone,
    achieved: Number.isFinite(counts[milestone.metric]) && counts[milestone.metric] >= 1,
  }));
}

export function summarizeSetupMilestones(milestones: readonly EvaluatedSetupMilestone[]) {
  const total = milestones.length;
  const achieved = milestones.reduce((sum, milestone) => sum + (milestone.achieved ? 1 : 0), 0);
  const percentage = total > 0 ? Math.round((achieved / total) * 100) : 0;
  const phase = achieved === total && total > 0
    ? 'راه‌اندازی پایه تکمیل شد'
    : achieved >= 3
      ? 'در حال یکپارچه‌سازی'
      : achieved > 0
        ? 'راه‌اندازی آغاز شده'
        : 'گام نخست';
  return { total, achieved, percentage, phase };
}
