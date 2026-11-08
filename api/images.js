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

async function lookCheck(scene, imgs) {
  const content = [{ type: "text", text: `Scene:\n${scene}\n\nCandidate photos:` }];
  imgs.forEach((im, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}: "${im.title}"` });
    content.push({ type: "image", source: { type: "url", url: im.src } });
  });
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: LOOK_MODEL, max_tokens: 60, system: LOOK_SYSTEM, messages: [{ role: "user", content }] })
    });
    if (!r.ok) throw new Error("look_" + r.status + " " + (await r.text()).slice(0, 150));
    const d = await r.json();
    const txt = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const j = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
    return (j.fits || []).map(n => imgs[n - 1]).filter(Boolean);
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

module.exports = async (req, res) => {
  const q = String(req.query.q || "").replace(/[^\w\s'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const scene = String(req.query.scene || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const debug = req.query.debug === "1";
  if (!q || BAD.test(q)) return res.json({ images: [] });
  const t = terms(q), log = [];
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
  images = images.slice(0, 4);
  res.setHeader("Cache-Control", debug ? "no-store" : (images.length || checked) ? "public, s-maxage=604800" : "s-maxage=3600");
  return res.json(debug ? { images, checked, terms: t, log } : { images, checked });
};
