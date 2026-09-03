/**
 * The only stage that touches the browser to trigger a file download:
 * blob + object URL + synthetic click, URL revoked immediately after.
 */

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** `YYYYMMDD-HHmmss`, in local time. Pure and testable on its own. */
export function formatTimestamp(d: Date): string {
  const YYYY = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const DD = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${YYYY}${MM}${DD}-${hh}${mm}${ss}`;
}

export function svgFilename(generator: string, seed: number, when: Date = new Date()): string {
  return `${generator}_${seed}_${formatTimestamp(when)}.svg`;
}

export function downloadSvg(svgContent: string, generator: string, seed: number, when: Date = new Date()): void {
  const filename = svgFilename(generator, seed, when);
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}
