import { describe, expect, it } from 'vitest';
import {
  evaluateSetupMilestones,
  summarizeSetupMilestones,
  type SetupCounts,
} from './achievements';

const empty: SetupCounts = { suppliers: 0, capacity: 0, members: 0, tasks: 0, shipments: 0 };

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
      members: 1,
      suppliers: 4,
    });
    expect(milestones.find(milestone => milestone.id === 'members')?.achieved).toBe(true);
    expect(milestones.find(milestone => milestone.id === 'suppliers')?.achieved).toBe(true);
    expect(milestones.find(milestone => milestone.id === 'tasks')?.achieved).toBe(false);
    expect(summarizeSetupMilestones(milestones)).toEqual({
      total: 5,
      achieved: 2,
      percentage: 40,
      phase: 'راه‌اندازی آغاز شده',
    });
  });

  it('marks the baseline setup complete only when every defined milestone is achieved', () => {
    const milestones = evaluateSetupMilestones({
      suppliers: 1,
      capacity: 3,
      members: 2,
      tasks: 8,
      shipments: 1,
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
      suppliers: Number.NaN,
      capacity: Number.POSITIVE_INFINITY,
      members: -2,
      tasks: 0,
      shipments: 1,
    });
    expect(milestones.filter(milestone => milestone.achieved).map(milestone => milestone.id)).toEqual(['shipments']);
  });
});
