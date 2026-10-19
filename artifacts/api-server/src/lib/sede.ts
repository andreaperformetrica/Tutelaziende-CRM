import { normalizzaPartitaIva, partitaIvaValida } from "@workspace/anagrafica";
import { HttpError } from "./errori";
import { trovaLuogo } from "./luoghi";

export interface DatiSedeInput {
  denominazione?: string | null;
  ragioneSociale?: string | null;
  tipoSoggetto?: "PARTITA_IVA" | "ASSOCIAZIONE" | null;
  sedeIndirizzo?: string | null;
  sedeComuneCodice?: string | null;
  sedeCap?: string | null;
  iban?: string | null;
  codiceFiscaleAssociazione?: string | null;
}

export type SedeNormalizzata = {
  denominazione: string | null;
  ragioneSociale: string | null;
  tipoSoggetto: "PARTITA_IVA" | "ASSOCIAZIONE" | null;
  sedeIndirizzo: string | null;
  sedeComuneCodice: string | null;
  sedeComune: string | null;
  sedeProvincia: string | null;
  sedeCap: string | null;
  iban: string | null;
  codiceFiscaleAssociazione: string | null;
};

const vuoto = (v: string | null | undefined): string | null => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
};

/** Controllo dell'IBAN con la cifra di controllo (mod 97). */
export function ibanValido(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("IT") && iban.length !== 27) return false;
  const spostato = iban.slice(4) + iban.slice(0, 4);
  let resto = 0;
  for (const c of spostato) {
    const v = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
    for (const d of v) resto = (resto * 10 + Number(d)) % 97;
  }
  return resto === 1;
}

/**
 * Validazione dei dati della sede: provincia e comune derivano dal comune scelto con la ricerca luoghi,
 * l'IBAN e il codice fiscale dell'associazione sono controllati nel formato.
 */
export function normalizzaSede(d: DatiSedeInput, partitaIvaPersona: string | null): SedeNormalizzata {
  const tipoSoggetto = d.tipoSoggetto ?? null;
  let sedeComuneCodice: string | null = null;
  let sedeComune: string | null = null;
  let sedeProvincia: string | null = null;
  const codice = vuoto(d.sedeComuneCodice);
  if (codice) {
    const luogo = trovaLuogo(codice);
    if (!luogo || luogo.tipo !== "comune" || !luogo.provincia) {
      throw new HttpError(400, "Comune della sede non valido: selezionalo dall'elenco.", "LUOGO_NON_VALIDO", "sedeComuneCodice");
    }
    sedeComuneCodice = luogo.codice;
    sedeComune = luogo.nome;
    sedeProvincia = luogo.provincia;
  }
  const sedeCap = vuoto(d.sedeCap);
  if (sedeCap && !/^\d{5}$/.test(sedeCap)) throw new HttpError(400, "Il CAP deve essere di 5 cifre.", "DATI_NON_VALIDI", "sedeCap");

  const ibanGrezzo = (vuoto(d.iban) ?? "").replace(/\s+/g, "").toUpperCase();
  if (ibanGrezzo && !ibanValido(ibanGrezzo)) {
    throw new HttpError(400, "L'IBAN non è valido (controlla le cifre: per l'Italia sono 27 caratteri).", "IBAN_NON_VALIDO", "iban");
  }

  let codiceFiscaleAssociazione: string | null = null;
  if (tipoSoggetto === "ASSOCIAZIONE") {
    const cf = normalizzaPartitaIva(d.codiceFiscaleAssociazione ?? "");
    if (!cf) throw new HttpError(400, "Per un'associazione indica il codice fiscale dell'associazione.", "DATI_NON_VALIDI", "codiceFiscaleAssociazione");
    if (!partitaIvaValida(cf)) {
      throw new HttpError(400, "Il codice fiscale dell'associazione non è valido (11 cifre con carattere di controllo corretto).", "CODICE_FISCALE_ASSOCIAZIONE_NON_VALIDO", "codiceFiscaleAssociazione");
    }
    codiceFiscaleAssociazione = cf;
  }
  if (tipoSoggetto === "PARTITA_IVA" && !partitaIvaPersona) {
    throw new HttpError(400, "Per un soggetto con partita IVA indica la partita IVA.", "DATI_NON_VALIDI", "partitaIva");
  }

  return {
    denominazione: vuoto(d.denominazione),
    ragioneSociale: vuoto(d.ragioneSociale),
    tipoSoggetto,
    sedeIndirizzo: vuoto(d.sedeIndirizzo),
    sedeComuneCodice,
    sedeComune,
    sedeProvincia,
    sedeCap,
    iban: ibanGrezzo || null,
    codiceFiscaleAssociazione,
  };
}

/** Nome del collaboratore come compare nelle ricerche e nei menu: "Nome Cognome (denominazione)". */
export const nomeConSede = (c: { nome: string; cognome: string; denominazione?: string | null }) =>
  `${c.nome} ${c.cognome}${c.denominazione ? ` (${c.denominazione})` : ""}`;
