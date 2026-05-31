# Example Spec — User Authentication

This is an example spec.md file that demonstrates the canonical format for the Forge Engine.

## Problem

Our application currently has no user authentication system. Users cannot create accounts, log in, or maintain sessions. This prevents us from building personalized features, tracking user activity, or restricting access to protected resources. Without authentication, we cannot differentiate between users or secure sensitive data.

## Solution

Implement a secure email/password authentication system with JWT tokens, allowing users to register, log in, and maintain sessions across devices.

## Non-goals

- Social login (OAuth) — out of scope for Phase 1
- Multi-factor authentication — planned for Phase 2
- Password recovery via SMS — email-only for now
- Role-based access control — separate feature

## User Stories

### AUTH-001: User registration endpoint

**Description:**
Create a POST /api/auth/register endpoint that accepts email and password, validates the input, hashes the password, and stores the user in the database.

**Acceptance Criteria:**
- Endpoint accepts JSON with email and password fields
- Password is hashed using bcrypt before storage
- Duplicate emails return 409 Conflict
- Successful registration returns 201 Created with user object (no password)
- Email validation enforces valid format

**Estimate:** 20 minutes

### AUTH-002: User login endpoint

**Description:**
Create a POST /api/auth/login endpoint that validates credentials and returns a JWT token for authenticated sessions.

**Acceptance Criteria:**
- Endpoint accepts JSON with email and password
- Invalid credentials return 401 Unauthorized
- Successful login returns 200 OK with JWT token and user object
- JWT token includes user ID and email in payload
- Token expires after 7 days

**Estimate:** 15 minutes

**Depends on:** AUTH-001

### AUTH-003: Protected route middleware

**Description:**
Create middleware that validates JWT tokens and attaches user info to requests for protected routes.

**Acceptance Criteria:**
- Middleware extracts JWT from Authorization header
- Invalid or expired tokens return 401 Unauthorized
- Valid tokens attach user object to request context
- Middleware can be composed with route handlers
- Missing Authorization header returns 401

**Estimate:** 10 minutes

**Depends on:** AUTH-002

## Success Criteria

| Metric | Target | Instrument |
|--------|--------|-----------|
| Registration success rate | >95% for valid inputs | Supabase query: `SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days'` |
| Login latency | <200ms p95 | Application logs: `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration) FROM auth_events WHERE event='login'` |
| Token validation errors | <1% of requests | Error tracking: query `auth_errors` table grouped by error_type |

## Upstream

- [design-session] DS-2026-05-28 — Authentication requirements workshop (https://volund.app/design-sessions/auth-may-28)
- [prd] PRD-AUTH — Full authentication PRD in docs/prd/ready/prd-auth.md
