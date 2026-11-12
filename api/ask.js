// Remember When — narrated photo slide shows about the good old days (for older audiences)
// Built on the Lecture Hall engine: one AI call writes the show, a quick second check keeps it clean.
// Repeat questions are saved on Vercel's network (instant + free).
// Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL, CLAUDE_CHECK_MODEL (optional)

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const CHECK_MODEL = process.env.CLAUDE_CHECK_MODEL || "claude-haiku-5-5";
const HOURLY_LIMIT = 30;
const hits = new Map();

const HELP_WORDS = /\b(kill myself|suicide|suicidal|end my life|hurt myself|self harm|self-harm|want to die)\b/i;
const HELP = {
  type: "help", title: "You matter",
  slides: [
    { heading: "You're not alone", text: "It sounds like you might be going through something really hard. You don't have to face it by yourself.", image_query: "", image_backup: "" },
    { heading: "Help is a call away", text: "In the US, you can call or text 988 to reach the Suicide and Crisis Lifeline, any time, day or night. If you are in danger right now, call 911. Talking with someone you trust can help too.", image_query: "", image_backup: "" }
  ]
};
const DECLINE = {
  type: "decline", title: "Let's take a different trip",
  slides: [{ heading: "Let's pick another memory", text: "That's not something Remember When can show. Ask me about music, movies, cars, school days, diners, toys, fashion, or what life was like in any decade.", image_query: "", image_backup: "" }]
};
const BREAK = {
  type: "redirect", title: "Time for a coffee break",
  slides: [{ heading: "Time for a coffee break", text: "You've taken a lot of trips down memory lane this hour. Rest a bit and come back soon for more.", image_query: "", image_backup: "" }]
};

const SYSTEM = `You host "Remember When," a warm, friendly, narrated photo slide show about the past for older adults (roughly ages 55 to 95). Think of a favorite neighbor flipping through an old photo album with a friend. You are an AI host; if asked, say so honestly.

SCOPE: nostalgia and everyday history, mostly the 1930s through the 1990s: music and radio, TV and movies, cars and road trips, school days, diners and food, prices and shopping, toys and games, fashion, sports, holidays, homes and kitchens, jobs, technology of the day, news events, and "what was it like when...". Older or newer history is fine too.

DECIDE THE TYPE FIRST:
- "show": a nostalgia or history question. Make the slide show.
- "redirect": chit-chat or not a question about the past. One friendly slide steering to a related memory topic.
- "decline": requests for harmful instructions, sexual content, or harassment. One brief, polite slide.

THE SLIDE SHOW ("slides"): 6 to 7 slides that tell a story in order, like a photo album. Each slide has:
- "heading": a short, warm headline (3 to 7 words).
- "text": 2 or 3 short sentences read aloud (35 to 60 words). Plain, conversational, vivid sensory details (sounds, smells, prices, how things felt). Speak to the viewer naturally ("If you grew up in the fifties, you may remember..."). No markdown, no lists, no emojis.
- "year": the year or decade the slide's own text is about (for example "1957" or "1960s"). It must match what the slide says. Use "" for the wrap-up slide or when the slide spans many decades.
- "image_query": 2 to 4 plain search words that an archive photo's TITLE would contain. Photo archives match titles literally, so:
  * For a famous person, use just their name, with Capital Letters (for example "Jimi Hendrix", "Elvis Presley"). Add one word only if it is part of the photo itself, like "Jimi Hendrix guitar". Never add an event name the person is not pictured at, and never use song or album titles.
  * For a TV show, movie or band, use its exact title with Capital Letters plus one word saying what it is (for example "Leave It to Beaver TV show", "Bonanza TV show", "The Wizard of Oz movie", "The Supremes band"). For one of its stars, use the star's real full name.
  * For a famous place or event, use its proper name with Capital Letters (for example "Route 66", "Woodstock festival", "Monterey Pop Festival", "Shea Stadium").
  * For everyday things, use the physical thing plus its decade, in lowercase (for example "1950s drive-in theater", "soda fountain 1940s", "1960s television set", "jukebox").
  * No feelings, no abstract ideas, no brand slogans: a photographer could not take a picture of "nostalgia" or "freedom".
- "image_backup": a broader, everyday 1 to 3 word search that would still fit the slide if the first finds nothing (for example "electric guitar", "rock concert crowd", "drive-in theater", "television set"). Never a name.

The first slide sets the scene. The last slide is a gentle wrap-up that invites a memory.

OTHER FIELDS (shows only):
- "intro": one short spoken welcome line for the start of the show (under 20 words).
- "memory_prompt": one friendly question inviting the viewer to share their own memory, good for conversation with family or friends (for example "Did you have a favorite song on the jukebox?").
- "did_you_know": one surprising, true fact (1 to 2 sentences).
- "more": exactly 3 short follow-up topics they might enjoy next, written as questions.

ACCURACY: Well-established facts only. Give prices and numbers as approximate ("about 25 cents"). If something varied by place or year, say so. Never invent quotes.
CONTESTED TOPICS (politics, religion, wars): describe what happened and how people lived it, fairly and respectfully. No personal opinions.
TONE: warm, respectful, never condescending, never "back in my day" jokes about age. Hard history (wars, the Depression, assassinations) is handled with care and dignity.

For redirect and decline: fill only type, title, and slides (one slide).

Always respond by calling the give_show tool.`;

