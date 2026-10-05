import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const logOperazioniTable = pgTable(
  "log_operazioni",
  {
    id: serial("id").primaryKey(),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    /** Null per i tentativi di accesso falliti con email sconosciuta. */
    utenteId: integer("utente_id"),
    /** Nome dell'utente al momento dell'operazione. */
    utenteNome: text("utente_nome"),
    ruolo: text("ruolo"),
    azione: text("azione").notNull(),
    entita: text("entita"),
    entitaId: integer("entita_id"),
    descrizione: text("descrizione").notNull(),
    dettagli: jsonb("dettagli"),
    ip: text("ip"),
    /** Valorizzato quando la riga e' stata esportata e archiviata (mai cancellata). */
    archiviatoIl: timestamp("archiviato_il", { withTimezone: true }),
  },
  (t) => [
    index("log_operazioni_creato_il_idx").on(t.creatoIl),
    index("log_operazioni_utente_idx").on(t.utenteId),
    index("log_operazioni_azione_idx").on(t.azione),
  ],
);

export type LogOperazioneRow = typeof logOperazioniTable.$inferSelect;
