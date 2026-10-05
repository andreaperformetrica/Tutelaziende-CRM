import { and, eq, ne } from "drizzle-orm";
import { calcolaCodiceFiscale, codiceFiscaleValido, normalizzaCodiceFiscale, normalizzaTelefono } from "@workspace/anagrafica";
import { collaboratoriTable, db, personeTable, type NuovaPersona } from "@workspace/db";
import { HttpError } from "./errori";
import { CODICE_ITALIA, trovaLuogo, trovaNazionalita } from "./luoghi";
import { codiceErrorePg } from "./postgres";

export interface DatiAnagrafica {
  nome: string;
  cognome: string;
  sesso: "M" | "F";
  dataNascita: string;
  luogoNascitaCodice: string;
  nazionalita: string;
  codiceFiscale: string;
  email: string;
  telefono?: string | null;
  cellulare: string;
}

export type AnagraficaNormalizzata = Omit<NuovaPersona, "id" | "creatoIl" | "modificatoIl">;

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function dataValida(valore: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valore);
  if (!m) return false;
  const [anno, mese, giorno] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(anno, mese - 1, giorno));
  if (d.getUTCFullYear() !== anno || d.getUTCMonth() !== mese - 1 || d.getUTCDate() !== giorno) return false;
  return anno >= 1900 && d.getTime() <= Date.now();
}

/**
 * Validazione e normalizzazione dell'anagrafica di una persona (collaboratore o, in futuro, assistito).
 * Il codice fiscale deve essere formalmente valido ma non deve coincidere con quello calcolato (omocodia).
 */
export function normalizzaAnagrafica(dati: DatiAnagrafica): AnagraficaNormalizzata {
  const nome = dati.nome.trim();
  const cognome = dati.cognome.trim();
  if (!nome) throw new HttpError(400, "Il nome e' obbligatorio.", "DATI_NON_VALIDI", "nome");
  if (!cognome) throw new HttpError(400, "Il cognome e' obbligatorio.", "DATI_NON_VALIDI", "cognome");
  if (!dataValida(dati.dataNascita)) {
    throw new HttpError(400, "La data di nascita non e' valida.", "DATA_NASCITA_NON_VALIDA", "dataNascita");
  }
  const luogo = trovaLuogo(dati.luogoNascitaCodice);
  if (!luogo) throw new HttpError(400, "Luogo di nascita non valido: selezionalo dall'elenco.", "LUOGO_NON_VALIDO", "luogoNascitaCodice");
  const nazionalita = trovaNazionalita(dati.nazionalita);
  if (!nazionalita) throw new HttpError(400, "Nazionalita non valida.", "NAZIONALITA_NON_VALIDA", "nazionalita");
  const codiceFiscale = normalizzaCodiceFiscale(dati.codiceFiscale);
  if (!codiceFiscaleValido(codiceFiscale)) {
    throw new HttpError(400, "Il codice fiscale non e' valido (formato o carattere di controllo errati).", "CODICE_FISCALE_NON_VALIDO", "codiceFiscale");
  }
  const cellulare = normalizzaTelefono(dati.cellulare);
  if (!cellulare) throw new HttpError(400, "Il numero di cellulare non e' valido.", "CELLULARE_NON_VALIDO", "cellulare");
  let telefono: string | null = null;
  if (dati.telefono && dati.telefono.trim()) {
    telefono = normalizzaTelefono(dati.telefono);
    if (!telefono) throw new HttpError(400, "Il numero di telefono non e' valido.", "TELEFONO_NON_VALIDO", "telefono");
  }
  const email = dati.email.trim().toLowerCase();
  if (!REGEX_EMAIL.test(email)) throw new HttpError(400, "Indirizzo email non valido.", "EMAIL_NON_VALIDA", "email");

  return {
    nome,
    cognome,
    sesso: dati.sesso,
    dataNascita: dati.dataNascita,
    luogoNascitaCodice: luogo.codice,
    luogoNascitaNome: luogo.nome,
    luogoNascitaProvincia: luogo.provincia,
    luogoNascitaEstero: luogo.tipo === "stato",
    nazionalita: nazionalita.codice,
    nazionalitaNome: nazionalita.nome,
    codiceFiscale,
    email,
    telefono,
    cellulare,
  };
}

