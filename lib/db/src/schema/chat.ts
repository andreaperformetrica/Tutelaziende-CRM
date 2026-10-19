import { index, integer, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";
import { utentiTable } from "./utenti";

/** Chat interna tra utenti del back office. `destinatarioUtenteId` vuoto = canale generale, altrimenti messaggio diretto. */
export const chatMessaggiTable = pgTable(
  "chat_messaggi",
  {
    id: serial("id").primaryKey(),
    mittenteUtenteId: integer("mittente_utente_id")
      .notNull()
      .references(() => utentiTable.id),
    destinatarioUtenteId: integer("destinatario_utente_id").references(() => utentiTable.id),
    testo: text("testo").notNull(),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_messaggi_destinatario_idx").on(t.destinatarioUtenteId, t.id),
    index("chat_messaggi_mittente_idx").on(t.mittenteUtenteId, t.destinatarioUtenteId, t.id),
  ],
);

/** Ultimo messaggio letto da ogni utente in ogni conversazione ("generale" oppure l'id dell'altro utente). */
export const chatLettureTable = pgTable(
  "chat_letture",
  {
    utenteId: integer("utente_id")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "cascade" }),
    conversazione: text("conversazione").notNull(),
    ultimoMessaggioId: integer("ultimo_messaggio_id").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.utenteId, t.conversazione] })],
);
