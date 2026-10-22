# Domestic Medar API slice

This is the first Node.js/Hono + MySQL vertical slice intended to replace the Cloudflare Worker/Neon runtime after the remaining routes have been ported.

## Implemented in this slice

- MySQL connection pool and a database-backed `GET /api/health`.
- PBKDF2-SHA256 password verification compatible with the existing Medar hash format.
- Owner-provisioned `POST /api/auth/login`; public signup remains disabled.
- Hashed, HttpOnly sessions with expiry, revocation, logout, and session lookup.
- Role-scoped membership listing for the authenticated user.
- Password change with revocation of other sessions.
- Username/IP-derived rate limiting and login-attempt records.
- Security headers, bounded request bodies, origin checks and sanitized error IDs.

## Not complete

This is **not a drop-in replacement yet**. The main React app still calls the existing Worker API, and many operational routes, storage, notification jobs, AI integrations, transactions, event hooks, and concurrency controls remain on the porting backlog. Do not deploy this as the only production API until the remaining routes and integration tests are ported and the frontend is switched deliberately.

## Local run

1. Copy `.env.example` to a private environment file or set variables in the hosting panel.
2. Point `MYSQL_URL` at a dedicated MySQL database that has passed the guarded Medar MySQL migrations.
3. Set `APP_ORIGIN` to the exact public origin (scheme + hostname, no path) in production.
4. Install dependencies with `npm install`, then run `npm run check`, `npm test`, and `npm start`.
5. Verify `/api/health` and the MySQL-backed integration test before routing any live traffic.

Never paste database URLs or passwords into chat or source control. Store them as private hosting environment variables or GitHub Actions Secrets.
