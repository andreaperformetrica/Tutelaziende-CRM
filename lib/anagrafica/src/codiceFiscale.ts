/**
 * Calcolo e validazione del codice fiscale italiano (persone fisiche).
 * Algoritmo ufficiale (DM 23/12/1976), con gestione dell'omocodia.
 */

export type Sesso = "M" | "F";

export interface DatiCodiceFiscale {
  nome: string;
  cognome: string;
  sesso: Sesso;
  /** Data di nascita nel formato AAAA-MM-GG. */
  dataNascita: string;
  /** Codice catastale (Belfiore) del comune italiano o dello stato estero (es. H501, Z404). */
  codiceLuogo: string;
}

const MESI = "ABCDEHLMPRST";
const VOCALI = "AEIOU";

const DISPARI: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Lettere usate al posto delle cifre nei casi di omocodia (posizioni 6,7,9,10,12,13,14). */
const OMOCODIA = "LMNPQRSTUV";
const POSIZIONI_OMOCODIA = [6, 7, 9, 10, 12, 13, 14];

function soloLettere(testo: string): string {
  return testo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function consonanti(lettere: string): string {
  return [...lettere].filter((c) => !VOCALI.includes(c)).join("");
}

function vocali(lettere: string): string {
  return [...lettere].filter((c) => VOCALI.includes(c)).join("");
}

function codiceCognome(cognome: string): string {
  const l = soloLettere(cognome);
  return (consonanti(l) + vocali(l) + "XXX").slice(0, 3);
}

function codiceNome(nome: string): string {
  const l = soloLettere(nome);
  const c = consonanti(l);
  if (c.length >= 4) return c[0]! + c[2]! + c[3]!;
  return (c + vocali(l) + "XXX").slice(0, 3);
}

/** Carattere di controllo calcolato sui primi 15 caratteri. */
export function carattereDiControllo(primi15: string): string {
  let somma = 0;
  for (let i = 0; i < 15; i++) {
    const c = primi15[i]!;
    if (i % 2 === 0) {
      const v = DISPARI[c];
      if (v === undefined) throw new Error("Carattere non valido nel codice fiscale");
      somma += v;
    } else {
      somma += /\d/.test(c) ? Number(c) : ALFABETO.indexOf(c);
    }
  }
  return ALFABETO[somma % 26]!;
}

/**
 * Calcola il codice fiscale. Restituisce null se i dati sono incompleti o non validi.
 */
export function calcolaCodiceFiscale(dati: Partial<DatiCodiceFiscale>): string | null {
  const { nome, cognome, sesso, dataNascita, codiceLuogo } = dati;
  if (!nome?.trim() || !cognome?.trim() || !sesso || !dataNascita || !codiceLuogo) return null;
  if (soloLettere(nome).length === 0 || soloLettere(cognome).length === 0) return null;
  const luogo = codiceLuogo.trim().toUpperCase();
  if (!/^[A-Z]\d{3}$/.test(luogo)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataNascita);
  if (!m) return null;
  const anno = Number(m[1]);
  const mese = Number(m[2]);
  const giorno = Number(m[3]);
  const data = new Date(Date.UTC(anno, mese - 1, giorno));
  if (
    data.getUTCFullYear() !== anno ||
    data.getUTCMonth() !== mese - 1 ||
    data.getUTCDate() !== giorno
  ) {
    return null;
  }
  const giornoCodice = String(sesso === "F" ? giorno + 40 : giorno).padStart(2, "0");
  const primi15 =
    codiceCognome(cognome) +
    codiceNome(nome) +
    String(anno % 100).padStart(2, "0") +
    MESI[mese - 1]! +
    giornoCodice +
    luogo;
  return primi15 + carattereDiControllo(primi15);
}

export function normalizzaCodiceFiscale(valore: string): string {
  return valore.replace(/\s/g, "").toUpperCase();
}

/** Verifica forma e carattere di controllo (accetta anche i codici omocodici). */
export function codiceFiscaleValido(valore: string): boolean {
  const cf = normalizzaCodiceFiscale(valore);
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPR-T][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) {
    return false;
  }
  try {
    return carattereDiControllo(cf.slice(0, 15)) === cf[15];
  } catch {
    return false;
  }
}

/** Riporta un codice omocodico alla forma con sole cifre (ultimo carattere escluso). */
function senzaOmocodia(cf: string): string {
  const caratteri = [...cf.slice(0, 15)];
  for (const pos of POSIZIONI_OMOCODIA) {
    const idx = OMOCODIA.indexOf(caratteri[pos]!);
    if (idx >= 0) caratteri[pos] = String(idx);
  }
  return caratteri.join("");
}

/**
 * Vero se i due codici coincidono oppure differiscono solo per l'omocodia.
 */
export function equivalentiOmocodia(a: string, b: string): boolean {
  const x = normalizzaCodiceFiscale(a);
  const y = normalizzaCodiceFiscale(b);
  if (x.length !== 16 || y.length !== 16) return false;
  return senzaOmocodia(x) === senzaOmocodia(y);
}
