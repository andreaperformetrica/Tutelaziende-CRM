/**
 * Attestati di partecipazione. Il modello grafico (assets/attestato/modello.pdf) e' quello Tutelaziende e resta identico:
 * contiene gia' tutto il testo fisso e su ogni copia si scrivono solo questi campi, con gli stessi caratteri e colori
 * dell'originale: nome e cognome, tipo di corso, argomento, ore di partecipazione (calcolate da entrata e uscita) e data.
 * Nel modello e' stata tolta la vecchia scritta fissa "della durata di : 8 ORE", sostituita dalle ore di partecipazione.
 */
import { readFile } from "node:fs/promises";
import { cmyk, PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { HttpError } from "./errori";

export type TipoCorso = "CAF" | "PATRONATO";

export interface DatiAttestato {
  tipoCorso: TipoCorso;
  argomento: string;
  /** Data del corso, AAAA-MM-GG. */
  data: string;
}

const CARTELLA = new URL("./assets/attestato/", import.meta.url);
const leggi = (nome: string) => readFile(new URL(nome, CARTELLA));

const GRIGIO = cmyk(0.638, 0.543, 0.546, 0.559);
const AZZURRO = cmyk(0.718, 0.381, 0.149, 0.018);
const BLU = cmyk(0.852, 0.577, 0.338, 0.203);

const LARGHEZZA_PAGINA = 841.89;
const CENTRO_X = LARGHEZZA_PAGINA / 2;
/** Larghezza massima di una riga: dentro la cornice del modello. */
const LARGHEZZA_MASSIMA = 640;
/** Centro della data, sotto la scritta "Date" del modello. */
const CENTRO_DATA_X = 595;

const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

/** AAAA-MM-GG -> "18 Aprile 2026". */
export function dataPerAttestato(iso: string): string {
  const [a, m, g] = iso.split("-");
  return `${Number(g)} ${MESI[Number(m) - 1] ?? ""} ${a}`;
}

/** I font incorporati coprono il latino base: per altri caratteri si toglie l'accento o si usa "?". */
export function testoStampabile(font: PDFFont, testo: string): string {
  const ok = (t: string) => {
    try {
      font.widthOfTextAtSize(t, 10);
      return true;
    } catch {
      return false;
    }
  };
  return [...testo.normalize("NFC")]
    .map((c) => (ok(c) ? c : [...c.normalize("NFD").replace(/[\u0300-\u036f]/g, "")].map((x) => (ok(x) ? x : "?")).join("")))
    .join("");
}

interface Font {
  normale: PDFFont;
  grassetto: PDFFont;
  nome: PDFFont;
  firma: PDFFont;
}

interface OpzioniRiga {
  font: PDFFont;
  dimensione: number;
  /** Spazio aggiunto tra un carattere e il successivo, in punti. */
  spaziatura?: number;
  y: number;
  colore: ReturnType<typeof cmyk>;
}

function larghezzaRiga(testo: string, o: Pick<OpzioniRiga, "font" | "dimensione" | "spaziatura">): number {
  const base = o.font.widthOfTextAtSize(testo, o.dimensione);
  return base + (o.spaziatura ?? 0) * Math.max(0, [...testo].length - 1);
}

/** Scrive una riga centrata; se non entra in `massima` rimpicciolisce carattere e spaziatura insieme. */
function scriviCentrato(pagina: PDFPage, testo: string, centroX: number, o: OpzioniRiga, massima = LARGHEZZA_MASSIMA) {
  let dimensione = o.dimensione;
  let spaziatura = o.spaziatura ?? 0;
  const w = larghezzaRiga(testo, { font: o.font, dimensione, spaziatura });
  if (w > massima) {
    const f = Math.max(massima / w, 6 / dimensione);
    dimensione *= f;
    spaziatura *= f;
  }
  const finale = { font: o.font, dimensione, spaziatura };
  let x = centroX - larghezzaRiga(testo, finale) / 2;
  if (!spaziatura) {
    pagina.drawText(testo, { x, y: o.y, size: dimensione, font: o.font, color: o.colore });
    return;
  }
  for (const c of testo) {
    pagina.drawText(c, { x, y: o.y, size: dimensione, font: o.font, color: o.colore });
    x += o.font.widthOfTextAtSize(c, dimensione) + spaziatura;
  }
}

function frase(pagina: PDFPage, f: Font, tipoCorso: string) {
  const dimensione = 12.5868;
  const y = 228.625;
  const parti = [
    { testo: "ha partecipato al corso di formazione di ", font: f.normale },
    { testo: tipoCorso, font: f.grassetto },
    { testo: ":", font: f.normale },
  ];
  const totale = parti.reduce((s, p) => s + p.font.widthOfTextAtSize(p.testo, dimensione), 0);
  let x = CENTRO_X - totale / 2;
  for (const p of parti) {
    pagina.drawText(p.testo, { x, y, size: dimensione, font: p.font, color: AZZURRO });
    x += p.font.widthOfTextAtSize(p.testo, dimensione);
  }
}

export interface PartecipanteAttestato {
  nome: string;
  /** Minuti di presenza, da entrata a uscita. */
  minuti: number;
}

/** 210 -> "3 ORE E 30 MINUTI"; 180 -> "3 ORE"; 45 -> "45 MINUTI". */
export function testoOre(minuti: number): string {
  const ore = Math.floor(minuti / 60);
  const resto = minuti % 60;
  const o = ore === 1 ? "1 ORA" : `${ore} ORE`;
  const m = resto === 1 ? "1 MINUTO" : `${resto} MINUTI`;
  if (ore === 0) return m;
  return resto === 0 ? o : `${o} E ${m}`;
}

function righeOre(pagina: PDFPage, f: Font, minuti: number) {
  const dimensione = 12.5868;
  const parti = [
    { testo: "con una partecipazione effettiva di : ", font: f.normale },
    { testo: testoOre(minuti), font: f.grassetto },
  ];
  const totale = parti.reduce((s, p) => s + p.font.widthOfTextAtSize(p.testo, dimensione), 0);
  let x = CENTRO_X - 1 - totale / 2;
  for (const p of parti) {
    pagina.drawText(p.testo, { x, y: 178.027, size: dimensione, font: p.font, color: AZZURRO });
    x += p.font.widthOfTextAtSize(p.testo, dimensione);
  }
}

export async function generaAttestati(dati: DatiAttestato, nomi: PartecipanteAttestato[]): Promise<Buffer> {
  if (nomi.length === 0) throw new HttpError(400, "Non ci sono partecipanti per cui stampare l'attestato.", "NESSUN_PARTECIPANTE");
  const argomento = dati.argomento.trim();
  if (!argomento) throw new HttpError(409, "Indica l'argomento del corso nell'evento prima di stampare gli attestati.", "DATI_ATTESTATO_MANCANTI");

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const [modello, normale, grassetto, nome, firma] = await Promise.all([
    leggi("modello.pdf"), leggi("mulish-latin-400-normal.woff"), leggi("mulish-latin-700-normal.woff"),
    leggi("unna-latin-700-normal.woff"), leggi("pinyon-script-latin-400-normal.woff"),
  ]);
  const font: Font = {
    normale: await out.embedFont(normale, { subset: true }),
    grassetto: await out.embedFont(grassetto, { subset: true }),
    nome: await out.embedFont(nome, { subset: true }),
    firma: await out.embedFont(firma, { subset: true }),
  };
  // Il modello si incorpora una volta sola e si ripete su ogni pagina.
  const [pagModello] = await out.embedPdf(await PDFDocument.load(modello), [0]);
  if (!pagModello) throw new HttpError(500, "Il modello dell'attestato non può essere letto.", "MODELLO_NON_VALIDO");

  const testoArgomento = testoStampabile(font.grassetto, `\u201C${argomento}\u201D`);
  const testoData = testoStampabile(font.firma, dataPerAttestato(dati.data));
  for (const part of nomi) {
    const n = part.nome;
    const pagina = out.addPage([pagModello.width, pagModello.height]);
    pagina.drawPage(pagModello, { x: 0, y: 0 });
    scriviCentrato(pagina, testoStampabile(font.nome, n.trim().toUpperCase()), CENTRO_X - 5.7, {
      font: font.nome, dimensione: 32.9194, spaziatura: 0.17 * 32.9194, y: 258.771, colore: GRIGIO,
    });
    frase(pagina, font, dati.tipoCorso);
    righeOre(pagina, font, part.minuti);
    scriviCentrato(pagina, testoArgomento, CENTRO_X - 2.5, { font: font.grassetto, dimensione: 16.4597, spaziatura: 0.06 * 16.4597, y: 199.864, colore: BLU });
    scriviCentrato(pagina, testoData, CENTRO_DATA_X, { font: font.firma, dimensione: 16.4597, spaziatura: 0.025 * 16.4597, y: 87.085, colore: GRIGIO }, 190);
  }
  return Buffer.from(await out.save());
}
