/** Printer settings live per device: each computer/tablet has its own printer. */

export type PaperSize = '58' | '80' | 'a4'

export interface PrintPrefs {
  paper: PaperSize
  /** Print the receipt right after a bill is saved. */
  autoPrint: boolean
}

const KEY = 'kasetlink.printPrefs'
const DEFAULTS: PrintPrefs = { paper: '80', autoPrint: false }

export const PAPER_LABEL: Record<PaperSize, string> = {
  '58': 'กระดาษม้วน 58 มม.',
  '80': 'กระดาษม้วน 80 มม.',
  a4: 'กระดาษ A4 / A5',
}

export function getPrintPrefs(): PrintPrefs {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS }
    const p = parsed as { paper?: unknown; autoPrint?: unknown }
    return {
      paper: p.paper === '58' || p.paper === '80' || p.paper === 'a4' ? p.paper : DEFAULTS.paper,
      autoPrint: p.autoPrint === true,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePrintPrefs(prefs: PrintPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Storage blocked: settings apply for this session only.
  }
}

/** Open the browser print dialog once the print portal has rendered. */
export function printSoon(): void {
  window.setTimeout(() => window.print(), 150)
}
