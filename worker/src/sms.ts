// SMS yuborish — Eskiz.uz (O'zbekiston). Hisob: https://eskiz.uz
// Secretlar: ESKIZ_EMAIL, ESKIZ_PASSWORD. Ixtiyoriy: ESKIZ_FROM (default 4546), SMS_TEXT ("{code}" bilan)
let token = ""

async function login(env: any) {
  const f = new FormData()
  f.append("email", env.ESKIZ_EMAIL)
  f.append("password", env.ESKIZ_PASSWORD)
  const r = await fetch("https://notify.eskiz.uz/api/auth/login", { method: "POST", body: f })
  const j: any = await r.json().catch(() => ({}))
  token = j?.data?.token || ""
  if (!token) throw new Error("Eskiz login xatosi")
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
