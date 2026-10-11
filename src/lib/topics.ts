// UzbekGram mavzular ro’yxati (seed va UI uchun umumiy)

export interface TopicDef {
  slug: string
  name: string
  emoji: string
}

export const TOPICS: TopicDef[] = [
  { slug: 'sport', name: 'Sport', emoji: '⚽' },
  { slug: 'texnologiya', name: 'Texnologiya', emoji: '💻' },
  { slug: 'kino', name: 'Kino va serial', emoji: '🎬' },
  { slug: 'musiqa', name: 'Musiqa', emoji: '🎵' },
  { slug: 'biznes', name: 'Biznes', emoji: '💼' },
  { slug: 'sayohat', name: 'Sayohat', emoji: '✈️' },
  { slug: 'ovqat', name: 'Ovqat', emoji: '🍽️' },
  { slug: 'fan', name: "Fan va ta’lim", emoji: '🔬' },
  { slug: 'avto', name: 'Avtomobil', emoji: '🚗' },
  { slug: 'salomatlik', name: 'Salomatlik', emoji: '🏥' },
]

// Postlar uchun gradient palitrasi (indigo/blue ishlatilmagan)
export const GRADIENTS = [
  'from-emerald-400 to-teal-600',
  'from-amber-400 to-orange-600',
  'from-rose-400 to-pink-600',
  'from-cyan-400 to-sky-600',
  'from-lime-400 to-green-600',
  'from-fuchsia-400 to-purple-600',
  'from-yellow-400 to-amber-600',
  'from-teal-400 to-cyan-600',
]

export function gradientFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return GRADIENTS[h % GRADIENTS.length]
}
