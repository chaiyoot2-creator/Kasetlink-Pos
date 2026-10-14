const TERMINAL_KEY = 'kasetlink.terminalId'
const LOCATION_KEY = 'kasetlink.locationId'

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private mode / blocked storage: the id simply lives for this page load.
  }
}

let memoryTerminalId: string | null = null

/** Stable id of this device (computer / tablet / phone). Every event carries it as terminal_id. */
export function getTerminalId(): string {
  const stored = safeGet(TERMINAL_KEY)
  if (stored) return stored
  if (!memoryTerminalId) {
    memoryTerminalId = `T-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
    safeSet(TERMINAL_KEY, memoryTerminalId)
  }
  return memoryTerminalId
}

export function getSavedLocationId(): string | null {
  return safeGet(LOCATION_KEY)
}

export function saveLocationId(id: string): void {
  safeSet(LOCATION_KEY, id)
}

/** Envelope for every stock- or bill-affecting command (event_id, terminal_id, time). */
export function newEvent(): { eventId: string; terminalId: string; occurredAt: string } {
  return { eventId: crypto.randomUUID(), terminalId: getTerminalId(), occurredAt: new Date().toISOString() }
}
