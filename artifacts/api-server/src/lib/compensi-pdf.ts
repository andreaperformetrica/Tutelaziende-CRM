/** Stampati dei compensi: estratto pratiche chiuse e dare/avere (PDF A4 orizzontale). */
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { db, estrattiRigheTable, estrattiTable } from "@workspace/db";
import { testoStampabile } from "./attestati";
import { dareAvere, elencoEstratti, leggiImpostazioniStampa, nomeCompleto, type LogoStampa } from "./compensi";
import { nonTrovato } from "./errori";
import { formattaData, oggiRoma } from "./eventi";
import { leggiFile } from "./storage";

const L = 841.89;
const A = 595.28;
const M = 36;
const NERO = rgb(0, 0, 0);
const GRIGIO = rgb(0.85, 0.85, 0.85);
const GRIGIO_SCURO = rgb(0.6, 0.6, 0.6);

export const formatoEuro = (v: number) => `€ ${v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Font {
  r: PDFFont;
  b: PDFFont;
}

class Scrittore {
  constructor(
    public doc: PDFDocument,
    public f: Font,
  ) {}
  testo(p: PDFPage, t: string, x: number, y: number, dim: number, opz: { bold?: boolean; align?: "left" | "right" | "center"; max?: number } = {}) {
    const font = opz.bold ? this.f.b : this.f.r;
    let s = testoStampabile(font, t);
    if (opz.max) while (s.length > 1 && font.widthOfTextAtSize(s, dim) > opz.max) s = `${s.slice(0, -2).trimEnd()}.`;
    const w = font.widthOfTextAtSize(s, dim);
    const px = opz.align === "right" ? x - w : opz.align === "center" ? x - w / 2 : x;
    p.drawText(s, { x: px, y, size: dim, font, color: NERO });
    return w;
  }
  larghezza(t: string, dim: number, bold = false) {
    const font = bold ? this.f.b : this.f.r;
    return font.widthOfTextAtSize(testoStampabile(font, t), dim);
  }
  /** Va a capo per rientrare nella larghezza massima. */
  righe(t: string, dim: number, max: number, bold = false): string[] {
    const out: string[] = [];
    let cur = "";
    for (const parola of t.split(/\s+/).filter(Boolean)) {
      const prova = cur ? `${cur} ${parola}` : parola;
      if (this.larghezza(prova, dim, bold) > max && cur) {
        out.push(cur);
        cur = parola;
      } else cur = prova;
    }
    if (cur) out.push(cur);
    return out;
  }
}

async function nuovoDocumento() {
  const doc = await PDFDocument.create();
  const f = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold) };
  return { doc, w: new Scrittore(doc, f) };
}

async function incorporaLogo(doc: PDFDocument, logo: LogoStampa | null): Promise<PDFImage | null> {
  if (!logo) return null;
  try {
    const { stream } = await leggiFile(logo.chiave);
    const pezzi: Buffer[] = [];
    for await (const c of stream) pezzi.push(Buffer.from(c as Uint8Array));
    const buf = Buffer.concat(pezzi);
    return logo.tipo === "image/png" ? await doc.embedPng(buf) : await doc.embedJpg(buf);
  } catch {
    return null; // un logo non leggibile non deve impedire la stampa
  }
}

// ---------------------------------------------------------------------------------------------
// Estratto pratiche chiuse
// ---------------------------------------------------------------------------------------------

export async function pdfEstratto(id: number): Promise<{ pdf: Buffer; nomeFile: string }> {
  const [riepilogo] = await elencoEstratti({ id });
  if (!riepilogo) throw nonTrovato("Estratto non trovato.");
  const righe = await db.select().from(estrattiRigheTable).where(eq(estrattiRigheTable.estrattoId, id)).orderBy(estrattiRigheTable.ordine);
  const [e] = await db.select().from(estrattiTable).where(eq(estrattiTable.id, id));
  const { dati, logo } = await leggiImpostazioniStampa();
  const { doc, w } = await nuovoDocumento();
  const img = await incorporaLogo(doc, logo);

  const X = { assistito: M + 4, numero: 247, tipo: 333, data: 633, punti: 703, ristorno: L - M - 2 };
  const titolo = `${riepilogo.collaboratoreNome.toUpperCase()} · Sportello ${riepilogo.numeroSportello}`;
  const ALTEZZA_RIGA = 17;
  const nota = (t: string) => w.righe(t, 10, L - 2 * M);
  const note = [dati.nota1, dati.nota2].filter((n) => n.trim()).map(nota);
  const altezzaPiede = 40 + 22 + note.reduce((t, n) => t + n.length * 13 + 8, 0) + 20;

  const pagine: PDFPage[] = [];
  const nuovaPagina = (prima: boolean): number => {
    const p = doc.addPage([L, A]);
    pagine.push(p);
    let y = A - M;
    if (prima) {
      const lato = 56;
      if (img) {
        const s = Math.min(lato / img.width, lato / img.height);
        p.drawImage(img, { x: M, y: y - img.height * s, width: img.width * s, height: img.height * s });
      }
      const x0 = M + (img ? lato + 14 : 0);
      w.testo(p, dati.nome.toUpperCase(), x0, y - 16, 20, { bold: true, max: L / 2 - x0 });
      if (dati.motto) w.testo(p, dati.motto, x0, y - 32, 10, { max: L / 2 - x0 });
      const dx = L - M;
      w.testo(p, dati.nome.toUpperCase(), dx, y - 12, 12, { bold: true, align: "right", max: L / 2 - M });
      let yy = y - 26;
      if (dati.indirizzo) {
        w.testo(p, dati.indirizzo, dx, yy, 10, { align: "right", max: L / 2 - M });
        yy -= 13;
      }
      const contatti = [dati.telefono ? `Tel ${dati.telefono}` : "", dati.email ? `mail: ${dati.email}` : ""].filter(Boolean).join("  ");
      if (contatti) w.testo(p, contatti, dx, yy, 10, { align: "right", max: L / 2 - M });
      y -= lato + 8;
      p.drawLine({ start: { x: M, y }, end: { x: L - M, y }, thickness: 1, color: NERO });
      y -= 30;
      w.testo(p, "ESTRATTO PRATICHE CHIUSE", L / 2, y, 16, { bold: true, align: "center" });
      y -= 30;
    } else {
      w.testo(p, "ESTRATTO PRATICHE CHIUSE", M, y - 10, 12, { bold: true });
      y -= 34;
    }
    const wt = w.testo(p, titolo, M, y, 14, { bold: true });
    p.drawLine({ start: { x: M, y: y - 3 }, end: { x: M + wt, y: y - 3 }, thickness: 1, color: NERO });
    y -= 26;
    const h = (t: string, x: number, align: "left" | "right" | "center" = "left") => w.testo(p, t, x, y, 10, { bold: true, align });
    h("Assistito", X.assistito);
    h("Numero Pratica", X.numero);
    h("Tipo di Pratica", X.tipo);
    h("Data Pratica", X.data, "center");
    h("Punti", X.punti, "center");
    h("Ristorno", X.ristorno, "right");
    p.drawLine({ start: { x: M, y: y - 5 }, end: { x: L - M, y: y - 5 }, thickness: 0.5, color: GRIGIO_SCURO });
    return y - 5 - ALTEZZA_RIGA;
  };

  let y = nuovaPagina(true);
  let p = pagine[0]!;
  for (const r of righe) {
    if (y < M + 30) {
      y = nuovaPagina(false);
      p = pagine[pagine.length - 1]!;
    }
    w.testo(p, r.assistito.toUpperCase(), X.assistito, y, 10.5, { max: X.numero - X.assistito - 8 });
    w.testo(p, String(r.numeroPratica), X.numero, y, 10.5);
    w.testo(p, r.tipoPratica.toUpperCase(), X.tipo, y, 10.5, { max: X.data - 40 - X.tipo });
    w.testo(p, r.dataPratica ? formattaData(r.dataPratica) : "—", X.data, y, 10.5, { align: "center" });
    w.testo(p, String(r.punti), X.punti, y, 10.5, { align: "center" });
    w.testo(p, formatoEuro(r.valoreCentesimi / 100), X.ristorno, y, 10.5, { align: "right" });
    y -= ALTEZZA_RIGA;
  }
  if (righe.length === 0) w.testo(p, "Nessuna pratica.", X.assistito, y, 10.5);

  if (y - altezzaPiede < M + 14) {
    y = nuovaPagina(false);
    p = pagine[pagine.length - 1]!;
  }
  y -= 6;
  p.drawLine({ start: { x: M, y }, end: { x: L - M, y }, thickness: 1, color: NERO });
  y -= 24;
  w.testo(p, `Totale Punti ${e!.totalePunti}`, X.assistito, y, 14, { bold: true });
  const testoTot = `Totale Ristorno ${formatoEuro(e!.totaleCentesimi / 100)}`;
  const wTot = w.testo(p, testoTot, L - M - 2, y, 14, { bold: true, align: "right" });
  p.drawLine({ start: { x: L - M - 2 - wTot, y: y - 3 }, end: { x: L - M - 2, y: y - 3 }, thickness: 1, color: NERO });
  y -= 24;
  w.testo(p, `Stampato in data: ${formattaData(e!.dataEstratto)}`, M, y, 8, { bold: true });
  y -= 22;
  for (const par of note) {
    for (const riga of par) {
      w.testo(p, riga, M, y, 10);
      y -= 13;
    }
    y -= 8;
  }
  pagine.forEach((pg, i) => w.testo(pg, `Pagina ${i + 1} di ${pagine.length}`, L - M, M - 14, 9, { align: "right" }));
  const pdf = Buffer.from(await doc.save());
  const nomeFile = `estratto-${riepilogo.id}-${riepilogo.collaboratoreNome.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
  return { pdf, nomeFile };
}

