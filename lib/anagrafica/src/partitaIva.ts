/** Toglie spazi e un eventuale prefisso "IT"; restituisce solo le cifre (o il testo ripulito se non numerico). */
export function normalizzaPartitaIva(valore: string): string {
  return valore.replace(/\s+/g, "").replace(/^IT/i, "");
}

/** Partita IVA italiana: 11 cifre, con carattere di controllo (algoritmo di Luhn). */
export function partitaIvaValida(valore: string): boolean {
  const v = normalizzaPartitaIva(valore);
  if (!/^\d{11}$/.test(v)) return false;
  let somma = 0;
  for (let i = 0; i < 11; i++) {
    let c = Number(v[i]);
    if (i % 2 === 1) {
      c *= 2;
      if (c > 9) c -= 9;
    }
    somma += c;
  }
  return somma % 10 === 0;
}
