/** Ricevuta di un collaboratore (PDF A4 verticale), costruita dai dati copiati nella ricevuta al momento della creazione. */
import { rgb } from "pdf-lib";
import { testoStampabile } from "./attestati";
import { euro } from "./compensi";
import { nuovoDocumento } from "./compensi-pdf";
import { formattaData } from "./eventi";
import { caricaRicevuta, importoInLettere, type DatiRicevuta } from "./ricevute";

const ROSSO = rgb(0.78, 0.08, 0.1);
const H = 841.89;
const W = 595.28;
const M = 56;

const importo = (centesimi: number) => euro(centesimi).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function conPrefisso(prefisso: string, valore: string): string {
  return valore.toLowerCase().startsWith(prefisso.toLowerCase()) ? valore : `${prefisso} ${valore}`;
}

export async function pdfRicevuta(id: number): Promise<{ pdf: Buffer; nomeFile: string }> {
  const { r } = await caricaRicevuta(id);
  const d = JSON.parse(r.dati) as DatiRicevuta;
  const { doc, w } = await nuovoDocumento();
  const p = doc.addPage([W, H]);

  // In alto a sinistra: il collaboratore.
  let y = H - 120;
  w.testo(p, d.collaboratore.denominazione, M, y, 11.5, { bold: true, max: 270 });
  for (const riga of [d.collaboratore.indirizzo, d.collaboratore.capComune, d.collaboratore.codiceFiscale ? `Codice fiscale ${d.collaboratore.codiceFiscale}` : ""]) {
    if (!riga) continue;
    y -= 16;
    w.testo(p, riga, M, y, 11, { max: 270 });
  }

  // A destra: il patronato.
  y = H - 215;
  const xP = 340;
  w.testo(p, d.patronato.nome, xP, y, 11.5, { bold: true, max: W - M - xP });
  for (const riga of [d.patronato.indirizzo, d.patronato.capCitta, d.patronato.codiceFiscale ? `C.F. ${d.patronato.codiceFiscale}` : ""]) {
    if (!riga) continue;
    y -= 16;
    w.testo(p, riga, xP, y, 11, { max: W - M - xP });
  }

  // Titolo.
  y = H - 330;
  const titolo = testoStampabile(w.f.b, `Ricevuta ${r.numero} del ${formattaData(r.dataRicevuta)}`);
  p.drawText(titolo, { x: M, y, size: 13, font: w.f.b, color: ROSSO });

  // Testo.
  y -= 40;
  const corpo = `${d.collaboratore.denominazione} riceve dal ${d.patronato.nome} la somma di euro ${importo(r.totaleCentesimi)} (${importoInLettere(r.totaleCentesimi)}) relativa a ${d.causale}.`;
  for (const riga of w.righe(corpo, 11, W - 2 * M)) {
    w.testo(p, riga, M, y, 11);
    y -= 17;
  }
  if (r.ivaCentesimi > 0 || r.aliquotaIva !== null) {
    y -= 4;
    w.testo(p, `Imponibile euro ${importo(r.imponibileCentesimi)} - IVA ${String(r.aliquotaIva).replace(".", ",")}% euro ${importo(r.ivaCentesimi)} - Totale euro ${importo(r.totaleCentesimi)}`, M, y, 11, { bold: true });
    y -= 17;
  }

  y -= 14;
  for (const riga of w.righe(`${d.fraseBonifico}:`, 11, W - 2 * M)) {
    w.testo(p, riga, M, y, 11);
    y -= 17;
  }
  y -= 4;
  if (d.collaboratore.banca) {
    w.testo(p, conPrefisso("Banca", d.collaboratore.banca), M, y, 11, { max: W - 2 * M });
    y -= 17;
  }
  if (d.collaboratore.filiale) {
    w.testo(p, conPrefisso("Filiale di", d.collaboratore.filiale), M, y, 11, { max: W - 2 * M });
    y -= 17;
  }
  w.testo(p, `Iban ${d.collaboratore.iban}`, M, y, 11, { bold: true });

  // Firma.
  y -= 70;
  const xF = W - M;
  w.testo(p, "Il Presidente", xF - 115, y, 11, { align: "center" });
  y -= 42;
  p.drawLine({ start: { x: xF - 230, y }, end: { x: xF, y }, thickness: 0.8, color: rgb(0, 0, 0) });

  const pdf = Buffer.from(await doc.save());
  return { pdf, nomeFile: `ricevuta-${r.numero}-${r.anno}.pdf` };
}
