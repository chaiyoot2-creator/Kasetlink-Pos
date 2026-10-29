const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

/** Read a whole number below one million in Thai (เอ็ด / ยี่ rules). */
function readBelowMillion(n: number): string {
  const digits = String(n).split('').map(Number)
  const len = digits.length
  let out = ''
  digits.forEach((d, i) => {
    const place = len - i - 1
    if (d === 0) return
    if (place === 0 && d === 1 && len > 1) out += 'เอ็ด'
    else if (place === 1 && d === 1) out += 'สิบ'
    else if (place === 1 && d === 2) out += 'ยี่สิบ'
    else out += DIGITS[d] + PLACES[place]
  })
  return out
}

function readInteger(n: number): string {
  if (n === 0) return DIGITS[0] ?? 'ศูนย์'
  const millions = Math.floor(n / 1_000_000)
  const rest = n % 1_000_000
  return (millions > 0 ? readInteger(millions) + 'ล้าน' : '') + (rest > 0 ? readBelowMillion(rest) : '')
}

/** 1070.5 → "หนึ่งพันเจ็ดสิบบาทห้าสิบสตางค์", 535 → "ห้าร้อยสามสิบห้าบาทถ้วน" */
export function bahtText(amount: number): string {
  const satangTotal = Math.round(Math.abs(amount) * 100)
  const baht = Math.floor(satangTotal / 100)
  const satang = satangTotal % 100
  const prefix = amount < 0 ? 'ลบ' : ''
  if (baht === 0 && satang > 0) return `${prefix}${readInteger(satang)}สตางค์`
  return `${prefix}${readInteger(baht)}บาท${satang > 0 ? `${readInteger(satang)}สตางค์` : 'ถ้วน'}`
}
