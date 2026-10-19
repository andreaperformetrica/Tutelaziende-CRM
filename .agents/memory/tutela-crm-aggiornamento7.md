---
name: Aggiornamento 7 — importa compensi da Excel
description: Regole dell'import 730/ISEE/NASPI (sostituisce l'import generico configurabile della fase 9)
---
- Supersedes the phase 9 generic/configurable import: no per-service rules or column settings; fixed columns found by header name (sportello, sede, totale dovuto / importo cumulato). Pensionati import removed.
- Match only by "sportello" (trim + uppercase). "sede" is visual only. If the file also has a "centro" column a warning is shown; real files from the user have CENTRO + SPORTELLO (sportello there is a sub-code) — how they map to our sportelli is still undecided.
- 730 and ISEE: one confirmed import per anno (and trimestre), enforced by a partial unique index; same file (SHA-256) cannot be confirmed twice for any type. 730 has a separate "anno del dare/avere" (default current year); ISEE/NASPI use anno.
- NASPI: first import of a collaboratore only sets the reference (pays 0). Reference = max of cumulati/references already covered, so a negative difference is shown as "non pagata" and does not lower the reference (avoids double payment). Chain is per anno. Only the latest NASPI import of the year can be cancelled; imports with a ricevuta cannot be cancelled.
- Dare/avere rows: "730/anno Saldo", "ISEE trimestre N anno", "NASPI <periodo>"; section CAF for 730/ISEE, Naspi for NASPI (assumption); rows with total 0 are hidden.
**Why:** user specified these rules in the update; sezione CAF and reference-as-max are my assumptions to confirm.