// ---------------------------------------------------------------------------------------------
// Dare/avere
// ---------------------------------------------------------------------------------------------

export async function pdfDareAvere(collaboratoreId: number, anno: number): Promise<{ pdf: Buffer; nomeFile: string }> {
  const d = await dareAvere(collaboratoreId, anno);
  const { doc, w } = await nuovoDocumento();
  const larghezzaTab = L - 2 * M;
  // Descrizione, "euro", importo, data pagamento, note.
  const col = [0, 0.2, 0.36, 0.52, 0.7, 1].map((q) => M + q * larghezzaTab);
  const H = 20;
  const titolo = `${d.collaboratoreNome}  Sportello ${d.numeroSportello}`;
  const pagine: PDFPage[] = [];
  let p!: PDFPage;
  let y = 0;

  const cella = (t: string, c: number, opz: { bold?: boolean; align?: "left" | "right" | "center"; dim?: number } = {}) => {
    const x0 = col[c]!;
    const x1 = col[c + 1]!;
    const dim = opz.dim ?? 11;
    const x = opz.align === "center" ? (x0 + x1) / 2 : opz.align === "right" ? x1 - 6 : x0 + 6;
    w.testo(p, t, x, y - 14, dim, { bold: opz.bold, align: opz.align, max: x1 - x0 - 12 });
  };
  const bordiRiga = (fill?: ReturnType<typeof rgb>) => {
    if (fill) p.drawRectangle({ x: col[0]!, y: y - H, width: larghezzaTab, height: H, color: fill });
    p.drawRectangle({ x: col[0]!, y: y - H, width: larghezzaTab, height: H, borderColor: NERO, borderWidth: 0.7 });
    for (let i = 1; i < col.length - 1; i++) p.drawLine({ start: { x: col[i]!, y }, end: { x: col[i]!, y: y - H }, thickness: 0.7, color: NERO });
  };
  const nuovaPagina = () => {
    p = doc.addPage([L, A]);
    pagine.push(p);
    y = A - M;
    p.drawRectangle({ x: col[0]!, y: y - 30, width: larghezzaTab, height: 30, borderColor: NERO, borderWidth: 0.7 });
    w.testo(p, titolo, L / 2, y - 21, 16, { bold: true, align: "center" });
    y -= 30;
  };
  const serve = (righe: number) => {
    if (y - righe * H < M + 16) nuovaPagina();
  };

  nuovaPagina();
  for (const s of d.sezioni) {
    serve(Math.min(3, s.righe.length + 1));
    bordiRiga(GRIGIO);
    cella(s.titolo, 0, { bold: true, align: "center" });
    p.drawLine({ start: { x: col[1]!, y }, end: { x: col[1]!, y: y - H }, thickness: 0.7, color: GRIGIO });
    cella("Ricevuta", 2, { bold: true, align: "center" });
    cella("Data Pagamento", 3, { bold: true, align: "center" });
    cella(String(anno), 4, { bold: true, align: "center" });
    y -= H;
    const righe = s.righe.length ? s.righe : [null];
    for (const r of righe) {
      serve(1);
      bordiRiga();
      if (r) {
        cella(r.descrizione, 0);
        cella("euro", 1, { align: "center" });
        cella(formatoEuro(r.importoEuro), 2, { align: "right" });
        cella(r.riferimento ?? (r.dataPagamento ? formattaData(r.dataPagamento) : ""), 3, { align: "center" });
        cella(r.nota, 4, { dim: 10 });
      }
      y -= H;
    }
    if (s.righe.length) {
      serve(1);
      bordiRiga();
      cella(s.sezione === "debiti" ? "Totale debiti" : "Totale", 0, { bold: true });
      cella("euro", 1, { align: "center" });
      cella(formatoEuro(s.totaleEuro), 2, { bold: true, align: "right" });
      y -= H;
    }
  }
  serve(1);
  bordiRiga(GRIGIO);
  cella("Totale", 0, { bold: true });
  cella("euro avere", 1, { bold: true, align: "center" });
  cella(formatoEuro(d.totaleAvereEuro), 2, { bold: true, align: "right" });
  y -= H;
  w.testo(p, `Stampato in data: ${formattaData(oggiRoma())}`, M, y - 18, 8, { bold: true });
  pagine.forEach((pg, i) => w.testo(pg, `Pagina ${i + 1} di ${pagine.length}`, L - M, M - 14, 9, { align: "right" }));
  const pdf = Buffer.from(await doc.save());
  return { pdf, nomeFile: `dare-avere-${anno}-${nomeCompleto(d.collaboratoreNome, "").replace(/[^A-Za-z0-9]+/g, "-")}.pdf` };
}
