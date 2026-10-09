import QRCode from "qrcode";

/** QR code come immagine (data URL) per mostrarlo a schermo. */
export function qrDataUrl(contenuto: string, lato = 240): Promise<string> {
  return QRCode.toDataURL(contenuto, { margin: 1, width: lato, errorCorrectionLevel: "M" });
}

function righe(ctx: CanvasRenderingContext2D, testo: string, larghezzaMax: number): string[] {
  const parole = testo.split(" ");
  const out: string[] = [];
  let corrente = "";
  for (const p of parole) {
    const prova = corrente ? `${corrente} ${p}` : p;
    if (ctx.measureText(prova).width > larghezzaMax && corrente) { out.push(corrente); corrente = p; } else corrente = prova;
  }
  if (corrente) out.push(corrente);
  return out.slice(0, 3);
}

/** Cartellino PNG da scaricare e stampare: titolo dell'evento, QR code e nome del partecipante. */
export async function cartellinoPng(contenuto: string, titolo: string, dataEvento: string, nome: string): Promise<Blob> {
  const L = 640, H = 820;
  const canvas = document.createElement("canvas");
  canvas.width = L;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, L, H);
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, L - 20, H - 20);
  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.font = "bold 34px sans-serif";
  const t = righe(ctx, titolo, L - 100);
  t.forEach((r, i) => ctx.fillText(r, L / 2, 70 + i * 42));
  ctx.font = "24px sans-serif";
  ctx.fillStyle = "#4b5563";
  ctx.fillText(dataEvento, L / 2, 70 + t.length * 42 + 10);
  const img = new Image();
  img.src = await qrDataUrl(contenuto, 480);
  await new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error("QR non generato")); });
  ctx.drawImage(img, (L - 480) / 2, 210, 480, 480);
  ctx.fillStyle = "#111827";
  ctx.font = "bold 38px sans-serif";
  const n = righe(ctx, nome, L - 80);
  n.forEach((r, i) => ctx.fillText(r, L / 2, 745 + i * 44 - (n.length - 1) * 22));
  return new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("Immagine non generata"))), "image/png"));
}

export function scaricaBlob(blob: Blob, nomeFile: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
