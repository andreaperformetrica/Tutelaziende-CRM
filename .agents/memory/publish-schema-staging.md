---
name: Publish schema staging
description: Two publish failures caused by the dev-to-prod diff, and the two-step cleanup still pending
---
- Dropping a table and the FK pointing at it in one Publish fails (diff emits DROP TABLE CASCADE, then DROP CONSTRAINT on the already-gone FK). Dropping a column and adding another in the same table makes the Publish UI offer a "rename" that can silently map text to integer and break later statements.
- Rule: never drop+add columns in one table, and never drop a table together with the FK that references it, in the same Publish. Keep the old object in the schema for one Publish, remove it in the next.
- PENDING after the next successful Publish: remove `categorie_allegato` table (lib/db schema configurazione-pratiche.ts) and `importazioni.configurazione` column (compensi.ts) from the schema, push to dev, publish again. Both are unused by the app.
**Why:** two consecutive Publish failures on the production migration (Aggiornamento 2 and 7 schema changes).
