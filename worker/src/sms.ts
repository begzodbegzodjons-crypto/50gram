// SMS yuborish — Eskiz.uz (O'zbekiston). Hisob: https://eskiz.uz
// Secretlar: ESKIZ_EMAIL, ESKIZ_PASSWORD. Ixtiyoriy: ESKIZ_FROM (default 4546), SMS_TEXT ("{code}" bilan)
let token = ""

async function login(env: any) {
  // 2 urinish: Eskiz'ning o'zi vaqti-vaqti bilan titraydi (tarmoq/5xx) — bitta titrash
  // OTP'ni butunlay o'chirib qo'yardi («bir marta ishlagan funksiya ishlamay qoldi» naqshi).
  // Parol noto'g'ri bo'lsa ham shunchaki 2 marta rad etiladi — zarari yo'q.
  let last: unknown
  for (let i = 0; i < 2; i++) {
    try {
      const f = new FormData()
      f.append("email", env.ESKIZ_EMAIL)
      f.append("password", env.ESKIZ_PASSWORD)
      const r = await fetch("https://notify.eskiz.uz/api/auth/login", { method: "POST", body: f })
      const j: any = await r.json().catch(() => ({}))
      token = j?.data?.token || ""
      if (token) return
      throw new Error("Eskiz login xatosi")
    } catch (e) {
      last = e
      if (i === 0) await new Promise((r) => setTimeout(r, 400))
    }
  }
  throw last
}

export function smsConfigured(env: any) {
  return !!(env.ESKIZ_EMAIL && env.ESKIZ_PASSWORD)
}

export async function sendSms(env: any, phone: string, code: string) {
  if (!token) await login(env)
  const text = (env.SMS_TEXT || "50 Gram tasdiqlash kodi: {code}").replace("{code}", code)
  const send = () => {
    const f = new FormData()
    f.append("mobile_phone", phone.replace(/\D/g, ""))
    f.append("message", text)
    f.append("from", env.ESKIZ_FROM || "4546")
    return fetch("https://notify.eskiz.uz/api/message/sms/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: f,
    })
  }
  let r = await send()
  if (r.status === 401) {
    await login(env)
    r = await send()
  }
  if (!r.ok) throw new Error("SMS yuborilmadi: " + (await r.text()).slice(0, 200))
}
