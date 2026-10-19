import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Registro delle notifiche (email, WhatsApp e chiamata). Ogni riga e' un messaggio a un destinatario su un canale.
 * La riga nasce "in_coda" nella stessa transazione dell'operazione che la genera e viene aggiornata dopo il tentativo di invio.
 * Nessun riferimento a tabelle: il registro resta leggibile anche se pratica o utente vengono cancellati.
 */
export const notificheTable = pgTable(
  "notifiche",
  {
    id: serial("id").primaryKey(),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    /** Istante del tentativo di invio (o della registrazione senza invio). */
    elaboratoIl: timestamp("elaborato_il", { withTimezone: true }),
    evento: text("evento").notNull(),
    canale: text("canale", { enum: ["email", "whatsapp", "chiamata"] }).notNull(),
    destinatarioUtenteId: integer("destinatario_utente_id"),
    destinatarioNome: text("destinatario_nome").notNull(),
    /** Indirizzo email o numero di cellulare. */
    destinatarioContatto: text("destinatario_contatto").notNull(),
    praticaId: integer("pratica_id"),
    numeroPratica: integer("numero_pratica"),
    /** Estratto allegato all'email (il PDF viene generato al momento dell'invio). */
    estrattoId: integer("estratto_id"),
    /** Allegati degli eventi: QR code di un partecipante o documenti del corso (si generano al momento dell'invio). */
    allegatiEvento: jsonb("allegati_evento").$type<{ qrPartecipanteId?: number; documentiIds?: number[] }>(),
    /** Oggetto (solo email). */
    oggetto: text("oggetto"),
    /** Testo che il destinatario riceve (per WhatsApp: il testo del template con le variabili sostituite). */
    testo: text("testo").notNull(),
    /** Variabili del template WhatsApp. */
    variabili: jsonb("variabili").$type<Record<string, string>>(),
    esito: text("esito", { enum: ["in_coda", "inviata", "non_inviata", "errore"] }).notNull().default("in_coda"),
    /** Motivo di "non_inviata" (chiavi mancanti) o messaggio di errore del servizio. Mai segreti. */
    dettaglioEsito: text("dettaglio_esito"),
    idEsterno: text("id_esterno"),
  },
  (t) => [
    index("notifiche_creato_il_idx").on(t.creatoIl),
    index("notifiche_esito_idx").on(t.esito),
    index("notifiche_pratica_idx").on(t.praticaId),
  ],
);

export type NotificaRow = typeof notificheTable.$inferSelect;
