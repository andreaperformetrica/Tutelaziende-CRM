---
name: Phase 9 import decisions
description: Excel/CSV import of 730, ISEE, NASPI, Pensionati into dare/avere: design choices and assumptions awaiting user confirmation
---
- Generic design: no real Excel files were available, so columns, rule and matching key are admin-configured per service (stored in `impostazioni` under `import.<servizio>`), not hardcoded.
- Duplicate rule: same service + same file SHA-256, only among confirmed imports (partial unique index). Same file may be previewed for another service.
- Compensation: fixed euro per valid row, or percentage of an importo column (Italian number formats parsed). Rows with errors are never saved; admin may confirm "solo valide".
- Dare/avere: import rows are derived at read time from `importazioni_righe` (one line per import and collaboratore), read-only. Assumed mapping: naspi→Naspi, pensionati→Pensionati, 730 and ISEE→CAF.
- Formats: .xlsx and .csv only (exceljs). Old .xls is rejected with a message asking to resave as .xlsx. SheetJS was avoided for known vulnerabilities.
- Header row = row with most filled cells among the first 10 non-empty rows (skips title rows).
**Why:** user said to build the infrastructure first and report what is needed later.
**How to apply:** once the user supplies real files/rules, adjust mapping/section assumptions and defaults instead of rebuilding.
