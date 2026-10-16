import { createAuthClient } from '@neondatabase/auth';
import { SupabaseAuthAdapter } from '@neondatabase/auth/vanilla/adapters';

const authUrl = import.meta.env.VITE_NEON_AUTH_URL?.trim();
export const isNeonAuthConfigured = Boolean(authUrl);
export const neonAuth = authUrl ? createAuthClient(authUrl, { adapter: SupabaseAuthAdapter() }) : null;
