export type SetupMetric = 'customers' | 'suppliers' | 'orders' | 'capacity' | 'goals';

export type SetupCounts = Record<SetupMetric, number>;

export const SETUP_MILESTONES = [
  {
    id: 'customers',
    metric: 'customers',
    title: 'اولین مشتری',
    description: 'یک مشتری سازمانی ثبت کن',
    route: '/app/customers',
  },
  {
    id: 'suppliers',
    metric: 'suppliers',
    title: 'شبکه تأمین',
    description: 'یک تأمین‌کننده معتبر ثبت کن',
    route: '/app/suppliers',
  },
  {
    id: 'orders',
    metric: 'orders',
    title: 'اولین سفارش',
    description: 'یک سفارش واقعی در مدار بساز',
    route: '/app/orders',
  },
  {
    id: 'capacity',
    metric: 'capacity',
    title: 'ظرفیت برنامه‌ریزی‌شده',
    description: 'ظرفیت تأییدشده یا متعهد ثبت کن',
    route: '/app/capacity',
  },
  {
    id: 'goals',
    metric: 'goals',
    title: 'هدف قابل‌پیگیری',
    description: 'یک هدف اجرایی برای مجموعه تعریف کن',
    route: '/app/goals',
  },
] as const;

export type SetupMilestoneId = (typeof SETUP_MILESTONES)[number]['id'];

export type EvaluatedSetupMilestone = (typeof SETUP_MILESTONES)[number] & {
  achieved: boolean;
};

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
