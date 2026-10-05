import { boolean, integer, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const ruoloEnum = pgEnum("ruolo", ["super_admin", "admin", "operatore", "collaboratore"]);

export const utentiTable = pgTable(
  "utenti",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    nome: text("nome").notNull(),
    cognome: text("cognome").notNull(),
    ruolo: ruoloEnum("ruolo").notNull(),
    passwordHash: text("password_hash").notNull(),
    deveCambiarePassword: boolean("deve_cambiare_password").notNull().default(true),
    attivo: boolean("attivo").notNull().default(true),
    ultimoAccesso: timestamp("ultimo_accesso", { withTimezone: true }),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    modificatoIl: timestamp("modificato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("utenti_email_lower_idx").on(sql`lower(${t.email})`)],
);

export const sessioniTable = pgTable("sessioni", {
  /** SHA-256 del token presente nel cookie: il token in chiaro non e' mai salvato. */
  id: text("id").primaryKey(),
  utenteId: integer("utente_id")
    .notNull()
    .references(() => utentiTable.id, { onDelete: "cascade" }),
  creataIl: timestamp("creata_il", { withTimezone: true }).notNull().defaultNow(),
  ultimaAttivita: timestamp("ultima_attivita", { withTimezone: true }).notNull().defaultNow(),
});

export type Utente = typeof utentiTable.$inferSelect;
export type Sessione = typeof sessioniTable.$inferSelect;
