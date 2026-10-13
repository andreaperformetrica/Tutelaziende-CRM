/** PDF del questionario creato nel sistema: domande con caselle da spuntare o righe per la risposta aperta (A4 verticale). */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DomandaQuestionario } from "@workspace/db";
import { testoStampabile } from "./attestati";
import { incorporaLogo } from "./compensi-pdf";
import { leggiImpostazioniStampa } from "./compensi";
import { formattaData } from "./eventi";

const L = 595.28;
const A = 841.89;
const M = 48;
const LARGHEZZA = L - 2 * M;
const NERO = rgb(0, 0, 0);
const GRIGIO = rgb(0.6, 0.6, 0.6);
const RIGA = 22;

export async function generaQuestionarioPdf(evento: { titolo: string; data: string; luogo: string }, domande: DomandaQuestionario[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { logo } = await leggiImpostazioniStampa();
  const img = await incorporaLogo(doc, logo);

  const pulito = (f: PDFFont, t: string) => testoStampabile(f, t);
  const larg = (f: PDFFont, t: string, dim: number) => f.widthOfTextAtSize(pulito(f, t), dim);
  const righe = (f: PDFFont, t: string, dim: number, max: number): string[] => {
    const out: string[] = [];
    let cur = "";
    for (const parola of t.split(/\s+/).filter(Boolean)) {
      const prova = cur ? `${cur} ${parola}` : parola;
      if (larg(f, prova, dim) > max && cur) { out.push(cur); cur = parola; } else cur = prova;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };

  let pagina: PDFPage = doc.addPage([L, A]);
  let y = A - M;
  const testo = (t: string, x: number, yy: number, dim: number, f: PDFFont = reg) => pagina.drawText(pulito(f, t), { x, y: yy, size: dim, font: f, color: NERO });
  const nuovaPagina = () => { pagina = doc.addPage([L, A]); y = A - M; };
  const spazio = (h: number) => { if (y - h < M + 24) nuovaPagina(); };

  // Intestazione
  if (img) {
    const scala = Math.min(160 / img.width, 40 / img.height);
    const w = img.width * scala;
    const h = img.height * scala;
    pagina.drawImage(img, { x: M, y: y - h, width: w, height: h });
    y -= h + 14;
  }
  testo("Questionario", M, y - 14, 18, bold);
  y -= 30;
  for (const r of righe(bold, evento.titolo, 12, LARGHEZZA)) { testo(r, M, y - 10, 12, bold); y -= 16; }
  testo(`${formattaData(evento.data)} · ${evento.luogo}`, M, y - 10, 10);
  y -= 16;
  pagina.drawLine({ start: { x: M, y: y - 4 }, end: { x: L - M, y: y - 4 }, thickness: 1, color: NERO });
  y -= 26;

  domande.forEach((d, i) => {
    const numero = `${i + 1}.`;
    const rientro = 20;
    const testate = righe(bold, d.testo, 11, LARGHEZZA - rientro);
    const primaSottovoce = d.tipo === "scelta" ? 18 : RIGA;
    spazio(testate.length * 15 + primaSottovoce + 6);
    testo(numero, M, y - 11, 11, bold);
    for (const r of testate) { testo(r, M + rientro, y - 11, 11, bold); y -= 15; }
    y -= 4;
    if (d.tipo === "scelta") {
      for (const o of d.opzioni) {
        const linee = righe(reg, o, 10.5, LARGHEZZA - rientro - 22);
        spazio(linee.length * 14 + 6);
        pagina.drawRectangle({ x: M + rientro, y: y - 11, width: 11, height: 11, borderColor: NERO, borderWidth: 1 });
        for (const r of linee) { testo(r, M + rientro + 20, y - 10, 10.5); y -= 14; }
        y -= 4;
      }
    } else {
      for (let k = 0; k < d.righe; k += 1) {
        spazio(RIGA);
        pagina.drawLine({ start: { x: M + rientro, y: y - RIGA + 6 }, end: { x: L - M, y: y - RIGA + 6 }, thickness: 0.6, color: GRIGIO });
        y -= RIGA;
      }
    }
    y -= 14;
  });

  const pagine = doc.getPages();
  pagine.forEach((p, i) => {
    const t = pulito(reg, `Pagina ${i + 1} di ${pagine.length}`);
    p.drawText(t, { x: L - M - reg.widthOfTextAtSize(t, 8), y: M - 20, size: 8, font: reg, color: GRIGIO });
  });
  return Buffer.from(await doc.save());
}
