/** Utilitaires communs aux backends LLM. */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`délai dépassé (${ms} ms)`);
    this.name = 'TimeoutError';
  }
}

/** Rejette si `p` ne se résout pas en moins de `ms` millisecondes (`onTimeout` permet d'annuler). */
export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError(ms));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Taille lisible (Mo / Go) pour la demande de consentement. */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} Go`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} Mo`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} ko`;
  return `${n} o`;
}
