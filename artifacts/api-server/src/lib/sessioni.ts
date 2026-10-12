import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, lt, or, sql } from "drizzle-orm";
import type { Executor } from "./log";
import { db, sessioniTable, utentiTable, collaboratoriTable } from "@workspace/db";

export const NOME_COOKIE = "tutela_sid";
/** Scadenza per inattivita'. */
const INATTIVITA_MS = 8 * 60 * 60 * 1000;
/** Durata massima assoluta di una sessione. */
const DURATA_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const AGGIORNA_ATTIVITA_MS = 60 * 1000;

function idDaToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function creaSessione(utenteId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessioniTable).values({ id: idDaToken(token), utenteId });
  // Pulizia opportunistica delle sessioni scadute.
  const limiteInattivita = new Date(Date.now() - INATTIVITA_MS);
  const limiteAssoluto = new Date(Date.now() - DURATA_MAX_MS);
  await db
    .delete(sessioniTable)
    .where(or(lt(sessioniTable.ultimaAttivita, limiteInattivita), lt(sessioniTable.creataIl, limiteAssoluto)));
  return token;
}

export async function chiudiSessione(token: string): Promise<void> {
  await db.delete(sessioniTable).where(eq(sessioniTable.id, idDaToken(token)));
}

export async function chiudiSessioniUtente(utenteId: number, executor: Executor = db) {
  await executor.delete(sessioniTable).where(eq(sessioniTable.utenteId, utenteId));
}

/**
 * Il cookie e' httpOnly. L'anteprima e' mostrata in un iframe di un altro sito, quindi serve
 * SameSite=None; Secure; Partitioned perche' il browser lo accetti anche li'.
 */
export function impostaCookie(res: Response, token: string): void {
  res.append(
    "Set-Cookie",
    `${NOME_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(DURATA_MAX_MS / 1000)}; HttpOnly; Secure; SameSite=None; Partitioned`,
  );
}

export function rimuoviCookie(res: Response): void {
  res.append(
    "Set-Cookie",
    `${NOME_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`,
  );
}

export function tokenDaRichiesta(req: Request): string | null {
  const t = (req.cookies as Record<string, string> | undefined)?.[NOME_COOKIE];
  return typeof t === "string" && t.length > 0 ? t : null;
}

export interface UtenteAutenticato {
  id: number;
  email: string;
  nome: string;
  cognome: string;
  ruolo: "super_admin" | "admin" | "operatore" | "collaboratore";
  deveCambiarePassword: boolean;
  colore: string | null;
  collaboratoreId: number | null;
}

/** Restituisce l'utente della sessione se valida (e rinnova l'ultima attivita'), altrimenti null. */
export async function utenteDaToken(token: string): Promise<UtenteAutenticato | null> {
  const id = idDaToken(token);
  const [riga] = await db
    .select({
      sessione: sessioniTable,
      utente: utentiTable,
      collaboratoreId: collaboratoriTable.id,
    })
    .from(sessioniTable)
    .innerJoin(utentiTable, eq(utentiTable.id, sessioniTable.utenteId))
    .leftJoin(collaboratoriTable, eq(collaboratoriTable.utenteId, utentiTable.id))
    .where(and(eq(sessioniTable.id, id), eq(utentiTable.attivo, true)))
    .limit(1);
  if (!riga) return null;
  const ora = Date.now();
  const { sessione, utente } = riga;
  if (
    ora - sessione.ultimaAttivita.getTime() > INATTIVITA_MS ||
    ora - sessione.creataIl.getTime() > DURATA_MAX_MS
  ) {
    await db.delete(sessioniTable).where(eq(sessioniTable.id, id));
    return null;
  }
  if (ora - sessione.ultimaAttivita.getTime() > AGGIORNA_ATTIVITA_MS) {
    await db.update(sessioniTable).set({ ultimaAttivita: sql`now()` }).where(eq(sessioniTable.id, id));
  }
  return {
    id: utente.id,
    email: utente.email,
    nome: utente.nome,
    cognome: utente.cognome,
    ruolo: utente.ruolo,
    deveCambiarePassword: utente.deveCambiarePassword,
    colore: utente.colore,
    collaboratoreId: riga.collaboratoreId,
  };
}
