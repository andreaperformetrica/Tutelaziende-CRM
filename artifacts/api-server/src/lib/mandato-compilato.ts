import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { assistitiTable, db, personeTable } from "@workspace/db";
import { HttpError } from "./errori";
import { logger } from "./logger";
import { leggiFile } from "./storage";

/**
 * Il mandato e' un modello Word (uno per sede) con campi del tipo @cliente.cognome.
 * Alla richiesta del collaboratore i campi vengono sostituiti con i dati dell'assistito e il file e' convertito in PDF.
 */

export interface DatiMandato {
  cliente: {
    cognome: string; nome: string; nascita: string; sesso: string; luogoNascita: string; cf: string; tel: string; cell: string;
    email: string; indirizzo: string; civico: string; cap: string; citta: string; provincia: string; nazione: string;
  };
  richiesta: { tipo: string };
  polizza: { tipo: string };
}

/** Campi riconosciuti nei modelli (senza distinzione tra maiuscole e minuscole), con l'esempio mostrato all'amministratore. */
export const CAMPI_MANDATO: string[] = [
  "cliente.cognome", "cliente.nome", "cliente.nascita", "cliente.sesso", "cliente.luogoNascita", "cliente.cf", "cliente.tel", "cliente.cell",
  "cliente.email", "cliente.indirizzo", "cliente.civico", "cliente.cap", "cliente.citta", "cliente.provincia", "cliente.nazione",
  "richiesta.tipo", "polizza.tipo",
];
const NOTI = new Map(CAMPI_MANDATO.map((c) => [c.toLowerCase(), c]));

const TOKEN = /@(?:cliente|richiesta|polizza)\.[A-Za-z]+/g;
const PARTI_XML = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const RUN_TESTO = /<w:t((?:\s[^>]*)?)>([^<]*)<\/w:t>/g;
const FINE_PARAGRAFO = /<\/w:p>/g;
const PIU_LUNGHI_PRIMA = [...NOTI.keys()].sort((a, b) => b.length - a.length);

const disescapa = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const escapa = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Run { inizio: number; fine: number; attributi: string; testo: string; paragrafo: number }
interface Trovato { da: number; lunghezza: number; campo: string | null; token: string }

/** Un campo puo' essere spezzato da Word in piu' porzioni di testo: si ragiona sul testo unito di ogni paragrafo. */
function leggiRun(xml: string): Run[] {
  const fini = [...xml.matchAll(FINE_PARAGRAFO)].map((m) => m.index!);
  let k = 0;
  return [...xml.matchAll(RUN_TESTO)].map((m) => {
    while (k < fini.length && fini[k]! < m.index!) k += 1;
    return { inizio: m.index!, fine: m.index! + m[0].length, attributi: m[1] ?? "", testo: disescapa(m[2] ?? ""), paragrafo: k };
  });
}

function raggruppa(runs: Run[]): number[][] {
  const gruppi: number[][] = [];
  runs.forEach((r, i) => {
    const ultimo = gruppi[gruppi.length - 1];
    if (ultimo && runs[ultimo[0]!]!.paragrafo === r.paragrafo) ultimo.push(i); else gruppi.push([i]);
  });
  return gruppi;
}

/** Cerca i campi nel testo di un paragrafo; un campo noto puo' essere seguito da altro testo senza spazio (es. @cliente.cognomePunto). */
function trovaCampi(testo: string): Trovato[] {
  const esiti: Trovato[] = [];
  for (const m of testo.matchAll(TOKEN)) {
    const nome = m[0].slice(1).toLowerCase();
    const noto = PIU_LUNGHI_PRIMA.find((c) => nome.startsWith(c));
    esiti.push({ da: m.index!, lunghezza: noto ? noto.length + 1 : m[0].length, campo: noto ?? null, token: m[0] });
  }
  return esiti;
}

function campiInXml(xml: string): Trovato[] {
  const runs = leggiRun(xml);
  return raggruppa(runs).flatMap((g) => trovaCampi(g.map((i) => runs[i]!.testo).join("")));
}

