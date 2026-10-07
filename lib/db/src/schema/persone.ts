import { boolean, date, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Anagrafica di una persona fisica. Tabella condivisa da collaboratori e (fase 2) assistiti:
 * codice fiscale e cellulare univoci qui valgono quindi per entrambi.
 */
export const personeTable = pgTable("persone", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  cognome: text("cognome").notNull(),
  sesso: text("sesso", { enum: ["M", "F"] }).notNull(),
  dataNascita: date("data_nascita", { mode: "string" }).notNull(),
  luogoNascitaCodice: text("luogo_nascita_codice").notNull(),
  luogoNascitaNome: text("luogo_nascita_nome").notNull(),
  luogoNascitaProvincia: text("luogo_nascita_provincia"),
  luogoNascitaEstero: boolean("luogo_nascita_estero").notNull(),
  /** "IT" oppure codice dello stato estero (es. Z129). */
  nazionalita: text("nazionalita").notNull(),
  nazionalitaNome: text("nazionalita_nome").notNull(),
  codiceFiscale: text("codice_fiscale").notNull().unique(),
  /** Obbligatoria per i collaboratori, facoltativa per gli assistiti. */
  email: text("email"),
  telefono: text("telefono"),
  cellulare: text("cellulare").notNull().unique(),
  creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
  modificatoIl: timestamp("modificato_il", { withTimezone: true }).notNull().defaultNow(),
});

export type Persona = typeof personeTable.$inferSelect;
export type NuovaPersona = typeof personeTable.$inferInsert;