/** Codice fiscale calcolato dai dati inseriti (usato solo per informazione). */
export function codiceFiscaleCalcolato(a: AnagraficaNormalizzata): string | null {
  return calcolaCodiceFiscale({
    nome: a.nome,
    cognome: a.cognome,
    sesso: a.sesso,
    dataNascita: a.dataNascita,
    codiceLuogo: a.luogoNascitaCodice,
  });
}

export const nazionalitaItaliana = (codice: string) => codice === CODICE_ITALIA;

async function descriviPersona(personaId: number): Promise<string> {
  const [riga] = await db
    .select({
      nome: personeTable.nome,
      cognome: personeTable.cognome,
      sportello: collaboratoriTable.numeroSportello,
      collaboratoreId: collaboratoriTable.id,
    })
    .from(personeTable)
    .leftJoin(collaboratoriTable, eq(collaboratoriTable.personaId, personeTable.id))
    .where(eq(personeTable.id, personaId));
  if (!riga) return "un'altra persona";
  return riga.collaboratoreId !== null
    ? `${riga.cognome} ${riga.nome}, collaboratore (sportello ${riga.sportello})`
    : `${riga.cognome} ${riga.nome}, assistito`;
}

/**
 * Codice fiscale e cellulare devono essere unici tra collaboratori e assistiti insieme
 * (condividono la tabella persone). Se esiste un duplicato blocca il salvataggio.
 */
export async function controllaUnicitaPersona(a: AnagraficaNormalizzata, escludiPersonaId?: number): Promise<void> {
  const escludi = escludiPersonaId !== undefined ? [ne(personeTable.id, escludiPersonaId)] : [];
  const [perCf] = await db
    .select({ id: personeTable.id })
    .from(personeTable)
    .where(and(eq(personeTable.codiceFiscale, a.codiceFiscale), ...escludi))
    .limit(1);
  if (perCf) {
    throw new HttpError(
      409,
      `Il codice fiscale ${a.codiceFiscale} e' gia registrato: ${await descriviPersona(perCf.id)}. Salvataggio bloccato.`,
      "CODICE_FISCALE_DUPLICATO",
      "codiceFiscale",
    );
  }
  const [perCell] = await db
    .select({ id: personeTable.id })
    .from(personeTable)
    .where(and(eq(personeTable.cellulare, a.cellulare), ...escludi))
    .limit(1);
  if (perCell) {
    throw new HttpError(
      409,
      `Il numero di cellulare ${a.cellulare} e' gia registrato: ${await descriviPersona(perCell.id)}. Salvataggio bloccato.`,
      "CELLULARE_DUPLICATO",
      "cellulare",
    );
  }
}

/** Traduce una violazione di univocita' del database (concorrenza) nello stesso errore dei controlli precedenti. */
export function erroreDuplicatoDb(err: unknown): HttpError | null {
  const { code, constraint } = codiceErrorePg(err);
  if (code !== "23505") return null;
  const c = constraint ?? "";
  if (c.includes("codice_fiscale"))
    return new HttpError(409, "Il codice fiscale e' gia registrato. Salvataggio bloccato.", "CODICE_FISCALE_DUPLICATO", "codiceFiscale");
  if (c.includes("cellulare"))
    return new HttpError(409, "Il numero di cellulare e' gia registrato. Salvataggio bloccato.", "CELLULARE_DUPLICATO", "cellulare");
  if (c.includes("sportello"))
    return new HttpError(409, "Il numero di sportello e' gia assegnato a un altro collaboratore.", "SPORTELLO_DUPLICATO", "numeroSportello");
  if (c.includes("email"))
    return new HttpError(409, "Esiste gia un utente con questo indirizzo email.", "EMAIL_DUPLICATA", "email");
  return null;
}
