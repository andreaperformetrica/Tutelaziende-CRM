import { count, eq } from "drizzle-orm";
import { collaboratoriTable, db, utentiTable as utentiRef } from "@workspace/db";
import type { UtenteAutenticato } from "./sessioni";

export async function costruisciSessione(utente: UtenteAutenticato) {
  let collaboratore: { id: number; numeroSportello: string; tipologia: "CAF" | "PATRONATO" | "ENTRAMBI"; capogruppo: boolean } | null =
    null;
  if (utente.collaboratoreId !== null) {
    const [c] = await db
      .select({ id: collaboratoriTable.id, numeroSportello: collaboratoriTable.numeroSportello, tipologia: collaboratoriTable.tipologia, eCapogruppo: collaboratoriTable.eCapogruppo })
      .from(collaboratoriTable)
      .where(eq(collaboratoriTable.id, utente.collaboratoreId));
    if (c) {
      const [membri] = await db
        .select({ n: count() })
        .from(collaboratoriTable)
        .where(eq(collaboratoriTable.capogruppoId, c.id));
      const { eCapogruppo, ...resto } = c;
      collaboratore = { ...resto, capogruppo: eCapogruppo || (membri?.n ?? 0) > 0 };
    }
  }
  return {
    id: utente.id,
    email: utente.email,
    nome: utente.nome,
    cognome: utente.cognome,
    ruolo: utente.ruolo,
    area: utente.ruolo === "collaboratore" ? ("collaboratore" as const) : ("backoffice" as const),
    deveCambiarePassword: utente.deveCambiarePassword,
    colore: utente.colore,
    collaboratore,
  };
}

/** Carica un utente dal database nel formato UtenteAutenticato (usato dopo il login). */
export async function utenteAutenticatoDaId(id: number): Promise<UtenteAutenticato> {
  const [riga] = await db
    .select({
      id: utentiRef.id,
      email: utentiRef.email,
      nome: utentiRef.nome,
      cognome: utentiRef.cognome,
      ruolo: utentiRef.ruolo,
      deveCambiarePassword: utentiRef.deveCambiarePassword,
      colore: utentiRef.colore,
      collaboratoreId: collaboratoriTable.id,
    })
    .from(utentiRef)
    .leftJoin(collaboratoriTable, eq(collaboratoriTable.utenteId, utentiRef.id))
    .where(eq(utentiRef.id, id));
  if (!riga) throw new Error("Utente non trovato");
  return riga;
}
