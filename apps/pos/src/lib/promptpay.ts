/**
 * Thai PromptPay QR payload (EMVCo merchant-presented, BOT spec).
 * Mobile numbers (10 digits), national / tax IDs (13) and e-wallet IDs (15) are supported.
 */

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

function crc16(data: string): string {
  let crc = 0xffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function accountTag(id: string): string {
  const digits = id.replace(/\D/g, '')
  if (digits.length === 15) return tlv('03', digits)
  if (digits.length === 13) return tlv('02', digits)
  if (digits.length === 10 && digits.startsWith('0')) return tlv('01', `0066${digits.slice(1)}`.padStart(13, '0'))
  throw new Error('รูปแบบพร้อมเพย์ไม่ถูกต้อง')
}

export function promptPayPayload(id: string, amount?: number): string {
  const merchant = tlv('29', tlv('00', 'A000000677010111') + accountTag(id))
  let payload =
    tlv('00', '01') +
    tlv('01', amount ? '12' : '11') +
    merchant +
    tlv('58', 'TH') +
    tlv('53', '764')
  if (amount && amount > 0) payload += tlv('54', amount.toFixed(2))
  payload += '6304'
  return payload + crc16(payload)
}

export function isValidPromptPayId(id: string | null | undefined): boolean {
  if (!id) return false
  const d = id.replace(/\D/g, '')
  return (d.length === 10 && d.startsWith('0')) || d.length === 13 || d.length === 15
}
