# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- Login is app-managed (email+password, scrypt hashes, server-side sessions in `sessioni`, cookie `tutela_sid` SameSite=None; Secure; Partitioned so it works in the Replit preview iframe). CSRF is handled by an Origin check in `middlewares/auth.ts`.
- Until the provisional password is changed the API answers 403 `PASSWORD_DA_CAMBIARE` for everything except `/auth/me`, `/auth/logout`, `/auth/cambio-password`.
- Collaboratori and (phase 2) assistiti share the `persone` table, so codice fiscale and cellulare uniqueness spans both. Validation lives in `artifacts/api-server/src/lib/persone.ts`; codice fiscale algorithm in `lib/anagrafica`.
- Comuni and foreign states are an in-memory JSON (`artifacts/api-server/src/data/luoghi.json`), regenerated with `pnpm --filter @workspace/scripts run genera-luoghi`.
- Every mutation writes to `log_operazioni` in the same transaction via `registraLog` (`lib/log.ts`); new actions must be added to `AZIONI_LOG`.

## Product

Tutela CRM (Italian): back office (super admin, admin, operatore) and Web Collaboratore. Phase 1: login, internal users, collaboratori registry with groups (capogruppo), operations log. Phase 2: assistiti registry (own/group/all visibility), duplicate detection with back-office segnalazioni. Phase 3 (admin only): tipi pratica with required documents and downloadable moduli, raccolta di mandati per tipo (caricati una volta) assegnati ai collaboratori, stati pratica, orari di caricamento (weekly block windows). Phase 4: Web Collaboratore opens pratiche (bozza, one upload slot per required document, server-side orari check on send, progressive numero, post-send lock, comments, "Le mie pratiche" list with capogruppo filter). Phase 5: back office ticketing of pratiche (filterable/sortable list, "Le mie pratiche", scheda with presa in carico, stato changes with history, ufficio attachments with admin-managed categories, chat comments with saved channel, super-admin delete). Phase 6: notifications (email via Resend, WhatsApp and automatic voice call via Twilio) through one service in `lib/notifiche.ts`, events in `lib/notifiche-eventi.ts`, register at `/admin/notifiche`; without keys messages are only recorded. Phase 7: eventi e corsi (admin only): invited sedi confirm and enter participants, each with a personal QR code (generated in the browser); mobile check-in page scans the QR (jsQR): first scan = entrata, second = uscita (at least 60 s later), or accepts manual times; attestato PDF generated with pdf-lib from an uploaded layout (only the name changes); questionario file per evento. WhatsApp invites need the extra secret `TWILIO_WHATSAPP_TEMPLATE_EVENTO_SID`. Test data: `pnpm --filter @workspace/api-server run seed`. Phase 8 (admin only): compensi ai collaboratori — maturazione di punti e ristorno alla chiusura delle pratiche pagabili, resoconto con conferma riga per riga, estratti PDF (stampa e invio email), pagamento che porta le pratiche a Pagata, dare/avere annuale per collaboratore con PDF, impostazioni degli stampati. Phase 9 (admin only, Compensi > Importazioni): import of 730, ISEE, NASPI and Pensionati from .xlsx or .csv — per-service rule (fixed euro per row or percentage of a column) and collaboratore matching column (sportello, email or name) set by the admin, preview with row errors, confirmation (all rows, or only valid ones), same file cannot be confirmed twice for a service (SHA-256), undo of a confirmed import; confirmed rows appear read-only in the dare/avere (730 and ISEE under CAF).

## User preferences

- Phases are delivered one at a time; stop after each for user verification. UI in Italian, no emojis, dates gg/mm/aaaa (Europe/Rome), euro with 2 decimals.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
