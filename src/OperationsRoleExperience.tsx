import type { ReactNode } from 'react';
import type { Membership } from './lib/types';

type Role = 'manager' | 'supplier' | 'driver';
type Props = { role: Role; membership: Membership; children: ReactNode };

/**
 * Keep role workspaces focused on their actual operational pages.
 *
 * The previous wrapper added a second dashboard, duplicate counts, extra
 * shortcuts and explanatory panels above existing pages. That made the
 * supplier and driver workflows harder to scan and duplicated the manager
 * dashboard. Role authorization belongs in the route/API layer, not in a
 * decorative wrapper, so this component intentionally renders only its page.
 */
export function OperationsRoleExperience({ children }: Props) {
  return <>{children}</>;
}