function sostituisciInXml(xml: string, valore: (campo: string) => string | undefined): string {
  const runs = leggiRun(xml);
  const caratteri = runs.map((r) => Array.from(r.testo));
  const modificati = new Set<number>();
  for (const gruppo of raggruppa(runs)) {
    const unito = gruppo.map((i) => runs[i]!.testo).join("");
    const inizi: number[] = [];
    let somma = 0;
    for (const i of gruppo) { inizi.push(somma); somma += caratteri[i]!.length; }
    const posizione = (g: number) => {
      let j = inizi.length - 1;
      while (j > 0 && inizi[j]! > g) j -= 1;
      return { run: gruppo[j]!, indice: g - inizi[j]! };
    };
    for (const t of trovaCampi(unito)) {
      const nuovo = t.campo ? valore(t.campo) : undefined;
      if (nuovo === undefined) continue;
      // gli indici di `unito` sono in unita' UTF-16: li riportiamo in simboli
      const da = Array.from(unito.slice(0, t.da)).length;
      const p = posizione(da);
      caratteri[p.run]![p.indice] = nuovo;
      modificati.add(p.run);
      for (let k = 1; k < t.lunghezza; k += 1) {
        const q = posizione(da + k);
        caratteri[q.run]![q.indice] = "";
        modificati.add(q.run);
      }
    }
  }
  let risultato = "";
  let cursore = 0;
  runs.forEach((r, i) => {
    risultato += xml.slice(cursore, r.inizio);
    if (modificati.has(i)) {
      const attributi = /xml:space=/.test(r.attributi) ? r.attributi : `${r.attributi} xml:space="preserve"`;
      risultato += `<w:t${attributi}>${escapa(caratteri[i]!.join(""))}</w:t>`;
    } else risultato += xml.slice(r.inizio, r.fine);
    cursore = r.fine;
  });
  return risultato + xml.slice(cursore);
}

async function apriModello(modello: Buffer): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(modello);
  } catch {
    throw new HttpError(400, "Il file non è un documento Word (.docx) valido.", "FILE_NON_VALIDO");
  }
  if (!zip.file("word/document.xml")) throw new HttpError(400, "Il file non è un documento Word (.docx) valido.", "FILE_NON_VALIDO");
  return zip;
}

/** Elenca i campi trovati nel modello. Quelli non riconosciuti sono restituiti a parte. */
export async function controllaModello(modello: Buffer): Promise<{ trovati: string[]; sconosciuti: string[] }> {
  const zip = await apriModello(modello);
  const trovati = new Set<string>();
  const sconosciuti = new Set<string>();
  for (const nome of Object.keys(zip.files).filter((n) => PARTI_XML.test(n))) {
    for (const c of campiInXml(await zip.file(nome)!.async("string"))) {
      const noto = c.campo ? NOTI.get(c.campo) : undefined;
      if (noto) trovati.add(noto); else sconosciuti.add(c.token);
    }
  }
  return { trovati: [...trovati], sconosciuti: [...sconosciuti] };
}

function valoreCampo(dati: DatiMandato, campo: string): string | undefined {
  const gruppo = campo.split(".")[0] as keyof DatiMandato;
  const noto = NOTI.get(campo)?.split(".")[1];
  if (!noto) return undefined;
  const g = dati[gruppo] as Record<string, string> | undefined;
  return g?.[noto] ?? "";
}