const SHOW_TOOL = {
  name: "give_show", description: "Deliver the narrated photo slide show.",
  input_schema: { type: "object", properties: {
    type: { type: "string", enum: ["show", "redirect", "decline"] },
    title: { type: "string" },
    intro: { type: "string" },
    slides: { type: "array", items: { type: "object", properties: {
      heading: { type: "string" }, text: { type: "string" }, year: { type: "string" },
      image_query: { type: "string" }, image_backup: { type: "string" }
    } } },
    memory_prompt: { type: "string" },
    did_you_know: { type: "string" },
    more: { type: "array", items: { type: "string" } }
  }, required: ["type", "title", "slides"] }
};

async function anthropic(body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("api_" + r.status + " " + t.slice(0, 200)); }
  return r.json();
}

async function makeShow(content) {
  const data = await anthropic({
    model: MODEL, max_tokens: 4000, system: SYSTEM,
    tools: [SHOW_TOOL], tool_choice: { type: "auto" },
    messages: [{ role: "user", content }]
  });
  if (data.stop_reason === "max_tokens") throw new Error("too_long");
  let j = null;
  const block = (data.content || []).find(b => b.type === "tool_use");
  if (block && block.input) j = block.input;
  if (!j) {
    const txt = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
    if (s >= 0 && e > s) j = JSON.parse(txt.slice(s, e + 1));
  }
  j = normalize(j);
  if (!j) throw new Error("bad_shape");
  return j;
}

function normalize(j) {
  if (!j || !Array.isArray(j.slides)) return null;
  const str = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
  j.slides = j.slides.map(s => typeof s === "string" ? { heading: "", text: s } : s).map(s => ({
    heading: str(s.heading, 80), text: str(s.text, 600), year: str(s.year, 20),
    image_query: str(s.image_query, 80), image_backup: str(s.image_backup, 60)
  })).filter(s => s.text).slice(0, 8);
  if (!j.slides.length) return null;
  j.title = str(j.title, 100) || "Remember When";
  j.intro = str(j.intro, 200);
  j.memory_prompt = str(j.memory_prompt, 200);
  j.did_you_know = str(j.did_you_know, 400);
  j.more = Array.isArray(j.more) ? j.more.map(m => str(m, 120)).filter(Boolean).slice(0, 3) : [];
  if (!["show", "redirect", "decline"].includes(j.type)) j.type = "show";
  return j;
}

async function withRetry(fn) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await fn(); } catch (e) { lastErr = e; console.error("attempt", attempt + 1, "failed:", e.message); }
  }
  throw lastErr || new Error("failed");
}

function errorCode(err) {
  const m = String(err && err.message || "");
  return m.startsWith("api_429") ? "R2" : m.startsWith("api_5") ? "B3" : m === "too_long" ? "L4" : m.startsWith("api_4") ? "A5" : "S6";
}

async function safetyCheck(question, show) {
  const text = [show.title, show.intro, ...show.slides.map(s => s.heading + ". " + s.text), show.did_you_know].join("\n");
  const data = await anthropic({
    model: CHECK_MODEL, max_tokens: 20, thinking: { type: "disabled" },
    system: "You review content for a general-audience nostalgia website for older adults. Reply with exactly one word: SAFE or UNSAFE. UNSAFE only for sexual content, step-by-step instructions that could cause serious harm, hate or harassment, or encouragement of self-harm. Normal history about wars, the Depression, politics, religion, medicine, or hard times, told respectfully, is SAFE.",
    messages: [{ role: "user", content: `Question: ${question}\n\nContent:\n${text}` }]
  });
  const verdict = (data.content || []).filter(b => b.type === "text").map(b => b.text || "").join("");
  if (!verdict.trim()) throw new Error("blank_verdict");
  return !/UNSAFE|NOT\s+SAFE/i.test(verdict);
}

