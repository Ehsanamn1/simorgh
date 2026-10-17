import { describe, expect, it } from 'vitest';
import {
  evaluateSetupMilestones,
  summarizeSetupMilestones,
  type SetupCounts,
} from './achievements';

const empty: SetupCounts = { customers: 0, suppliers: 0, orders: 0, capacity: 0, goals: 0 };

describe('workspace setup milestones', () => {
  it('shows all milestones as locked when the company has no operational records', () => {
    const milestones = evaluateSetupMilestones(empty);
    expect(milestones).toHaveLength(5);
    expect(milestones.every(milestone => !milestone.achieved)).toBe(true);
    expect(summarizeSetupMilestones(milestones)).toEqual({
      total: 5,
      achieved: 0,
      percentage: 0,
      phase: 'گام نخست',
    });
  });

  it('unlocks milestones only from their corresponding real record counts', () => {
    const milestones = evaluateSetupMilestones({
      ...empty,
      customers: 1,
      suppliers: 4,
    });
    expect(milestones.find(milestone => milestone.id === 'customers')?.achieved).toBe(true);
    expect(milestones.find(milestone => milestone.id === 'suppliers')?.achieved).toBe(true);
    expect(milestones.find(milestone => milestone.id === 'orders')?.achieved).toBe(false);
    expect(summarizeSetupMilestones(milestones)).toEqual({
      total: 5,
      achieved: 2,
      percentage: 40,
      phase: 'راه‌اندازی آغاز شده',
    });
  });

  it('marks the baseline setup complete only when every defined milestone is achieved', () => {
    const milestones = evaluateSetupMilestones({
      customers: 2,
      suppliers: 1,
      orders: 8,
      capacity: 3,
      goals: 1,
    });
    expect(summarizeSetupMilestones(milestones)).toEqual({
      total: 5,
      achieved: 5,
      percentage: 100,
      phase: 'راه‌اندازی پایه تکمیل شد',
    });
  });

  it('does not unlock a milestone from NaN, Infinity or negative counts', () => {
    const milestones = evaluateSetupMilestones({
      customers: Number.NaN,
      suppliers: Number.POSITIVE_INFINITY,
      orders: -2,
      capacity: 0,
      goals: 1,
    });
    expect(milestones.filter(milestone => milestone.achieved).map(milestone => milestone.id)).toEqual(['goals']);
  });
});
