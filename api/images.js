// Remember When — free-to-use photo finder
// Sources, best vintage first:
//   1. Library of Congress (only photos marked "No known restrictions on publication")
//   2. Wikimedia Commons (public domain, CC0, CC BY, CC BY-SA — credit always shown)
//   3. Openverse (CC0, public domain mark, CC BY, CC BY-SA — credit always shown)
// The search words come from the show itself, never straight from the visitor.
// Returns up to 4 choices so the page can avoid showing the same photo twice in one show.

const UA = "RememberWhen/1.0 (nostalgia slide show; nusparkpublishing.com)";
const BAD = /\b(nude|naked|nsfw|sex|erotic|corpse|dead body|bodies|gore|blood|lynch|execution|war crime|torture|massacre|atrocit|drug)\b/i;
const strip = s => String(s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim().slice(0, 90);

async function getJson(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } finally { clearTimeout(t); }
}

async function fromLoc(q) {
  const d = await getJson("https://www.loc.gov/photos/?fo=json&c=15&q=" + encodeURIComponent(q));
  const out = [];
  for (const it of (d && d.results) || []) {
    const item = it.item || {};
    const rights = String(item.rights_advisory || item.rights_information || "");
    if (it.access_restricted || !/no known restrictions/i.test(rights)) continue;
    const title = strip(it.title || item.title);
    if (!title || BAD.test(title) || BAD.test(String(item.summary || ""))) continue;
    const urls = (it.image_url || []).map(u => String(u));
    const best = urls[urls.length - 1] || "";
    const w = +((best.match(/[#&]w=(\d+)/) || [])[1] || 0);
    if (!best || (w && w < 400)) continue;
    const who = Array.isArray(it.contributor) && it.contributor[0] ? it.contributor[0].replace(/\b\w/g, c => c.toUpperCase()) : "";
    out.push({ src: best.split("#")[0], title, credit: who ? who + ", Library of Congress" : "Library of Congress",
      license: "No known restrictions", source: "Library of Congress", link: it.url || item.link || "https://www.loc.gov/photos/" });
    if (out.length >= 4) break;
  }
  return out;
}

async function fromCommons(q) {
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search"
    + "&gsrnamespace=6&gsrlimit=20&gsrsearch=" + encodeURIComponent(q + " filetype:bitmap")
    + "&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1200";
  const d = await getJson(url);
  const pages = Object.values((d && d.query && d.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const out = [];
  for (const p of pages) {
    const info = (p.imageinfo || [])[0]; if (!info) continue;
    const m = info.extmetadata || {};
    const lic = String((m.LicenseShortName && m.LicenseShortName.value) || "") + " " + String((m.License && m.License.value) || "");
    let license = "";
    if (/cc0/i.test(lic)) license = "CC0";
    else if (/public domain|\bpd\b|pdm/i.test(lic)) license = "Public domain";
    else if (/cc[- ]by[- ]sa/i.test(lic)) license = strip(m.LicenseShortName && m.LicenseShortName.value) || "CC BY-SA";
    else if (/cc[- ]by\b/i.test(lic)) license = strip(m.LicenseShortName && m.LicenseShortName.value) || "CC BY";
    if (!license) continue;
    if (info.width && info.width < 450) continue;
    const title = strip(p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "").replace(/_/g, " "));
    if (BAD.test(title) || BAD.test(strip(m.ImageDescription && m.ImageDescription.value))) continue;
    out.push({ src: info.thumburl || info.url, title, credit: strip(m.Artist && m.Artist.value) || "Unknown",
      license, source: "Wikimedia Commons", link: info.descriptionurl });
    if (out.length >= 4) break;
  }
  return out;
}

async function fromOpenverse(q) {
  const d = await getJson("https://api.openverse.org/v1/images/?license=cc0,pdm,by,by-sa&mature=false&page_size=12&q=" + encodeURIComponent(q));
  const out = [];
  for (const it of (d && d.results) || []) {
    if (it.mature || BAD.test(it.title || "")) continue;
    if (it.width && it.width < 450) continue;
    const lic = String(it.license || "").toLowerCase();
    const license = lic === "cc0" ? "CC0" : lic === "pdm" ? "Public domain" : "CC " + lic.toUpperCase() + (it.license_version ? " " + it.license_version : "");
    out.push({ src: it.url || it.thumbnail, title: strip(it.title), credit: strip(it.creator) || "Unknown",
      license, source: strip(it.source || "Openverse"), link: it.foreign_landing_url });
    if (out.length >= 4) break;
  }
  return out;
}

module.exports = async (req, res) => {
  const q = String(req.query.q || "").replace(/[^\w\s'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!q || BAD.test(q)) return res.json({ images: [] });
  const found = [];
  for (const fn of [fromLoc, fromCommons, fromOpenverse]) {
    try {
      for (const img of await fn(q)) if (!found.some(f => f.src === img.src)) found.push(img);
    } catch (e) { console.error(fn.name, "failed:", e.message); }
    if (found.length >= 4) break;
  }
  res.setHeader("Cache-Control", found.length ? "public, s-maxage=604800" : "s-maxage=3600");
  return res.json({ images: found.slice(0, 4) });
};
