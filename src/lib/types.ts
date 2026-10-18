export type AppRole = 'owner' | 'admin' | 'staff' | 'customer' | 'supplier' | 'driver';
export type Membership = {
  id: string; company_id: string; user_id: string; role: AppRole; customer_id: string | null;
  supplier_id: string | null; active: boolean; company?: { name: string };
};
export type Row = Record<string, unknown>;
export type PageKey = 'home' | 'connect' | 'exceptions' | 'contacts' | 'command' | 'agents' | 'orders' | 'purchase-orders' | 'customers' | 'suppliers' | 'products' | 'inventory' | 'capacity' | 'quality' | 'shipments' | 'finance' | 'members' | 'audit' | 'catalog' | 'my-orders' | 'my-account' | 'supplier-work' | 'supplier-capacity' | 'supplier-settlement' | 'driver-work' | 'farm-sites' | 'flock-cycles' | 'production-batches' | 'daily-production' | 'task-templates' | 'operational-tasks' | 'incidents' | 'partnership-agreements' | 'partner-finance' | 'partner-settlements' | 'contacts-import' | 'goals';