// "About this picture": the story behind one scene of the slide show, for people who remember it.
// Answers are saved on Vercel's network, so the same scene costs nothing the next time.
const EXPLAIN_TOOL = {
  name: "give_story", description: "Deliver the story behind one scene.",
  input_schema: { type: "object", properties: {
    overview: { type: "string" },
    items: { type: "array", items: { type: "object", properties: { word: { type: "string" }, more: { type: "string" }, why: { type: "string" } } } }
  }, required: ["items"] }
};
const SYSTEM_EXPLAIN = `You are a warm, knowledgeable host of a nostalgia slide show for older adults. A viewer paused the show to learn more about one scene.
Given the show's topic, the scene's heading, narration, year and the photo's title (you cannot see the photo itself):
- "overview": 2-3 sentences of the story behind this scene: what was happening, when, and what it felt like to live through it.
- "items": 3 to 5 key people, places, shows, products or events in this scene. For each: "word" (the name), "more": 2-3 plain sentences with real, well-known facts (dates, who, where), and "why": one sentence on why it was a big deal back then or why people still remember it.
Only state facts you are confident are true and widely documented. Never describe details of the photo you cannot see. Warm, respectful, no Markdown.
If the content is not appropriate for a family nostalgia site, return items: [].`;
async function explainScene(src, send) {
  const clip = (v, n) => String(v || "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  const topic = clip(src.q, 200), heading = clip(src.h, 120), text = clip(src.t, 600), year = clip(src.y, 20), photo = clip(src.p, 120);
  if (!heading && !text) return send(400, { error: "empty" });
  try {
    const j = await withRetry(async () => {
      const data = await anthropic({
        model: CHECK_MODEL, max_tokens: 2000, thinking: { type: "disabled" }, system: SYSTEM_EXPLAIN,
        tools: [EXPLAIN_TOOL], tool_choice: { type: "auto" },
        messages: [{ role: "user", content: `Show topic: ${topic}\nScene heading: ${heading}\nYear: ${year}\nNarration: ${text}\nPhoto title: ${photo || "(unknown)"}` }]
      });
      const block = (data.content || []).find(b => b.type === "tool_use");
      if (!block || !block.input || !Array.isArray(block.input.items)) throw new Error("bad_shape");
      return block.input;
    });
    const items = j.items.map(i => ({ word: clip(i.word, 80), more: clip(i.more, 600), why: clip(i.why, 300) })).filter(i => i.word && i.more).slice(0, 5);
    return send(200, { overview: clip(j.overview, 600), items }, true);
  } catch (e) {
    return send(500, { error: "oops", reason: errorCode(e) });
  }
}

// "Your own topic": 5 starter questions about any topic a visitor types. Answers are saved on Vercel's network.
const STARTERS_TOOL = {
  name: "give_questions", description: "Five starter questions for the nostalgia slide show.",
  input_schema: { type: "object", properties: {
    ok: { type: "boolean", description: "false if the topic isn't appropriate for a family nostalgia site" },
    questions: { type: "array", items: { type: "string" } }
  }, required: ["ok", "questions"] }
};
async function ownStarters(src, send){
  const topic = String(src.topic || "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (topic.length < 2) return send(400, { error: "empty" });
  try {
    const j = await withRetry(async () => {
      const data = await anthropic({
        model: CHECK_MODEL, max_tokens: 600, thinking: { type: "disabled" },
        system: `You suggest questions for "Remember When", a warm nostalgia slide-show site for older adults. Given a topic a visitor typed, write 5 short, specific questions (each under 14 words) that would make a great slide show about memories of that topic from the 1920s to the 2000s, phrased like "What was it like...", "What were...", "Who was...". Use well-known, real names, places and events. If the topic names a decade (like "TV in the 1950s"), every question must be about that decade only. If the topic is not appropriate for a family nostalgia site (sexual, hateful, violent, or about a private person), set ok to false and questions to [].`,
        tools: [STARTERS_TOOL], tool_choice: { type: "auto" },
        messages: [{ role: "user", content: `Topic: ${topic}` }]
      });
      const block = (data.content || []).find(b => b.type === "tool_use");
      if (!block || !block.input || typeof block.input.ok !== "boolean") throw new Error("bad_shape");
      return block.input;
    });
    if (!j.ok) return send(200, { questions: [], message: "Let's try a different topic. How about drive-ins, old radio shows, or your hometown?" }, true);
    const questions = (j.questions || []).map(q => String(q || "").replace(/[<>]/g, " ").trim().slice(0, 140)).filter(Boolean).slice(0, 5);
    return send(200, { questions }, true);
  } catch (e) {
    return send(500, { error: "oops", reason: errorCode(e) });
  }
}

module.exports = async (req, res) => {
  if (!allowedRequest(req)) return blockRequest(res);
  const isGet = req.method === "GET";
  if (!isGet && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  const send = (status, obj, cacheable) => {
    res.setHeader("Cache-Control", cacheable && isGet && status === 200 ? "public, s-maxage=2592000, stale-while-revalidate=604800" : "no-store");
    return res.status(status).json(obj);
  };
  if (!process.env.ANTHROPIC_API_KEY) return send(500, { error: "oops", reason: "K1" });

  const src = (isGet ? req.query : req.body) || {};
  if (src.part === "explain") return explainScene(src, send);
  if (src.part === "starters") return ownStarters(src, send);
  const question = String(src.q || "").trim().slice(0, 300);
  const more = !isGet && src.more === true;
  const prev = isGet ? "" : String(src.prev || "").slice(0, 3000);
  const context = isGet ? "" : String(src.context || "").slice(0, 200);
  const image = isGet ? "" : String(src.image || "");
  if (image && (image.length > 4000000 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200)))) return send(400, { error: "bad_image" });
  if (!question) return send(400, { error: "empty" });

  if (HELP_WORDS.test(question)) return send(200, HELP, true);

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if (recent.length >= HOURLY_LIMIT) return send(200, BREAK, false);
  recent.push(now); hits.set(ip, recent);

  let user = `${context ? `We were just looking at: ${context}\n` : ""}Question: ${question}`;
  if (more) {
    user = `The viewer tapped "Tell me more" on the slide show: ${context}\nHere is what that show ALREADY covered:\n${prev}\n\nMake a new slide show that goes further on this same topic: new memories, details, people, places, and stories. Do not repeat what was already shown. Title it like "More: ...".${/^tell me more/i.test(question) ? "" : `\nThe viewer especially wants: ${question}`}`;
  }
  const content = image ? [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
    { type: "text", text: user + `\n\nThe viewer shared the old photo above (maybe from a family album). Start by gently describing what it shows and the era it seems to be from (say it is a best guess), then build the slide show around that era and those things. Do not guess who the people are.` }
  ] : user;

  let show;
  try { show = await withRetry(() => makeShow(content)); }
  catch (e) { return send(500, { error: "oops", reason: errorCode(e) }); }

  if (show.type === "decline") return send(200, DECLINE, true);
  try {
    if (show.type === "show" && !(await safetyCheck(question, show))) return send(200, DECLINE, true);
  } catch (e) {
    console.error("safety check failed:", e.message);
    return send(500, { error: "oops", reason: "C7" });
  }
  return send(200, show, true);
};

// ---------- website lock ----------
// Only answer this tool's own pages and Paul's websites, so nobody else can run the tool on his credits.
// Add more sites in Vercel with an ALLOWED_SITES setting (comma separated); set LOCK_OFF to 1 to switch the lock off.
function allowedRequest(req) {
  if (String(process.env.LOCK_OFF || "") === "1") return true;
  const sites = ["nusparkpublishing.com", "nusparkmarketing.com", "nusparklearnwow.com"]
    .concat(String(process.env.ALLOWED_SITES || "").split(",").map(s => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean));
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase().split(":")[0];
  const ok = u => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return h === host || h === "localhost" || h === "127.0.0.1" || sites.some(d => h === d || h.endsWith("." + d));
    } catch (e) { return false; }
  };
  const origin = req.headers.origin, ref = req.headers.referer || req.headers.referrer;
  if (origin && origin !== "null") return ok(origin);
  if (ref) return ok(ref);
  return req.method === "GET"; // quick status checks; browsers always say where a POST comes from
}
function blockRequest(res) {
  res.statusCode = 403;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: "not_allowed", message: "This tool only works on NuSpark websites." }));
}
