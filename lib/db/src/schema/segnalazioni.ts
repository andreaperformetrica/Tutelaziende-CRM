import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { collaboratoriTable } from "./collaboratori";
import { personeTable } from "./persone";
import { utentiTable } from "./utenti";

/**
 * Segnalazione al back office: un collaboratore ha provato a inserire un assistito il cui codice fiscale
 * o cellulare coincide con una persona gia' registrata e non visibile a lui. Il collaboratore non vede mai
 * chi sia la persona gia' registrata: questi dati sono leggibili solo dal back office.
 */
export const segnalazioniDuplicatiTable = pgTable(
  "segnalazioni_duplicati",
  {
    id: serial("id").primaryKey(),
    creataIl: timestamp("creata_il", { withTimezone: true }).notNull().defaultNow(),
    ultimoTentativoIl: timestamp("ultimo_tentativo_il", { withTimezone: true }).notNull().defaultNow(),
    /** Numero di volte che lo stesso collaboratore ha riprovato con la stessa persona gia' registrata. */
    tentativi: integer("tentativi").notNull().default(1),
    richiedenteCollaboratoreId: integer("richiedente_collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    richiedenteUtenteId: integer("richiedente_utente_id")
      .notNull()
      .references(() => utentiTable.id),
    personaEsistenteId: integer("persona_esistente_id")
      .notNull()
      .references(() => personeTable.id),
    tipoCorrispondenza: text("tipo_corrispondenza", { enum: ["assistito", "collaboratore"] }).notNull(),
    /** Campi coincidenti: codice_fiscale e/o cellulare. */
    campi: text("campi").array().notNull(),
    /** Dati inseriti nell'ultimo tentativo (nessun segreto). */
    datiTentati: jsonb("dati_tentati").notNull(),
    stato: text("stato", { enum: ["aperta", "gestita"] }).notNull().default("aperta"),
    esito: text("esito", { enum: ["associata", "archiviata"] }),
    nota: text("nota"),
    gestitaIl: timestamp("gestita_il", { withTimezone: true }),
    gestitaDaUtenteId: integer("gestita_da_utente_id").references(() => utentiTable.id),
  },
  (t) => [index("segnalazioni_stato_idx").on(t.stato), index("segnalazioni_persona_idx").on(t.personaEsistenteId)],
);

export type SegnalazioneDuplicatoRow = typeof segnalazioniDuplicatiTable.$inferSelect;
