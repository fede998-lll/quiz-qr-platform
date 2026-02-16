# Quiz QR Classroom

A browser-based system for running live quiz sessions through QR access, designed for reliable operation in real classroom conditions.

## Project Purpose

This project implements a complete end-to-end flow for synchronous assessments:
- authenticated control area for session orchestration
- public participant entry via QR/session link
- real-time response collection and monitoring
- immediate result visualization

The implementation focuses on predictable behavior, low-friction UX, and operational robustness under frequent page reloads, reconnects, and repeated sign-in/out cycles.

## System Profile

- **Frontend:** static single-page application (`HTML`, `CSS`, `Vanilla JavaScript`)
- **Backend platform:** Supabase (`PostgreSQL`, Auth, Row Level Security)
- **Runtime model:** client-driven UI with database-backed state
- **External libraries:** Supabase JS client, QRCode.js, Chart.js (via CDN)

## Functional Flow

1. Authenticated user opens the control interface.
2. A quiz template is selected and a live session is started.
3. The app generates a QR/link containing a session identifier.
4. Participants join, submit one response set, and receive completion feedback.
5. The control interface monitors active participants and completions in near real-time.
6. Results can be inspected during or after session lifecycle transitions.

## Architecture and Reliability Notes

- Canonical route handling prevents unauthorized or malformed path access.
- Authentication bootstrap is guarded against race conditions during refresh and OAuth callbacks.
- Logout flow is session-aware: active sessions are explicitly closed before sign-out completion.
- Host view state is restored after refresh to avoid losing operational context.
- Participant admission is bound to valid active sessions; invalid/closed sessions are rejected.
- Participant identity uses local persistence with URL fallback to keep completion state stable after refresh.
- Client behavior is aligned with backend RLS constraints to keep access boundaries enforceable at data layer.

## Security Posture (Client/Platform Boundary)

- Frontend uses only public client configuration (`SUPABASE_URL`, `ANON_KEY`, public base URL).
- No service-role credentials are required in browser code.
- Access control logic is enforced primarily through database policies and authenticated context.
- Optional debug logging is disabled by default for production-oriented usage.

## Repository Structure

- `index.html` - deployment entrypoint
- `html/index.html` - mirrored HTML copy for project organization
- `js/app.js` - UI state machine, auth/session flow, data sync, routing guards
- `js/config.js` - runtime public configuration
- `js/config.example.js` - local configuration template
- `css/styles.css` - layout, components, responsive styling
- `icons/` - UI iconography and avatar assets
- `supabase/schema.sql` - base schema and baseline policies
- `supabase/migrations/` - incremental schema/policy evolution

## Deployment Model

The application is deployable as a static site with Supabase as managed backend.

- Entry page: `index.html`
- Suitable for static hosting platforms (e.g., GitHub Pages)
- Backend behavior depends on Supabase schema/auth/policy alignment

## Browser Compatibility

Tested for current Chromium-based browsers, Firefox, and Safari.
