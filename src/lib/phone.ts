// Telefon raqam utility'lari — barcha API va UI'lar uchun umumiy

// Telefon raqamni normallashtirish: faqat raqamlar, UZ kodini qo'shamiz
// "+998 90 123 45 67" | "901234567" | "998901234567" | "8 90 123 45 67" → "+998901234567"
export function normalizePhone(raw: string): string | null {
  let d = String(raw || '').replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('8') && d.length === 10) d = '998' + d.slice(1) // 8 90 123 45 67
  if (d.length === 9) d = '998' + d // faqat operator kodi kiritilgan
  if (d.length !== 12 || !d.startsWith('998')) return null
  return '+' + d
}

// Qidiruv uchun: faqat raqamlar (tel: 901234567 yoki 998901234567)
export function phoneDigits(raw: string): string {
  return String(raw || '').replace(/\D/g, '')
}

// Ko'rinish: +998901234567 → +998 90 123 45 67
export function formatPhone(raw: string): string {
  const d = phoneDigits(raw)
  if (d.length !== 12) return raw
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`
}