export async function compilaModello(modello: Buffer, dati: DatiMandato): Promise<Buffer> {
  const zip = await apriModello(modello);
  for (const nome of Object.keys(zip.files).filter((n) => PARTI_XML.test(n))) {
    const xml = await zip.file(nome)!.async("string");
    zip.file(nome, sostituisciInXml(xml, (c) => valoreCampo(dati, c)));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ---------------------------------------------------------------------------------------------
// Conversione in PDF (LibreOffice). Un solo processo alla volta: il profilo non e' condivisibile.
// ---------------------------------------------------------------------------------------------

let coda: Promise<unknown> = Promise.resolve();
const TEMPO_MASSIMO_MS = 120_000;

async function eseguiConversione(docx: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "mandato-"));
  try {
    const sorgente = path.join(dir, "mandato.docx");
    await writeFile(sorgente, docx);
    await new Promise<void>((ok, ko) => {
      const processo = spawn(
        process.env["SOFFICE_PATH"] ?? "soffice",
        ["--headless", "--norestore", "--nolockcheck", `-env:UserInstallation=file://${path.join(tmpdir(), "tutela-libreoffice")}`, "--convert-to", "pdf", "--outdir", dir, sorgente],
        { env: { ...process.env, TZ: "Europe/Rome", HOME: process.env["HOME"] ?? tmpdir() }, stdio: "ignore" },
      );
      const timer = setTimeout(() => { processo.kill("SIGKILL"); ko(new Error("Conversione del mandato troppo lenta")); }, TEMPO_MASSIMO_MS);
      processo.on("error", (e) => { clearTimeout(timer); ko(e); });
      processo.on("exit", (codice) => { clearTimeout(timer); if (codice === 0) ok(); else ko(new Error(`LibreOffice terminato con codice ${codice}`)); });
    });
    return await readFile(path.join(dir, "mandato.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function convertiInPdf(docx: Buffer): Promise<Buffer> {
  const lavoro = coda.then(() => eseguiConversione(docx));
  coda = lavoro.catch(() => undefined);
  return lavoro.catch((err) => {
    logger.error({ err }, "Conversione del mandato in PDF non riuscita");
    throw new HttpError(503, "Non è stato possibile preparare il mandato in PDF. Riprova tra poco.", "MANDATO_NON_GENERATO");
  });
}

// ---------------------------------------------------------------------------------------------
// Dati dell'assistito
// ---------------------------------------------------------------------------------------------

const dataIt = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

/** L'indirizzo e' un campo unico: se termina con un numero civico lo separiamo, cosi' il modello puo' scriverli in due punti. */
export function dividiIndirizzo(indirizzo: string | null): { via: string; civico: string } {
  const t = (indirizzo ?? "").trim();
  const m = /^(.*\S)\s*,?\s+(\d+\s?[A-Za-z]?(?:\s?\/\s?[0-9A-Za-z]+)?)$/.exec(t);
  return m ? { via: m[1]!, civico: m[2]!.trim() } : { via: t, civico: "" };
}

export async function datiMandato(assistitoId: number, tipoPratica: string): Promise<DatiMandato> {
  const [r] = await db
    .select({
      cognome: personeTable.cognome, nome: personeTable.nome, nascita: personeTable.dataNascita, sesso: personeTable.sesso,
      luogoNascita: personeTable.luogoNascitaNome, cf: personeTable.codiceFiscale, tel: personeTable.telefono, cell: personeTable.cellulare,
      email: personeTable.email, nazione: personeTable.nazionalitaNome, citta: assistitiTable.citta, indirizzo: assistitiTable.indirizzo,
      cap: assistitiTable.cap, provincia: assistitiTable.provincia,
    })
    .from(assistitiTable)
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .where(eq(assistitiTable.id, assistitoId));
  if (!r) throw new HttpError(404, "Assistito non trovato.", "NON_TROVATO");
  const ind = dividiIndirizzo(r.indirizzo);
  return {
    cliente: {
      cognome: r.cognome, nome: r.nome, nascita: dataIt(String(r.nascita)), sesso: r.sesso, luogoNascita: r.luogoNascita, cf: r.cf,
      tel: r.tel ?? "", cell: r.cell, email: r.email ?? "", indirizzo: ind.via, civico: ind.civico, cap: r.cap ?? "", citta: r.citta, provincia: r.provincia ?? "",
      nazione: r.nazione,
    },
    richiesta: { tipo: tipoPratica },
    polizza: { tipo: "" },
  };
}

async function inBuffer(stream: Readable): Promise<Buffer> {
  const pezzi: Buffer[] = [];
  for await (const p of stream) pezzi.push(Buffer.isBuffer(p) ? p : Buffer.from(p));
  return Buffer.concat(pezzi);
}

export const nomePdfMandato = (p: { numero: number | null; assNome: string; assCognome: string }) =>
  `Mandato${p.numero ? ` pratica ${p.numero}` : ""} - ${p.assCognome} ${p.assNome}.pdf`.replace(/[\\/:*?"<>|]/g, "_");

/** PDF del mandato (modello della sede) compilato con i dati dell'assistito della pratica. */
export async function mandatoCompilatoPdf(
  p: { assistitoId: number; tipoNome: string; numero: number | null; assNome: string; assCognome: string },
  fileChiave: string,
): Promise<{ pdf: Buffer; nomeFile: string }> {
  const [modello, dati] = await Promise.all([leggiFile(fileChiave).then((f) => inBuffer(f.stream)), datiMandato(p.assistitoId, p.tipoNome)]);
  const pdf = await convertiInPdf(await compilaModello(modello, dati));
  return { pdf, nomeFile: nomePdfMandato(p) };
}
