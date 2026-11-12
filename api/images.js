// Remember When — free-to-use photo finder (v2: checks each photo is really about the subject)
// Sources, best vintage first:
//   1. Library of Congress (only photos marked "No known restrictions on publication")
//   2. Wikimedia Commons (public domain, CC0, CC BY, CC BY-SA — credit always shown)
//   3. Openverse (CC0, public domain mark, CC BY, CC BY-SA — credit always shown)
// The search words come from the show itself, never straight from the visitor.
// v2: a photo only counts when its own title or description names the subject
// (for people and places, the name must be there). Sheet music, maps, flags, logos and
// documents are skipped. If nothing fits, it retries with shorter searches: without the
// year, then just the names.
// v5: when the free archives have fewer than two good photos for a scene, the best photos from a
// Google Images search (Serper; needs SERPER_API_KEY in Vercel) are added, credited with their website
// and a link back. They go through the same photo check as the archive photos.
// Add &debug=1 to the address to see what each source found.

const UA = "RememberWhen/1.0 (nostalgia slide show; nusparkpublishing.com)";
const BAD = /\b(nude|naked|nsfw|sex|erotic|corpse|dead body|bodies|gore|blood|lynch|execution|war crime|torture|massacre|atrocit|drug)\b/i;
const NOT_PHOTO = /\b(sheet music|score|bars \d|notation|map|flag|logo|coat of arms|emblem|signature|autograph|diagram|chart|graph|stamp|seal|banknote|coin|document|letter|page \d|manuscript|newspaper|clipping|ad\b|advertisement|poster|ticket|album cover|cd cover|icon|svg|drawing|sketch|plan|blueprint)\b/i;
const STOP = new Set(["the","a","an","of","and","in","at","on","with","for","to","from","by","vintage","old","classic","retro","photo","photograph","picture","image","era","style","american","usa","us","early","late"]);
const strip = (s, n = 90) => String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const isYear = w => /^(1[89]|20)\d\ds?$|^'?\d0s$/.test(w);
const norm = s => String(s || "").toLowerCase().replace(/[_\-]/g, " ").replace(/[^a-z0-9' ]/g, " ");
const stem = w => w.replace(/'s$/, "").replace(/(ies)$/, "y").replace(/(es|s)$/, "");

async function getJson(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error("http " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function fromLoc(q) {
  const d = await getJson("https://www.loc.gov/photos/?fo=json&c=25&q=" + encodeURIComponent(q));
  const out = [];
  for (const it of (d && d.results) || []) {
    const item = it.item || {};
    const rights = String(item.rights_advisory || item.rights_information || "");
    if (it.access_restricted || !/no known restrictions/i.test(rights)) continue;
    const title = strip(it.title || item.title);
    const urls = (it.image_url || []).map(u => String(u));
    const best = urls[urls.length - 1] || "";
    const w = +((best.match(/[#&]w=(\d+)/) || [])[1] || 0);
    if (!title || !best || (w && w < 400)) continue;
    const who = Array.isArray(it.contributor) && it.contributor[0] ? it.contributor[0].replace(/\b\w/g, c => c.toUpperCase()) : "";
    out.push({ src: best.split("#")[0], title, credit: who ? who + ", Library of Congress" : "Library of Congress",
      license: "No known restrictions", source: "Library of Congress", link: it.url || item.link || "https://www.loc.gov/photos/",
      text: [title, strip(item.summary, 400), (item.subjects || []).join(" ")].join(" ") });
  }
  return out;
}

async function fromCommons(q) {
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search"
    + "&gsrnamespace=6&gsrlimit=30&gsrsearch=" + encodeURIComponent(q + " filetype:bitmap")
    + "&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1200";
  const d = await getJson(url);
  const pages = Object.values((d && d.query && d.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const out = [];
  for (const p of pages) {
    const info = (p.imageinfo || [])[0]; if (!info) continue;
    const m = info.extmetadata || {};
    const short = strip(m.LicenseShortName && m.LicenseShortName.value);
    const lic = short + " " + String((m.License && m.License.value) || "");
    let license = "";
    if (/cc0/i.test(lic)) license = "CC0";
    else if (/public domain|\bpd\b|pdm/i.test(lic)) license = "Public domain";
    else if (/cc[- ]by[- ]sa/i.test(lic)) license = short || "CC BY-SA";
    else if (/cc[- ]by\b/i.test(lic)) license = short || "CC BY";
    if (!license) continue;
    if (info.width && info.width < 450) continue;
    if (info.width && info.height && (info.width / info.height > 3 || info.height / info.width > 3)) continue;
    const title = strip(p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "").replace(/_/g, " "));
    const desc = strip(m.ImageDescription && m.ImageDescription.value, 400);
    out.push({ src: info.thumburl || info.url, title, credit: strip(m.Artist && m.Artist.value) || "Unknown",
      license, source: "Wikimedia Commons", link: info.descriptionurl,
      text: [title, desc, strip(m.Categories && m.Categories.value, 400), strip(m.ObjectName && m.ObjectName.value)].join(" ") });
  }
  return out;
}

async function fromOpenverse(q) {
  const d = await getJson("https://api.openverse.org/v1/images/?license=cc0,pdm,by,by-sa&mature=false&page_size=20&q=" + encodeURIComponent(q));
  const out = [];
  for (const it of (d && d.results) || []) {
    if (it.mature) continue;
    if (it.width && it.width < 450) continue;
    const lic = String(it.license || "").toLowerCase();
    const license = lic === "cc0" ? "CC0" : lic === "pdm" ? "Public domain" : "CC " + lic.toUpperCase() + (it.license_version ? " " + it.license_version : "");
    const title = strip(it.title);
    out.push({ src: it.url || it.thumbnail, title, credit: strip(it.creator) || "Unknown",
      license, source: strip(it.source || "Openverse"), link: it.foreign_landing_url,
      text: [title, (it.tags || []).map(t => t && t.name).join(" ")].join(" ") });
  }
  return out;
}

// What the search is about: names (capitalized words) and other key words. Years are a bonus.
function terms(raw) {
  const words = raw.split(/\s+/).filter(Boolean);
  const names = [], keys = [], years = [];
  words.forEach((w, i) => {
    const lw = norm(w).trim();
    if (!lw || STOP.has(lw)) return;
    if (isYear(lw)) { years.push(lw.replace(/s$/, "").slice(0, 3)); return; }
    if (lw.length < 3) return;
    // a capital letter in the middle of the search means a name (first word may just be a sentence start)
    if (/^[A-Z]/.test(w) && (i > 0 || /^[A-Z]/.test(words[1] || ""))) names.push(stem(lw)); else keys.push(stem(lw));
  });
  return { names, keys, years };
}
function score(text, t) {
  const toks = new Set(norm(text).split(/\s+/).filter(Boolean).map(stem));
  const has = w => toks.has(w) || [...toks].some(x => x.length > 4 && w.length > 4 && (x.startsWith(w) || w.startsWith(x)));
  const nHit = t.names.filter(has).length, kHit = t.keys.filter(has).length;
  if (t.names.length && nHit < Math.ceil(t.names.length / 2)) return -1;   // people and places must be named
  const need = t.names.length + t.keys.length;
  if (!need) return -1;
  const frac = (nHit + kHit) / need;
  if (!t.names.length && kHit < Math.min(2, t.keys.length)) return -1;     // things: at least 2 key words (or all, if fewer)
  if (frac < 0.5) return -1;
  const yr = t.years.some(y => norm(text).includes(y)) ? 0.2 : 0;
  return frac + yr;
}
function variants(q) {
  const words = q.split(/\s+/);
  const noYear = words.filter(w => !isYear(norm(w).trim())).join(" ");
  const t = terms(q);
  const nameWords = words.filter(w => t.names.includes(stem(norm(w).trim())));
  // e.g. "Jimi Hendrix Woodstock 1969" -> "Jimi Hendrix Woodstock 1969", "Jimi Hendrix Woodstock", "Jimi Hendrix"
  return [...new Set([q, noYear, nameWords.join(" "), nameWords.slice(0, 2).join(" ")].filter(Boolean))];
}

// v3: Claude looks at the top photos and keeps only the ones that truly fit the scene.
// Env: ANTHROPIC_API_KEY (already set), LOOK_MODEL (optional, defaults to the fast model)
const LOOK_MODEL = process.env.LOOK_MODEL || "claude-haiku-5-5";
const LOOK_SYSTEM = `You check photos for a nostalgia slide show. You get one scene (headline and narration) and numbered candidate photos with their archive titles.
Keep a photo only if a viewer would instantly see it belongs with this scene:
- If the scene is about a specific person, TV show, movie, band, event, product, or place, the photo must show that exact subject, its people (host, cast, performers), or something unmistakably from it. A generic look-alike does NOT fit (a random game show is not "The Price Is Right"; any guitarist is not Jimi Hendrix).
- If the scene is about everyday things (diners, cars, kitchens, toys), the photo must clearly show that kind of thing, ideally from the right era. A modern-looking photo for an old-time scene does not fit.
- Reject photos that are mostly text, documents, sheet music, maps, logos, blank or unclear, or that show something sad or disturbing the scene doesn't call for.
Reply with only JSON like {"fits":[3,1]}: the numbers of the photos that fit, best first. Use {"fits":[]} if none fit.`;

// The site downloads each photo itself and hands it to Claude, because some archives
// refuse direct requests from Claude. Photos that won't download are simply skipped.
async function grab(src) {
  if (!src) return null;
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(src, { headers: { "User-Agent": UA }, signal: ctl.signal });
    if (!r.ok) return null;
    let type = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type === "image/jpg") type = "image/jpeg";
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000 || buf.length > 4500000) return null;
    return { type, data: buf.toString("base64") };
  } catch (e) { return null; } finally { clearTimeout(tm); }
}

async function lookCheck(scene, imgs) {
  const files = await Promise.all(imgs.map(async im => (await grab(im.src)) || (im.thumb ? await grab(im.thumb) : null)));
  const ok = imgs.map((im, i) => ({ im, f: files[i] })).filter(x => x.f);
  if (!ok.length) return [];
  imgs = ok.map(x => x.im);
  const content = [{ type: "text", text: `Scene:\n${scene}\n\nCandidate photos:` }];
  ok.forEach(({ im, f }, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}: "${im.title}"` });
    content.push({ type: "image", source: { type: "base64", media_type: f.type, data: f.data } });
  });
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: LOOK_MODEL, max_tokens: 200, thinking: { type: "disabled" }, system: LOOK_SYSTEM, messages: [{ role: "user", content }] })
    });
    if (!r.ok) throw new Error("look_" + r.status + " " + (await r.text()).slice(0, 150));
    const d = await r.json();
    const txt = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    // Read the photo numbers however they come back: {"fits":[3,1]}, "fits: 3, 1", or "[]"
    let nums = null;
    try { const j = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)); if (Array.isArray(j.fits)) nums = j.fits; } catch (e) {}
    if (!nums) {
      const m = txt.match(/fits[^\[\d]*\[([^\]]*)\]/i) || txt.match(/\[([\d,\s]*)\]/);
      if (m) nums = (m[1].match(/\d+/g) || []).map(Number);
    }
    if (!nums) throw new Error("unreadable answer: " + txt.slice(0, 120) + " (stop: " + d.stop_reason + ")");
    return [...new Set(nums.map(Number))].map(n => imgs[n - 1]).filter(Boolean);
  } finally { clearTimeout(tm); }
}

async function gather(q, t, log, debug, want) {
  const found = [];
  for (const v of variants(q)) {
    const results = await Promise.all([fromLoc, fromCommons, fromOpenverse].map(fn =>
      fn(v).then(list => ({ name: fn.name, list }), e => ({ name: fn.name, list: [], err: e.message }))));
    const pool = [];
    for (const r of results) {
      let kept = 0;
      r.list.forEach((img, order) => {
        if (BAD.test(img.text) || NOT_PHOTO.test(img.title)) return;
        const s = score(img.text, t);
        if (s < 0) return;
        // gentle preference: Library of Congress first, then the archive's own ranking
        pool.push({ img, rank: s + (r.name === "fromLoc" ? 0.15 : 0) - order * 0.01 }); kept++;
      });
      if (debug) log.push({ search: v, source: r.name, found: r.list.length, kept, error: r.err || undefined });
    }
    pool.sort((a, b) => b.rank - a.rank);
    for (const { img } of pool) {
      if (found.some(f => f.src === img.src || f.title === img.title)) continue;
      const { text, ...clean } = img; found.push(clean);
      if (found.length >= want) break;
    }
    if (found.length >= Math.min(3, want)) break;
  }
  return found;
}

// v4: a viewer can describe the picture they'd rather see ("want"). Claude turns that into
// archive searches, and the photo check uses the description too.
const WANT_SYSTEM = `A viewer of a nostalgia slide show described the picture they would like to see for a scene. Turn it into photo-archive searches.
Archives match photo TITLES literally. For famous people, shows, events or places, use their proper names with Capital Letters (for example "Abbott and Costello", "Bob Barker"). For everyday things, use the physical thing plus its decade in lowercase (for example "1950s jukebox").
Reply with only JSON: {"query":"2 to 4 words","backup":"1 to 3 broader words"}. If the request is inappropriate (sexual, hateful, violent or not a picture request), reply {"query":"","backup":""}.`;

async function wantToSearch(want, scene) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: LOOK_MODEL, max_tokens: 120, thinking: { type: "disabled" }, system: WANT_SYSTEM,
      messages: [{ role: "user", content: `Scene: ${scene}\n\nThe viewer would like a picture of: ${want}` }] })
  });
  if (!r.ok) throw new Error("want_" + r.status);
  const d = await r.json();
  const txt = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const j = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
  const clean = v => String(v || "").replace(/[^\w\s'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return [clean(j.query), clean(j.backup)].filter(Boolean);
}

// Google Images through Serper. Stock-photo sellers, shops and social sites are skipped.
const SKIP_SITES = /(fbsbx|facebook|instagram|tiktok|twitter|x\.com|threads\.net|pinterest|pinimg|shutterstock|alamy|gettyimages|istockphoto|dreamstime|depositphotos|123rf|stock\.adobe|agefotostock|bigstock|vectorstock|freepik|ebay|amazon\.com|etsy|walmart|redbubble|teepublic|worthpoint)/i;
async function fromWeb(q) {
  const key = String(process.env.SERPER_API_KEY || "").trim(); if (!key) return [];
  const ask = safe => fetch("https://google.serper.dev/images", { method: "POST", signal: AbortSignal.timeout(8000),
    headers: { "X-API-KEY": key, "content-type": "application/json" },
    body: JSON.stringify(safe ? { q, num: 20, gl: "us", hl: "en", safe: "active" } : { q, num: 20, gl: "us", hl: "en" }) });
  let r = await ask(true); if (r.status === 400) r = await ask(false);
  if (!r.ok) throw new Error("serper " + r.status);
  const out = [];
  for (const it of (await r.json()).images || []) {
    const title = strip(it.title);
    if (!it.imageUrl || !/^https:\/\//i.test(it.imageUrl) || /\.(svg|gif)(\?|$)/i.test(it.imageUrl)) continue;
    if (SKIP_SITES.test((it.domain || "") + " " + (it.link || "")) || /(fbsbx|cdninstagram|pinimg|tiktokcdn|twimg)/i.test(it.imageUrl)) continue;
    if ((it.imageWidth || 0) < 500 || BAD.test(title) || NOT_PHOTO.test(title)) continue;
    const site = strip(it.source || it.domain || "").replace(/^www\./, "") || "the web";
    out.push({ src: it.imageUrl, thumb: it.thumbnailUrl || "", title, credit: site, license: "From the web", source: site, link: it.link || "", web: true });
    if (out.length >= 5) break;
  }
  return out;
}

async function findFor(q, scene, log, debug) {
  const t = terms(q);
  const look = !!(scene && process.env.ANTHROPIC_API_KEY);
  let images = await gather(q, t, log, debug, look ? 6 : 4);
  let checked = false;
  if (look && images.length) {
    try { images = await lookCheck(scene, images); checked = true; }
    catch (e) {
      // if the check itself fails (a photo the checker can't open, a busy moment), fall back to the label match
      console.error("photo check failed:", e.message); if (debug) log.push({ check_error: e.message });
    }
  }
  // fewer than two good archive photos: add the best checked photos from the web
  if (images.length < 2 && look && process.env.SERPER_API_KEY) {
    try {
      const web = await fromWeb(q);
      if (debug) log.push({ web_search: q, found: web.length });
      if (web.length) {
        const fits = await lookCheck(scene, web);
        if (debug) log.push({ web_fits: fits.length });
        images = images.concat(fits.filter(w => !images.some(f => f.src === w.src)));
        checked = true;
      }
    } catch (e) { console.error("web photos failed:", e.message); if (debug) log.push({ web_error: e.message }); }
  }
  return { images, checked, t };
}

module.exports = async (req, res) => {
  if (!allowedRequest(req)) return blockRequest(res);
  let q = String(req.query.q || "").replace(/[^\w\s'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  let scene = String(req.query.scene || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const want = String(req.query.want || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const debug = req.query.debug === "1";
  const log = [];

  if (want) {
    if (BAD.test(want) || !process.env.ANTHROPIC_API_KEY) return res.json({ images: [] });
    let searches = [];
    try { searches = await wantToSearch(want, scene); } catch (e) { console.error("want failed:", e.message); }
    if (debug) log.push({ searches });
    scene = (scene ? scene + "\n" : "") + "The viewer specifically asked for a picture of: " + want;
    let out = { images: [], checked: false };
    for (const s of searches) {
      if (BAD.test(s)) continue;
      out = await findFor(s, scene, log, debug);
      if (out.images.length) break;
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json(debug ? { images: out.images.slice(0, 4), checked: out.checked, log } : { images: out.images.slice(0, 4), checked: out.checked });
  }

  if (!q || BAD.test(q)) return res.json({ images: [] });
  const { images: found, checked, t } = await findFor(q, scene, log, debug);
  const images = found.slice(0, 4);
  res.setHeader("Cache-Control", debug ? "no-store" : (images.length || checked) ? "public, s-maxage=604800" : "s-maxage=3600");
  return res.json(debug ? { images, checked, terms: t, log } : { images, checked });
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
