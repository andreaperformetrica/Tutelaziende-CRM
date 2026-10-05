/**
 * Normalizza un numero di telefono nel formato internazionale (+39333...).
 * Restituisce null se il numero non e' plausibile.
 */
export function normalizzaTelefono(valore: string): string | null {
  let numero = valore.trim().replace(/[\s.\-()/]/g, "");
  if (numero.startsWith("00")) numero = `+${numero.slice(2)}`;
  if (!numero.startsWith("+")) {
    // Numero senza prefisso: si assume italiano.
    numero = `+39${numero}`;
  }
  if (!/^\+\d{8,15}$/.test(numero)) return null;
  return numero;
}
