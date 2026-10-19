import { boolean, index, integer, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { collaboratoriTable } from "./collaboratori";
import { tipiPraticaTable } from "./configurazione-pratiche";

/**
 * Regole degli alert sui collaboratori, impostate dall'admin. Le righe nascono al primo salvataggio:
 * finche' non esistono valgono i valori predefiniti del codice.
 *  - "inattivita": un collaboratore non carica un tipo di pratica da `soglia` mesi.
 *  - "volume": un collaboratore carica piu' di `soglia` pratiche di un tipo in `periodoGiorni` giorni.
 */
export const alertRegoleTable = pgTable("alert_regole", {
  codice: text("codice", { enum: ["inattivita", "volume"] }).primaryKey(),
  attiva: boolean("attiva").notNull().default(true),
  soglia: integer("soglia").notNull(),
  periodoGiorni: integer("periodo_giorni"),
});

/** Tipi di pratica controllati da ogni regola. */
export const alertRegoleTipiTable = pgTable(
  "alert_regole_tipi",
  {
    regola: text("regola", { enum: ["inattivita", "volume"] }).notNull(),
    tipoPraticaId: integer("tipo_pratica_id")
      .notNull()
      .references(() => tipiPraticaTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.regola, t.tipoPraticaId] })],
);

/** Alert emessi: restano "aperti" finche' la condizione vale, poi diventano "risolti" da soli. */
export const alertCollaboratoriTable = pgTable(
  "alert_collaboratori",
  {
    id: serial("id").primaryKey(),
    regola: text("regola", { enum: ["inattivita", "volume"] }).notNull(),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id, { onDelete: "cascade" }),
    tipoPraticaId: integer("tipo_pratica_id")
      .notNull()
      .references(() => tipiPraticaTable.id, { onDelete: "cascade" }),
    stato: text("stato", { enum: ["aperto", "risolto"] }).notNull().default("aperto"),
    /** Inattivita': mesi trascorsi dall'ultima pratica. Volume: pratiche caricate nel periodo. */
    valore: integer("valore").notNull(),
    /** Inattivita': data dell'ultima pratica di quel tipo (vuoto se non ne ha mai caricate). */
    ultimaPraticaIl: timestamp("ultima_pratica_il", { withTimezone: true }),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    risoltoIl: timestamp("risolto_il", { withTimezone: true }),
  },
  (t) => [
    // Un solo alert aperto per regola, collaboratore e tipo.
    uniqueIndex("alert_collaboratori_aperto_uq").on(t.regola, t.collaboratoreId, t.tipoPraticaId).where(sql`${t.stato} = 'aperto'`),
    index("alert_collaboratori_stato_idx").on(t.stato, t.creatoIl),
  ],
);
