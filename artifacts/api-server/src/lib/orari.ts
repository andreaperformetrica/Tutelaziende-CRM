/**
 * Orari di caricamento: fasce settimanali in cui i collaboratori NON possono inviare pratiche (fuso Europe/Rome).
 * `calcolaStatoInvio` e' pura e testabile; `statoInvioPratiche` legge le fasce dal database.
 */
import { db, finestreBloccoTable } from "@workspace/db";

export const FUSO = "Europe/Rome";
const MINUTI_GIORNO = 1440;
const MINUTI_SETTIMANA = 7 * MINUTI_GIORNO;

export interface Fascia {
  giornoInizio: number;
  minutoInizio: number;
  giornoFine: number;
  minutoFine: number;
  attiva: boolean;
}

const GIORNI: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSO,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minuto della settimana (0 = lunedi 00:00) all'ora di Roma. */
export function minutoSettimanaRoma(quando: Date): number {
  const parti = formatter.formatToParts(quando);
  const get = (t: string) => parti.find((p) => p.type === t)?.value ?? "";
  return (GIORNI[get("weekday")]! - 1) * MINUTI_GIORNO + Number(get("hour")) * 60 + Number(get("minute"));
}

function inizio(f: Fascia): number {
  return (f.giornoInizio - 1) * MINUTI_GIORNO + f.minutoInizio;
}
function fine(f: Fascia): number {
  return (f.giornoFine - 1) * MINUTI_GIORNO + f.minutoFine;
}

function bloccato(fasce: Fascia[], m: number): boolean {
  return fasce.some((f) => {
    if (!f.attiva) return false;
    const s = inizio(f);
    const e = fine(f);
    return s < e ? m >= s && m < e : m >= s || m < e;
  });
}

export interface StatoInvio {
  consentito: boolean;
  adesso: Date;
  /** Primo istante (al minuto) in cui l'invio torna consentito; null se e' consentito o se e' bloccato sempre. */
  bloccatoFinoA: Date | null;
}

export function calcolaStatoInvio(fasce: Fascia[], adesso: Date = new Date()): StatoInvio {
  if (!bloccato(fasce, minutoSettimanaRoma(adesso))) return { consentito: true, adesso, bloccatoFinoA: null };
  const base = new Date(Math.floor(adesso.getTime() / 60000) * 60000);
  for (let i = 1; i <= MINUTI_SETTIMANA; i++) {
    const t = new Date(base.getTime() + i * 60000);
    if (!bloccato(fasce, minutoSettimanaRoma(t))) return { consentito: false, adesso, bloccatoFinoA: t };
  }
  return { consentito: false, adesso, bloccatoFinoA: null };
}

export async function leggiFasce() {
  const righe = await db.select().from(finestreBloccoTable).orderBy(finestreBloccoTable.id);
  return righe;
}

/** Da usare prima di accettare l'invio di una pratica: legge le fasce e valuta l'istante attuale. */
export async function statoInvioPratiche(adesso: Date = new Date()): Promise<StatoInvio> {
  return calcolaStatoInvio(await leggiFasce(), adesso);
}

export const oraDaMinuti = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function minutiDaOra(s: string): number | null {
  const r = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return r ? Number(r[1]) * 60 + Number(r[2]) : null;
}
