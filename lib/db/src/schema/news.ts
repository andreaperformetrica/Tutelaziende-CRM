import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { utentiTable } from "./utenti";

/** Notizie mostrate nella home del collaboratore; le gestisce il back office. */
export const newsTable = pgTable(
  "news",
  {
    id: serial("id").primaryKey(),
    titolo: text("titolo").notNull(),
    testo: text("testo").notNull(),
    /** Le bozze (false) non sono visibili ai collaboratori. */
    pubblicata: boolean("pubblicata").notNull().default(true),
    /** Le notizie in evidenza compaiono per prime. */
    inEvidenza: boolean("in_evidenza").notNull().default(false),
    autoreUtenteId: integer("autore_utente_id").references(() => utentiTable.id, { onDelete: "set null" }),
    creataIl: timestamp("creata_il", { withTimezone: true }).notNull().defaultNow(),
    modificataIl: timestamp("modificata_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("news_creata_il_idx").on(t.creataIl)],
);
