import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { collaboratoriTable } from "./collaboratori";
import { mandatiTable } from "./configurazione-pratiche";
import { praticheTable } from "./pratiche";
import { utentiTable } from "./utenti";

/** Codice monouso inviato via SMS al collaboratore per firmare il mandato di una pratica. Si conserva solo l'impronta del codice. */
export const mandatiOtpTable = pgTable(
  "mandati_otp",
  {
    id: serial("id").primaryKey(),
    praticaId: integer("pratica_id")
      .notNull()
      .references(() => praticheTable.id, { onDelete: "cascade" }),
    utenteId: integer("utente_id")
      .notNull()
      .references(() => utentiTable.id),
    codiceHash: text("codice_hash").notNull(),
    cellulare: text("cellulare").notNull(),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    scadeIl: timestamp("scade_il", { withTimezone: true }).notNull(),
    tentativi: integer("tentativi").notNull().default(0),
    usatoIl: timestamp("usato_il", { withTimezone: true }),
  },
  (t) => [index("mandati_otp_pratica_idx").on(t.praticaId, t.utenteId)],
);

/** Mandato firmato con codice SMS: una firma per pratica, con i dati del firmatario e il PDF firmato nello storage. */
export const mandatiFirmeTable = pgTable(
  "mandati_firme",
  {
    id: serial("id").primaryKey(),
    praticaId: integer("pratica_id")
      .notNull()
      .references(() => praticheTable.id, { onDelete: "cascade" }),
    mandatoId: integer("mandato_id").references(() => mandatiTable.id, { onDelete: "restrict" }),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    utenteId: integer("utente_id")
      .notNull()
      .references(() => utentiTable.id),
    firmatarioNome: text("firmatario_nome").notNull(),
    firmatarioCodiceFiscale: text("firmatario_codice_fiscale").notNull(),
    firmatarioCellulare: text("firmatario_cellulare").notNull(),
    firmatoIl: timestamp("firmato_il", { withTimezone: true }).notNull().defaultNow(),
    fileChiave: text("file_chiave").notNull(),
    fileNome: text("file_nome").notNull(),
    fileTipo: text("file_tipo").notNull(),
    fileDimensione: integer("file_dimensione").notNull(),
  },
  (t) => [uniqueIndex("mandati_firme_pratica_uq").on(t.praticaId)],
);
