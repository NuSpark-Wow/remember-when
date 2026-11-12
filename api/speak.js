// Remember When voice — ElevenLabs text-to-speech, one slide at a time
// Env: ELEVENLABS_API_KEY (required for the voice; without it the page uses the browser voice)
// Optional: ELEVENLABS_VOICE_ID (Man) and ELEVENLABS_VOICE_ID_WOMAN (Woman) to swap in different voices
// Only the show's own words are sent here. No visitor audio ever reaches this server.

const DEFAULT_MAN = "x8EpqJ1pKzP4vo35tTCm";   // David - Clear, Friendly Explainer
const DEFAULT_WOMAN = "W3Rk2MrllOWWYVX9H2B1"; // Instructional Marina - Warm & clear
const cache = new Map(); // repeat answers don't cost twice (resets when the server sleeps)

module.exports = async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  // Health check you can open in a browser: /api/speak  (never shows the key)
  if (req.method === "GET") {
    const out = { api_key_set: !!key, man_voice_id: process.env.ELEVENLABS_VOICE_ID || DEFAULT_MAN, woman_voice_id: process.env.ELEVENLABS_VOICE_ID_WOMAN || DEFAULT_WOMAN };
    if (key) {
      for (const who of ["man", "woman"]) {
        try {
          const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${out[who + "_voice_id"]}?output_format=mp3_22050_32`, {
            method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
            body: JSON.stringify({ text: "Hi.", model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5" })
          });
          out[who] = r.ok ? "working" : `error ${r.status}: ${(await r.text()).slice(0, 200)}`;
        } catch (e) { out[who] = "error: " + e.message; }
      }
    }
    return res.json(out);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!key) return res.status(501).json({ error: "voice_off" });
  const who = (req.body || {}).voice === "woman" ? "woman" : "man";
  const voice = who === "woman"
    ? (process.env.ELEVENLABS_VOICE_ID_WOMAN || DEFAULT_WOMAN)
    : (process.env.ELEVENLABS_VOICE_ID || DEFAULT_MAN);

  const text = String((req.body || {}).text || "").trim().slice(0, 1200);
  if (!text) return res.status(400).json({ error: "empty" });
  // Normal is a touch slower for easy listening; Slower and Faster step down and up from there
  const speed = ({ slow: 0.8, fast: 1.05 })[(req.body || {}).speed] || 0.92;
  const ck = who + "|" + speed + "|" + text;
  if (cache.has(ck)) return res.json(cache.get(ck));

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text: speakable(text).out,
        model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
        voice_settings: { stability: 0.65, similarity_boost: 0.8, style: 0.15, speed }
      })
    });
    if (!r.ok) return res.status(502).json({ error: "voice_failed" });
    const d = await r.json();
    const out = { audio: d.audio_base64, alignment: remapAlign(d.alignment || d.normalized_alignment || null, text) };
    if (cache.size > 200) cache.clear();
    cache.set(ck, out);
    return res.json(out);
  } catch (e) {
    return res.status(502).json({ error: "voice_failed" });
  }
};

// ---------- read math symbols out loud ----------
// "C1 x V1" or "3 x 4" -> "times" (not "ex"), × -> "times", π -> "pie" (so it is never read "p-i"), ² -> "squared", ³ -> "cubed",
// √ -> "the square root of". The read-along timing is mapped back to the original letters,
// so the word highlighting on screen still lines up.
const SAY_SYMBOL = { "x": "times", "×": "times", "π": "pie", "²": "squared", "³": "cubed", "√": "the square root of" };
function speakable(text) {
  const re = /(\d[\d.,]*(?:\s?(?:cm|mm|km|m|in|ft|yd|inches|feet|meters|units))?|\b[A-Za-z]{1,3}\d+[A-Za-z]?|\))(\s*)(x)(\s*)(?=\d|\(|[A-Za-z]{1,3}\d)|([×π²³√])/g;
  let out = "", last = 0, m;
  const map = new Array(text.length);
  while ((m = re.exec(text))) {
    const xPos = m[5] ? m.index : m.index + m[1].length + m[2].length;
    for (let i = last; i < xPos; i++) { map[i] = out.length; out += text[i]; }
    const prev = xPos > 0 ? text[xPos - 1] : "", next = xPos + 1 < text.length ? text[xPos + 1] : "";
    const padL = (!prev || /[\s(]/.test(prev)) ? "" : " ";
    const padR = (!next || /[\s.,;:!?)]/.test(next)) ? "" : " ";
    map[xPos] = out.length + padL.length;
    out += padL + SAY_SYMBOL[text[xPos]] + padR;
    last = xPos + 1;
    re.lastIndex = last;
  }
  for (let i = last; i < text.length; i++) { map[i] = out.length; out += text[i]; }
  return { out, map };
}
function remapAlign(al, text) {
  const { out, map } = speakable(text);
  if (!al || out === text || !Array.isArray(al.character_start_times_seconds) || al.character_start_times_seconds.length !== out.length) return al;
  const s = al.character_start_times_seconds, e = al.character_end_times_seconds || s;
  return { characters: text.split(""), character_start_times_seconds: map.map(j => s[j]), character_end_times_seconds: map.map(j => e[j]) };
}
