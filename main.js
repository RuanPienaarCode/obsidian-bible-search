/*
 * Bible Search — standalone Obsidian plugin.
 *
 * Hosts the generated "Bible Search.html" (built from
 * Bible/bible-search-template.html by the tools/ pipeline or the in-app
 * builder) inside a first-class workspace view. The page is a ~2.5 MB shell;
 * each translation's verse text lives in Bible/search-data/bd-<TRANS>.json
 * and is served to the page on demand through the bridge in wireBridge().
 *
 * The HTML is loaded via a blob: URL so the iframe is same-origin with
 * the plugin. That lets us intercept the obsidian://open links the
 * generator already emits and route them through openLinkText() —
 * verse clicks open the real vault note in a new tab, no changes to
 * the generated file or the generator required.
 */

"use strict";

const { Plugin, ItemView, Modal, PluginSettingTab, Setting, Notice, TFile, TFolder, normalizePath, requestUrl } = require("obsidian");

const VIEW_TYPE = "bible-search-view";
// Where the split build keeps each translation's verse text (bd-<TRANS>.json).
// The page asks for these by id through the bridge in wireBridge(); both the
// in-app builder below and Bible/build-bible-search.js write them here.
const DATA_PATH = "Bible/search-data";
// The optional content layers, in tab order. Each note layer names its source
// folder; On This Day and Church History are assembled specially (no single
// folder — see their builders). One registry drives the settings toggles, the
// default settings, and the build's gating.
// The Bible itself is not a layer — it's always present.
const CONTENT_LAYERS = [
	{ key: "articles",      label: "Articles",       folder: "Teaching" },
	{ key: "topics",        label: "Topics",         folder: "Topics" },
	{ key: "faq",           label: "FAQ",            folder: "FAQ" },
	{ key: "history",       label: "Bible history",  folder: "Bible History" },
	{ key: "churchhistory", label: "Church History", folder: null },
	{ key: "onthisday",     label: "On This Day",    folder: null },
];
// A layer is included unless explicitly disabled — a missing/partial `layers`
// object (older saved settings) therefore means "include everything present".
const layerEnabled = (layers, key) => !layers || layers[key] !== false;

const DEFAULT_SETTINGS = {
	htmlPath: "Bible Search.html",
	openNotesInNewTab: true,
	onboarded: false,
	// Which optional content layers to build. Bible is always included; each of
	// these is included when enabled AND its content exists (an enabled-but-empty
	// layer emits nothing and its tab stays hidden — see the builder + template).
	layers: Object.fromEntries(CONTENT_LAYERS.map((l) => [l.key, true])),
	// Resume ticket: the wizard's download picks, persisted while a setup run is
	// unfinished. Non-null means "downloads and/or the build didn't complete" —
	// the plugin auto-resumes on the next launch and clears it only on success.
	setupDownloads: null,
};

const REBUILD_CMD =
	'node "Bible/build-bible-search.js" . "Bible/bible-search-template.html" "Bible Search.html"';

// Folder docs, in the order someone new to the vault should meet them.
const DOCS = [
	{
		path: "Bible/README.md",
		name: "Loading Bible text",
		desc: "Folder and filename rules per translation, the verse-line contract the parser requires, the KJV anchor rule, and how to add a translation.",
	},
	{
		path: "Teaching/README.md",
		name: "Loading articles",
		desc: "Drop a folder under Teaching/ and it becomes a source — the folder name is the badge. Every frontmatter field is optional.",
	},
	{
		path: "tools/README.md",
		name: "Terminal tools",
		desc: "Importing translations from a terminal, the Node search build, and the enrichment generators (when present).",
	},
	{
		path: "docs/enrichment-layout.md",
		name: "Enrichment note shapes",
		desc: "The frozen spec: one note per chapter per layer, tag scheme, and why KJV files own the bare chapter stem.",
	},
	{
		path: "sources/README.md",
		name: "Source datasets and licences",
		desc: "Vendored openbible.info / openscriptures / CCEL data, with the attribution each one requires.",
	},
];

// Inline crib notes, so the two contracts that bite most are readable without leaving settings.
/* Shown in both the settings Quick reference and the wizard's download step.
 * The search build detects translations from the vault (any Bible/{TRANS}/
 * folder in the right shape) — so a licensed text someone is entitled to
 * store needs no plugin change, only the layout described here. */
const LICENSED_REF = {
	title: "Adding a licensed translation — ESV, NIV, CSB, NLT, AMP…",
	body:
		"These can't be downloaded here: their licences cover quoting passages,\n" +
		"not storing whole-Bible copies. If you have text you're licensed to keep\n" +
		"a full copy of (check your licence — some publishers sell or grant\n" +
		"full-text use), lay it out in the vault and the search picks it up\n" +
		"automatically on the next rebuild:\n\n" +
		"1. One folder per book:  Bible/NIV/Genesis/ … using exact canonical\n" +
		"   names (Psalms, Song of Songs, 1 Corinthians).\n" +
		"2. One note per chapter, suffixed with the code: 'Genesis 1 (NIV).md'.\n" +
		"   Only the anchor translation (normally KJV) uses bare names\n" +
		"   ('Genesis 1.md').\n" +
		"3. One verse per line:  **1** In the beginning… ^1\n" +
		"   Bold verse number at the start, ^n block anchor at the end.\n" +
		"4. Frontmatter — copy any KJV chapter note and adjust: translation,\n" +
		"   book, chapter, the bible/niv tag, and the 'Genesis 1 (NIV)' alias.\n" +
		"5. Settings → Bible Search → Rebuild now. The translation appears in\n" +
		"   the search menu and the reader.\n\n" +
		"Any legally-obtained export works (Bible-software module export,\n" +
		"publisher API you're licensed for, an e-text you own) — converting it\n" +
		"to this shape is all that's needed. The same steps fit HCSB/CSB, NKJV,\n" +
		"NASB, or any other translation. See Bible/README.md for the full\n" +
		"format contract.",
};

const QUICK_REF = [
	{
		title: "The verse line — Bible/{TRANS}/{Book}/{Book} {n}.md",
		body:
			"**1** Now it came to pass in the days when the judges ruled… ^1\n\n" +
			"Bold verse number at the start, block anchor ^n at the end, one verse per line.\n" +
			"Miss either and the line is not a verse: it won't be indexed or linkable.\n\n" +
			"KJV files are named 'Ruth 1.md'; every other translation is 'Ruth 1 (AMP).md'.\n" +
			"The book folder must use the exact canonical name (Psalms, Song of Songs).",
	},
	{
		title: "An article — Teaching/{Source}/…/{anything}.md",
		body:
			"---\ntitle: \"Walking in Love\"\nauthor: \"Example Ministry\"\ntopics: [\"Love\", \"Discipleship\"]\ndate: 2019-11-10\nsource: \"https://example.org/…\"\nexcerpt: \"One line shown when the terms miss the body.\"\n---\n\n" +
			"All of it is optional — a note with just a # heading and prose indexes fine.\n" +
			"Title falls back to the heading then the filename; topics to topic/* tags;\n" +
			"excerpt to the first paragraph; source to the first external link.\n\n" +
			"Skipped: README.md, hub notes (type: *hub or a hub tag), and notes with no prose.",
	},
	LICENSED_REF,
];

/* ── onboarding ─────────────────────────────────────────────────────────
 * First-run wizard. Either CONNECTS to a search HTML that already exists
 * (confirm path + prefs) or, on a fresh vault, offers to download the
 * public-domain translations and build the page right here — with a
 * setup-checklist note covering whatever is left for the Node pipeline.
 */

const SETUP_NOTE_PATH = "Bible Search Setup.md";

// Mirrored from tools/lib/translations.js — the wizard can't require() across
// the vault (and mobile has no fs), so keep these in sync with that file.
const BOOK_ORDER = [
	"Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
	"1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra",
	"Nehemiah","Esther","Job","Psalms","Proverbs","Ecclesiastes","Song of Songs",
	"Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos",
	"Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah",
	"Malachi","Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians",
	"2 Corinthians","Galatians","Ephesians","Philippians","Colossians",
	"1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon",
	"Hebrews","James","1 Peter","2 Peter","1 John","2 John","3 John","Jude",
	"Revelation",
];
const BOOKS = new Set(BOOK_ORDER);
// USFM ids in BOOK_ORDER order. The download API is matched on these, never on
// display names — our canonical "Song of Songs" is "Song of Solomon" upstream.
const BOOK_IDS = [
	"GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI",
	"1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
	"LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP",
	"HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL",
	"EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE",
	"2PE","1JN","2JN","3JN","JUD","REV",
];
const PREFERRED = ["ESV", "NLT", "BSB", "AMP", "KJV", "WEB"];
const NON_TRANSLATION = new Set([
	"Cross Reference", "Study Hubs", "Word Studies", "Places", "Catena",
	"Commentary", "Book Intros", "Reference", "Templates", "search-data",
]);

/* ── translation download ───────────────────────────────────────────────
 * Public-domain translations the wizard can fetch whole, from the same API
 * tools/import-bible.js uses. ESV / NLT / AMP are copyrighted — their licences
 * cover single passages, not whole-Bible copies — so they are deliberately NOT
 * offered here. See Bible/README.md for adding text you have rights to store.
 */
const HELLOAO_API = "https://bible.helloao.org/api";
const DOWNLOADABLE = [
	{
		trans: "KJV", api: "eng_kjv", picked: true,
		label: "King James Version (KJV)",
		desc: "Public domain. Becomes the anchor translation — it owns the bare “Ruth 1” chapter stems that cross-references and word studies link to.",
	},
	{
		trans: "BSB", api: "BSB", picked: true,
		label: "Berean Standard Bible (BSB)",
		desc: "Public domain (dedicated to the public domain in 2023). A clear, readable modern translation.",
	},
	{
		trans: "WEB", api: "ENGWEBP", picked: false,
		label: "World English Bible (WEB)",
		desc: "Public domain modern-English revision of the 1901 ASV.",
	},
];
// Where the search template lives in the vault, and where to fetch it from when
// a fresh vault doesn't have it yet. Pinned to the release tag matching this
// plugin version — never a moving branch — so the fetched page is the exact
// one this release was audited with.
const TEMPLATE_PATH = "Bible/bible-search-template.html";
const TEMPLATE_URL =
	"https://raw.githubusercontent.com/RuanPienaarCode/scripture-vault/v1.2.2/Bible/bible-search-template.html";

// The On This Day calendar is the one optional layer that CAN be shared as data —
// its entries are original summaries of fixed-date Christian-year events, no
// copyrighted text. A vault that doesn't carry the on-this-day.js source can
// download this pre-assembled pack (the { "MM-DD": { label, entries } } map that
// buildOnThisDay() emits) and drop it in. Served as a raw file at a pinned tag,
// exactly like the template. (Published in the release step; until then it 404s.)
const ONTHISDAY_PACK_PATH = "Bible/on-this-day.json";
const ONTHISDAY_PACK_URL =
	"https://raw.githubusercontent.com/RuanPienaarCode/scripture-vault/v1.2.2/data/on-this-day.json";

// Church History is the other shareable layer — the whole denominational family
// tree ({ eras, families, nodes }) is one hand-curated, all-original module. A
// vault without the denominations.js source downloads this pre-assembled pack,
// served the same way as the On This Day pack. (Published in the release step;
// until then it 404s.)
const CHURCHHISTORY_PACK_PATH = "Bible/church-history.json";
const CHURCHHISTORY_PACK_URL =
	"https://raw.githubusercontent.com/RuanPienaarCode/scripture-vault/v1.2.2/data/church-history.json";

// Transient 429/5xx happens over ~1,200 chapter fetches — retry with enough
// backoff (1s/2s/4s/8s) to ride out a short outage burst instead of aborting
// a whole download. Permanent 4xx (bad URL, missing book) fails fast.
async function fetchJson(url) {
	let lastErr;
	for (let attempt = 0; attempt < 5; attempt++) {
		if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
		try {
			const res = await requestUrl({ url, throw: false });
			const status = res.status ?? 200;
			if (status >= 200 && status < 300) return res.json;
			lastErr = new Error(`Request failed, status ${status}`);
			if (status >= 400 && status < 500 && status !== 429) break;
		} catch (e) { lastErr = e; }
	}
	throw lastErr;
}

// Idempotent vault writes: never overwrite, so a re-run or a racing device
// sync can't clobber real data.
async function ensureFolder(app, path) {
	if (!path || path === "/") return;
	if (app.vault.getAbstractFileByPath(path)) return;
	await ensureFolder(app, path.split("/").slice(0, -1).join("/"));
	try { await app.vault.createFolder(path); } catch (e) { /* raced into existence */ }
}
async function writeIfAbsent(app, path, content) {
	path = normalizePath(path);
	if (app.vault.getAbstractFileByPath(path)) return false;
	await ensureFolder(app, path.split("/").slice(0, -1).join("/"));
	try { await app.vault.create(path, content); return true; } catch (e) { return false; }
}

/* A verse's content is a mix of plain strings, poetry parts ({text, poem}),
 * line breaks and footnote markers ({noteId}). The vault format is one line per
 * verse, so flatten to a single spaced string. Same logic as import-bible.js. */
function apiVerseText(content) {
	const out = [];
	for (const part of content || []) {
		if (typeof part === "string") out.push(part);
		else if (part && typeof part.text === "string") out.push(part.text);
	}
	return out.join(" ").replace(/\s+/g, " ").trim();
}

/* Download one translation into Bible/{TRANS}/ in the exact shape the parser
 * expects (see Bible/README.md) — the in-plugin twin of tools/import-bible.js.
 * `anchor` names chapter files "{Book} {n}.md" with no suffix; exactly one
 * translation per vault may do that. Existing files are always skipped. */
async function importTranslation(app, spec, onProgress) {
	const { trans, api, anchor } = spec;
	const meta = (await fetchJson(`${HELLOAO_API}/${api}/books.json`)).books;
	const byId = new Map(meta.map((b) => [b.id, b]));
	const suffix = anchor ? "" : ` (${trans})`;
	const bookSuffix = ` (${trans})`;
	let wrote = 0, skipped = 0, verses = 0, done = 0;
	const missing = [], failed = [];
	// One bad book (transient burst outlasting fetchJson's retries) is recorded
	// and skipped, not fatal — the gap fills in on the next resume. Several books
	// failing back-to-back means the connection or API is down: stop cleanly.
	let consecutiveFailures = 0;

	for (let bi = 0; bi < BOOK_ORDER.length; bi++) {
		const book = BOOK_ORDER[bi];
		const info = byId.get(BOOK_IDS[bi]) ||
			meta.find((b) => b.commonName === book || b.name === book);
		if (!info) { missing.push(book); continue; }
		onProgress?.(`${trans}: ${book} — book ${done + 1} of ${BOOK_ORDER.length}…`);
		try {
			// A few chapters in flight keeps this quick without hammering the API.
			const total = info.numberOfChapters;
			let next = 1;
			const worker = async () => {
				while (next <= total) {
					const ch = next++;
					const chPath = `Bible/${trans}/${book}/${book} ${ch}${suffix}.md`;
					if (app.vault.getAbstractFileByPath(normalizePath(chPath))) { skipped++; continue; }
					const d = await fetchJson(`${HELLOAO_API}/${api}/${info.id}/${ch}.json`);
					const lines = [
						"---",
						`tags: [bible, bible/${trans.toLowerCase()}, bible/chapter]`,
						`aliases: ["${book} ${ch}${suffix}"]`,
						`translation: ${trans}`,
						`book: "${book}"`,
						`chapter: ${ch}`,
						"---",
						"",
						`# ${book} ${ch}`,
						"",
						`Part of [[${book}${bookSuffix}|${book}]] · [[${trans}]] · [[Bible]]`,
						"",
					];
					for (const item of d.chapter.content) {
						if (item.type !== "verse") continue;
						const text = apiVerseText(item.content);
						if (!text) continue;
						lines.push(`**${item.number}** ${text} ^${item.number}`, "");
						verses++;
					}
					if (await writeIfAbsent(app, chPath, lines.join("\n"))) wrote++;
				}
			};
			// allSettled so a failing worker doesn't leave siblings as unhandled
			// rejections; the first failure still fails the book.
			const settled = await Promise.allSettled([worker(), worker(), worker(), worker()]);
			const bad = settled.find((s) => s.status === "rejected");
			if (bad) throw bad.reason;

			// Book-level note — the parser ignores it (no chapter number), links use
			// it. Written only after every chapter landed, so its presence doubles as
			// the per-book completion marker isTranslationComplete keys off.
			const chapterLinks = Array.from({ length: total }, (_, i) =>
				`[[${book} ${i + 1}${suffix}|${i + 1}]]`).join(" · ");
			await writeIfAbsent(app, `Bible/${trans}/${book}/${book}${bookSuffix}.md`, [
				"---",
				`tags: [bible, bible/${trans.toLowerCase()}, bible/book]`,
				`aliases: ["${book}${bookSuffix}"]`,
				`translation: ${trans}`,
				`book: "${book}"`,
				"---",
				"",
				`# ${book}${bookSuffix}`,
				"",
				`Part of [[${trans}]] · [[Bible]]`,
				"",
				"## Chapters",
				"",
				chapterLinks,
				"",
			].join("\n"));
			done++;
			consecutiveFailures = 0;
		} catch (e) {
			failed.push(book);
			if (++consecutiveFailures >= 3) {
				const err = new Error(
					`${trans}: stopping after repeated failures (${failed.join(", ")}) — ` +
					(e && e.message ? e.message : e));
				err.failedBooks = failed;
				throw err;
			}
		}
	}
	return { trans, books: done, wrote, skipped, verses, missing, failed };
}

/* ── setup pipeline ─────────────────────────────────────────────────────
 * The wizard's download-and-build phase, shared with the launch-time
 * auto-resume: fetch pending translations (tolerating per-book failures),
 * make sure the template exists, build the search page. Always builds —
 * a partial Bible still yields a working search, and the gaps fill in on
 * the next resume. Returns the build result plus human-readable problems;
 * an empty problems list means setup is finished and the ticket can go.
 */
async function runSetupPipeline(app, htmlPath, pending, onProgress, layers) {
	const problems = [];
	for (const spec of pending) {
		try {
			const r = await importTranslation(app, spec, onProgress);
			if (r.failed.length) problems.push(`${spec.trans}: ${r.failed.join(", ")} incomplete`);
			else onProgress?.(`${spec.trans}: done — ${r.verses.toLocaleString()} verses.`);
		} catch (e) {
			problems.push(e && e.message ? e.message : String(e));
		}
	}
	if (!(app.vault.getAbstractFileByPath(normalizePath(TEMPLATE_PATH)) instanceof TFile)) {
		onProgress?.("Fetching the search template…");
		const res = await requestUrl({ url: TEMPLATE_URL });
		await writeIfAbsent(app, TEMPLATE_PATH, res.text);
	}
	onProgress?.("Building the search page…");
	const built = await buildSearchIndex(app, htmlPath, onProgress, layers);
	return { built, problems };
}

// Rebuild download specs from a persisted picks map — used by the wizard and
// by the launch-time auto-resume. Complete translations drop out; a partial
// one stays pending, and if it already owns the bare stems it keeps them.
function computePending(app, downloads) {
	const { anchor } = surveyTranslations(app);
	const picks = DOWNLOADABLE.filter((d) =>
		downloads && downloads[d.trans] && !isTranslationComplete(app, d.trans));
	// Exactly one translation may own the bare chapter stems. If the vault has
	// no anchor yet, the first pick (KJV when selected) becomes it.
	let anchorAssigned = !!anchor;
	return picks.map((d) => {
		const spec = { ...d, anchor: anchor === d.trans || !anchorAssigned };
		anchorAssigned = true;
		return spec;
	});
}

/* ── in-app search build ────────────────────────────────────────────────
 * The vault-API twin of Bible/build-bible-search.js: scan chapter notes and
 * Teaching/ articles, inject the payloads into the template, write the search
 * HTML. Keep the two in lock-step — same regexes, same placeholders — so a
 * page built here is byte-compatible with one built by the Node pipeline.
 */
const VERSE_RE = /^\*\*(\d+)\*\*\s*(.*?)\s*\^(\d+)\s*$/;

function surveyTranslations(app) {
	const v = app.vault;
	const has = (p) => !!v.getAbstractFileByPath(normalizePath(p));
	const translations = [];
	let anchor = null;
	const bible = v.getAbstractFileByPath("Bible");
	if (bible instanceof TFolder) {
		for (const child of bible.children) {
			if (!(child instanceof TFolder)) continue;
			if (NON_TRANSLATION.has(child.name) || child.name.startsWith(".")) continue;
			if (child.children.some((g) => g instanceof TFolder && BOOKS.has(g.name))) {
				translations.push(child.name);
			}
		}
		translations.sort((a, b) => {
			const ia = PREFERRED.indexOf(a), ib = PREFERRED.indexOf(b);
			if (ia !== -1 && ib !== -1) return ia - ib;
			if (ia !== -1) return -1;
			if (ib !== -1) return 1;
			return a.localeCompare(b);
		});
		outer: for (const t of translations) {
			for (const book of ["Genesis", "Ruth", "John"]) {
				if (has(`Bible/${t}/${book}/${book} 1.md`)) { anchor = t; break outer; }
			}
		}
	}
	return { translations, anchor };
}

/* A translation counts as fully downloaded only when every canonical book has
 * its book-level note — importTranslation writes that note after all of a
 * book's chapters landed, so it doubles as a per-book completion marker. An
 * aborted download leaves books without notes, which keeps the translation
 * eligible for resume instead of being mistaken for "already in this vault". */
function isTranslationComplete(app, trans) {
	return BOOK_ORDER.every((book) =>
		app.vault.getAbstractFileByPath(normalizePath(`Bible/${trans}/${book}/${book} (${trans}).md`)));
}

// Frontmatter + article helpers, ported verbatim from build-bible-search.js.
function fmValue(fm, key) {
	const m = fm.match(new RegExp("^" + key + ':\\s*"?(.*?)"?\\s*$', "m"));
	return m ? m[1].trim() : "";
}
function fmList(fm, key) {
	const inline = fm.match(new RegExp("^" + key + ":\\s*\\[(.*)\\]\\s*$", "m"));
	if (inline) return inline[1].split(",").map((s) => s.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
	const block = fm.match(new RegExp("^" + key + ":\\s*\\n((?:\\s*-\\s*.*\\n?)+)", "m"));
	if (block) return block[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").replace(/^["']|["']$/g, "").trim()).filter(Boolean);
	return [];
}
function toParagraphs(body) {
	const clean = (s) => s
		.replace(/\[+\d+\]+\(#_?ftn[a-z0-9]*\)/gi, "")
		.replace(/!\[\[[^\]]*\]\]/g, "")
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
		.replace(/\[([^\]]*)\]\((?:\\.|[^)\\])*\)/g, "$1")
		.replace(/[*_`]/g, "")
		.replace(/\s+/g, " ").trim();
	const lines = body.split("\n");
	const paras = [];
	let buf = [], inCallout = false;
	const flush = () => { if (buf.length) { const p = clean(buf.join(" ")); if (p) paras.push(p); buf = []; } };
	for (const line of lines) {
		const t = line.trim();
		if (t === "") { inCallout = false; flush(); continue; }
		if (/^Part of\b/.test(t)) continue;
		if (/^#\s+/.test(t)) { flush(); continue; }
		if (/^#{2,6}\s+/.test(t)) { flush(); const h = clean(t.replace(/^#{2,6}\s+/, "")); if (h) paras.push(h); continue; }
		if (/^>\s*\[!/.test(t)) { inCallout = true; continue; }
		if (inCallout) { if (/^>/.test(t)) continue; inCallout = false; }
		buf.push(t.replace(/^>\s?/, ""));
	}
	flush();
	return paras;
}
const isHub = (fm) =>
	/^type:\s*\S*(hub|moc)\b/mi.test(fm) ||
	fmList(fm, "tags").some((t) => t === "hub" || t === "moc" || t.endsWith("/hub") || t.endsWith("/moc"));
const firstHeading = (body) => (body.match(/^#\s+(.+)$/m) || [, ""])[1].trim();
const firstUrl = (body) => (body.match(/\((https?:\/\/[^)\s]+)\)/) || [, ""])[1];
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

/* Vault-API twin of the Node builder's collectNotes(). Indexes every .md under a
 * folder into the shared record shape — the Articles, Topics, FAQ and History
 * tabs are all just different folders run through this one function. sourceOf(rel)
 * picks each result's badge label. README + hub/MOC notes are skipped. Kept in
 * lock-step with build-bible-search.js so a page built here matches the Node one. */
async function collectNotesFromVault(app, prefix, sourceOf) {
	const out = [];
	const root = app.vault.getAbstractFileByPath(normalizePath(prefix));
	if (!(root instanceof TFolder)) return out; // absent folder → empty layer, not an error
	const under = prefix + "/";
	const files = app.vault.getMarkdownFiles()
		.filter((f) => f.path.startsWith(under) && !/^readme$/i.test(f.basename))
		.sort((a, b) => a.path.localeCompare(b.path));
	for (const f of files) {
		const rel = f.path;
		const source = sourceOf(rel);
		const raw = await app.vault.cachedRead(f);
		const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
		const fm = fmMatch ? fmMatch[1] : "";
		const bodyRaw = fmMatch ? fmMatch[2] : raw;
		if (isHub(fm)) continue;
		const paras = toParagraphs(bodyRaw);
		if (!paras.length) continue;
		const tagTopics = fmList(fm, "tags")
			.map((t) => (t.startsWith("topic/") ? t.slice(6).replace(/-/g, " ") : t))
			// Anonymized filter: ministry-specific tokens are deliberately kept OUT of the
			// public plugin copies. The private builder's exclusion list is intentionally
			// broader — do NOT widen this one to match it.
			.filter((t) => !t.includes("/") && !/^(article|hub|devotional|teaching)$/i.test(t));
		const topics = (fmList(fm, "topics").length ? fmList(fm, "topics") : tagTopics).slice(0, 6).join(", ");
		out.push([
			fmValue(fm, "title") || firstHeading(bodyRaw) || f.basename,
			fmValue(fm, "author"),
			fmValue(fm, "date"),
			topics,
			fmValue(fm, "excerpt") || paras[0].slice(0, 240),
			rel.replace(/\.md$/, ""),
			safeUrl(fmValue(fm, "source") || firstUrl(bodyRaw)),
			paras.join("\n"),
			source,
		]);
	}
	return out;
}

/* Vault-API twin of the Node builder's buildOnThisDay(). Assembles the On This Day
 * payload from the downloaded pack (Bible/on-this-day.json) or, failing that, the
 * hand-curated source module (tools/data/on-this-day.js). Both are NON-markdown
 * files, so they're read through vault.adapter rather than the note API.
 * Every source is optional and every read is non-fatal — a vault without the data
 * just yields {}, which the page renders as an empty (soon hidden) tab. No network. */
const OTD_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
	"August", "September", "October", "November", "December"];
async function buildOnThisDayFromVault(app) {
	const adapter = app.vault.adapter;
	if (!adapter || typeof adapter.read !== "function") return {}; // no raw-file access → no On This Day

	// Pre-assembled pack wins. A vault that downloaded the On This Day pack has the
	// finished { "MM-DD": { label, entries } } map already — use it directly rather
	// than re-assembling from a source it doesn't have. (Ruan's own vault has the
	// on-this-day.js source and no pack, so it falls through to the assembly below.)
	try {
		const packPath = normalizePath(ONTHISDAY_PACK_PATH);
		if (await adapter.exists(packPath)) {
			const pack = JSON.parse(await adapter.read(packPath));
			if (pack && typeof pack === "object") return pack;
		}
	} catch (e) {
		console.warn("Bible Search: On This Day pack unreadable, falling back to source —", e.message);
	}

	// Source: tools/data/on-this-day.js — a `module.exports = { … }` data module
	// (pure literal, no code). Strip everything up to the assignment and evaluate the
	// object literal client-side; it's the vault owner's own offline file, so a scoped
	// Function eval is safe here. Same shape the Node builder reads.
	let byDay = {};
	try {
		const srcPath = normalizePath("tools/data/on-this-day.js");
		if (await adapter.exists(srcPath)) {
			const src = await adapter.read(srcPath);
			const literal = src.replace(/^[\s\S]*?module\.exports\s*=/, "").replace(/;?\s*$/, "");
			byDay = new Function("return (" + literal + ")")() || {};
		}
	} catch (e) {
		console.warn("Bible Search: could not read On This Day source —", e.message);
	}

	// Blurbs may carry [[wikilinks]] meant for the day-notes; the calendar shows them
	// as plain text, so reduce [[Target|Alias]] → Alias, [[Target]] → Target.
	const deWiki = (s) => (s || "").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2");
	const entry = (e) => ({
		category: e.category || "Church history",
		title: e.title,
		year: e.year ?? null,
		ref: e.ref || "",
		blurb: deWiki(e.blurb),
		link: safeUrl(e.link),
	});
	const out = {};
	for (const mmdd of Object.keys(byDay).sort()) {
		const mo = Number(mmdd.slice(0, 2)), d = Number(mmdd.slice(3, 5));
		if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) continue;
		const entries = (byDay[mmdd] || []).filter((e) => e && e.title).map(entry);
		if (entries.length) out[mmdd] = { label: `${OTD_MONTHS[mo - 1]} ${d}`, entries };
	}
	return out;
}

/* Fetch the shareable On This Day pack and drop it in the vault. The wizard's
 * Extras step offers this when a vault has no church-history data of its own.
 * Validates the shape before writing so a stray 404 HTML body can't land as data;
 * returns the number of calendar days written. */
async function downloadOnThisDayPack(app) {
	const res = await requestUrl({ url: ONTHISDAY_PACK_URL, throw: false });
	const status = res.status ?? 200;
	if (status >= 400) throw new Error(`On This Day pack not available (HTTP ${status}).`);
	let pack;
	try { pack = res.json ?? JSON.parse(res.text); }
	catch { throw new Error("On This Day pack was not valid JSON."); }
	const days = pack && typeof pack === "object" ? Object.keys(pack) : [];
	if (!days.length || !/^\d{2}-\d{2}$/.test(days[0])) {
		throw new Error("On This Day pack has an unexpected shape — nothing written.");
	}
	const packPath = normalizePath(ONTHISDAY_PACK_PATH);
	await ensureFolder(app, packPath.split("/").slice(0, -1).join("/"));
	await app.vault.adapter.write(packPath, JSON.stringify(pack));
	return days.length;
}

/* Vault-API twin of the Node builder's buildChurchHistory(). The denominational
 * family tree is one { eras, families, nodes } module — downloaded pack
 * (Bible/church-history.json) wins, then the source module
 * (tools/data/denominations.js), read the same scoped-eval way as On This Day.
 * A vault with neither yields null → no `cd` payload → the tab hides. No network. */
const chShapeOk = (d) => !!(d && Array.isArray(d.eras) && Array.isArray(d.families) &&
	Array.isArray(d.nodes) && d.nodes.length);
async function buildChurchHistoryFromVault(app) {
	const adapter = app.vault.adapter;
	if (!adapter || typeof adapter.read !== "function") return null;
	try {
		const packPath = normalizePath(CHURCHHISTORY_PACK_PATH);
		if (await adapter.exists(packPath)) {
			const pack = JSON.parse(await adapter.read(packPath));
			if (chShapeOk(pack)) return pack;
		}
	} catch (e) {
		console.warn("Bible Search: Church History pack unreadable, falling back to source —", e.message);
	}
	try {
		const srcPath = normalizePath("tools/data/denominations.js");
		if (await adapter.exists(srcPath)) {
			const src = await adapter.read(srcPath);
			const literal = src.replace(/^[\s\S]*?module\.exports\s*=/, "").replace(/;?\s*$/, "");
			const tree = new Function("return (" + literal + ")")();
			if (chShapeOk(tree)) return tree;
		}
	} catch (e) {
		console.warn("Bible Search: could not read Church History source —", e.message);
	}
	return null;
}

/* Fetch the shareable Church History pack and drop it in the vault — the wizard's
 * Extras step offers it when the vault has no denomination data of its own.
 * Validates the { eras, families, nodes } shape before writing; returns the
 * number of tree nodes written. */
async function downloadChurchHistoryPack(app) {
	const res = await requestUrl({ url: CHURCHHISTORY_PACK_URL, throw: false });
	const status = res.status ?? 200;
	if (status >= 400) throw new Error(`Church History pack not available (HTTP ${status}).`);
	let pack;
	try { pack = res.json ?? JSON.parse(res.text); }
	catch { throw new Error("Church History pack was not valid JSON."); }
	if (!chShapeOk(pack)) {
		throw new Error("Church History pack has an unexpected shape — nothing written.");
	}
	const packPath = normalizePath(CHURCHHISTORY_PACK_PATH);
	await ensureFolder(app, packPath.split("/").slice(0, -1).join("/"));
	await app.vault.adapter.write(packPath, JSON.stringify(pack));
	return pack.nodes.length;
}

async function buildSearchIndex(app, htmlPath, onProgress, layers) {
	const vault = app.vault;
	const { translations } = surveyTranslations(app);
	if (!translations.length) {
		throw new Error("No Bible text found under Bible/ — download or import a translation first.");
	}
	const templateFile = vault.getAbstractFileByPath(normalizePath(TEMPLATE_PATH));
	if (!(templateFile instanceof TFile)) {
		throw new Error(`Search template missing at "${TEMPLATE_PATH}".`);
	}

	// One pass over the vault's markdown files, binned by translation/book.
	const chapterFiles = new Map(); // trans → array of {bi, ch, file}
	for (const t of translations) chapterFiles.set(t, []);
	const bookIndex = new Map(BOOK_ORDER.map((b, i) => [b, i]));
	for (const f of vault.getMarkdownFiles()) {
		const m = f.path.match(/^Bible\/([^/]+)\/([^/]+)\/(.+)$/);
		if (!m || !chapterFiles.has(m[1])) continue;
		const bi = bookIndex.get(m[2]);
		if (bi === undefined) continue;
		const cm = f.basename.match(/^(.+?)\s(\d+)(?:\s\([A-Za-z0-9]+\))?$/);
		if (!cm || cm[1] !== m[2]) continue;
		chapterFiles.get(m[1]).push({ bi, ch: +cm[2], file: f });
	}

	const data = {};
	for (const t of translations) {
		onProgress?.(`Indexing ${t}…`);
		const rows = [];
		const list = chapterFiles.get(t).sort((a, b) => a.bi - b.bi || a.ch - b.ch);
		for (const { bi, ch, file } of list) {
			const lines = (await vault.cachedRead(file)).split("\n");
			for (const line of lines) {
				const m = line.match(VERSE_RE);
				if (!m) continue;
				const text = m[2].replace(/\s+/g, " ").trim();
				if (text) rows.push([bi, ch, +m[1], text]);
			}
		}
		data[t] = rows;
	}

	// Content layers — each folder run through the shared collector, same as the Node
	// builder. Teaching/ → Articles (badge = the ministry folder under Teaching/);
	// Topics/, FAQ/ → one constant badge each; Bible History/ → sub-folder badge. A
	// layer the user has disabled is skipped entirely (never read), yielding an empty
	// payload → hidden tab, exactly like an absent folder.
	const on = (k) => layerEnabled(layers, k);
	onProgress?.("Indexing articles…");
	const ARTICLES = on("articles") ? await collectNotesFromVault(app, "Teaching", (rel) => rel.split("/")[1] || "Teaching") : [];
	onProgress?.("Indexing topics, FAQ & history…");
	const TOPICS = on("topics") ? await collectNotesFromVault(app, "Topics", () => "Topic") : [];
	const FAQ = on("faq") ? await collectNotesFromVault(app, "FAQ", () => "FAQ") : [];
	const HISTORY = on("history") ? await collectNotesFromVault(app, "Bible History",
		(rel) => { const p = rel.split("/"); return p.length > 2 ? p[1] : "History"; }) : [];
	const ONTHISDAY = on("onthisday") ? await buildOnThisDayFromVault(app) : {};
	const OTD_DAYS = Object.keys(ONTHISDAY).length;
	const CHURCHHISTORY = on("churchhistory") ? await buildChurchHistoryFromVault(app) : null;
	const CH_NODES = CHURCHHISTORY ? CHURCHHISTORY.nodes.length : 0;

	// Payload emission — identical to the Node builder (see its comments for why).
	// A content layer is emitted ONLY when it has content; an absent <script> is the
	// signal the page uses to hide that layer's tab. The footer/lede prose is built
	// from the same present set, so the page never advertises a layer it didn't ship.
	onProgress?.("Building the page…");
	const enc = (s) => s.replace(/</g, "\\u003c");
	const LAYERS = [
		{ id: "ad", data: ARTICLES,  n: ARTICLES.length, foot: (n) => `${n} teaching articles`,             noun: "teaching articles" },
		{ id: "td", data: TOPICS,    n: TOPICS.length,   foot: (n) => `${n} topics`,                         noun: "topics" },
		{ id: "fd", data: FAQ,       n: FAQ.length,      foot: (n) => `${n} FAQ answers`,                    noun: "FAQ answers" },
		{ id: "hd", data: HISTORY,   n: HISTORY.length,  foot: (n) => `${n} Bible-history notes`,            noun: "Bible history" },
		// cd before od to match the template's tab order (Church History, then On This Day).
		{ id: "cd", data: CHURCHHISTORY, n: CH_NODES,    foot: (n) => `a Church History family tree (${n} branches)`, noun: "a Church History family tree" },
		{ id: "od", data: ONTHISDAY, n: OTD_DAYS,        foot: (n) => `an On This Day calendar (${n} days)`, noun: "an On This Day calendar" },
	];
	const presentLayers = LAYERS.filter((l) => l.n > 0);
	const andJoin = (arr) => arr.length <= 1 ? (arr[0] || "")
		: arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
	const contentSummary = presentLayers.length ? ", plus " + andJoin(presentLayers.map((l) => l.foot(l.n))) : "";
	const ledeLayers = presentLayers.length ? " — plus " + andJoin(presentLayers.map((l) => l.noun)) + "." : ".";
	// Verse text goes to per-translation sidecars, not into the page — the shell
	// stays ~2.5 MB and the view feeds translations to the page on demand (see
	// wireBridge). Each sidecar is written only when its content changed: the
	// text is static, so routine rebuilds stop pushing ~17 MB through iCloud
	// sync. Sidecars for translations that left the vault are removed.
	onProgress?.("Writing translation data…");
	await ensureFolder(app, DATA_PATH);
	for (const t of translations) {
		const p = normalizePath(`${DATA_PATH}/bd-${t}.json`);
		const json = JSON.stringify(data[t]);
		const f = vault.getAbstractFileByPath(p);
		if (f instanceof TFile) {
			// adapter.read, not cachedRead — no reason to hold a 4 MB string in
			// Obsidian's read cache just to compare it. Unreadable → rewrite.
			let prevJson = null;
			try { prevJson = await vault.adapter.read(p); } catch (e) { /* rewrite */ }
			if (prevJson !== json) await vault.modify(f, json);
		} else {
			await vault.create(p, json);
		}
	}
	const dataFolder = vault.getAbstractFileByPath(normalizePath(DATA_PATH));
	if (dataFolder instanceof TFolder) {
		for (const child of [...dataFolder.children]) {
			const m = child instanceof TFile && child.name.match(/^bd-([A-Za-z0-9]+)\.json$/);
			if (m && !translations.includes(m[1])) {
				try { await vault.delete(child); } catch (e) { /* stale sidecar survives — harmless */ }
			}
		}
	}

	const dataScripts = presentLayers
		.map((l) => `<script type="application/json" id="${l.id}">${enc(JSON.stringify(l.data))}<\/script>`)
		.join("\n");

	const STRUCT = BOOK_ORDER.map(() => ({ maxCh: 0, ch: {} }));
	for (const t of translations) {
		for (const r of data[t]) {
			const b = STRUCT[r[0]];
			if (r[1] > b.maxCh) b.maxCh = r[1];
			if (!b.ch[r[1]] || r[2] > b.ch[r[1]]) b.ch[r[1]] = r[2];
		}
	}

	const DEFAULT_TRANS = translations[0];
	const transMenu = translations
		.map((t) => `        <button role="menuitemradio" data-t="${t}" aria-checked="${t === DEFAULT_TRANS}">${t}</button>`)
		.concat(translations.length > 1
			? [`        <button role="menuitemradio" data-t="ALL" aria-checked="false">All ${translations.length}</button>`]
			: [])
		.join("\n");
	const transList = translations.length === 1
		? `the ${translations[0]} text`
		: `all ${translations.length} Bible translations in your vault`;

	let html = await vault.cachedRead(templateFile);
	html = html.replace("__DATA_SCRIPTS__", () => dataScripts)
		.replace("__BOOKS__", () => JSON.stringify(BOOK_ORDER))
		.replace("__TRANS__", () => JSON.stringify(translations))
		.replace("__DEFAULT_TRANS__", () => JSON.stringify(DEFAULT_TRANS))
		.replace("__DEFAULT_TRANS_LABEL__", () => DEFAULT_TRANS)
		.replace("__TRANS_MENU__", () => transMenu)
		.replace(/__TRANS_LIST__/g, () => transList)
		.replace(/__TRANS_DOT__/g, () => translations.join(" · "))
		.replace("__TRANS_HIDDEN__", () => (translations.length > 1 ? "" : " hidden"))
		.replace("__STRUCT__", () => enc(JSON.stringify(STRUCT)))
		.replace("__LEDE_LAYERS__", () => ledeLayers)
		.replace("__CONTENT_SUMMARY__", () => contentSummary)
		.replace("__GENERATED__", () => new Date().toISOString().slice(0, 10));

	const outPath = normalizePath(htmlPath);
	const existing = vault.getAbstractFileByPath(outPath);
	if (existing instanceof TFile) await vault.modify(existing, html);
	else {
		await ensureFolder(app, outPath.split("/").slice(0, -1).join("/"));
		await vault.create(outPath, html);
	}
	const verses = translations.reduce((n, t) => n + data[t].length, 0);
	return {
		translations, verses, bytes: html.length,
		articles: ARTICLES.length, topics: TOPICS.length,
		faq: FAQ.length, history: HISTORY.length, onthisday: OTD_DAYS,
		churchhistory: CH_NODES,
	};
}

class OnboardingWizard extends Modal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
		this.finished = false;
		this.stepIdx = 0;
		this.mode = "create"; // 'create' | 'connect' — decided after the locate step
		this.data = {
			htmlPath: plugin.settings.htmlPath || DEFAULT_SETTINGS.htmlPath,
			openNotesInNewTab: plugin.settings.openNotesInNewTab,
			writeSetupNote: true,
			downloads: Object.fromEntries(DOWNLOADABLE.map((d) => [d.trans, d.picked])),
			// Which optional content layers to include — seeded from current settings
			// (all-on for a fresh install) and adjusted in the Extras step.
			layers: Object.fromEntries(CONTENT_LAYERS.map((l) => [l.key, layerEnabled(plugin.settings.layers, l.key)])),
		};
		// Snapshot to detect a layer change on a re-run (connect mode → rebuild).
		this._initialLayers = JSON.stringify(this.data.layers);
	}

	steps() {
		return this.mode === "connect"
			? ["welcome", "locate", "existing", "extras", "prefs", "finish"]
			: ["welcome", "locate", "status", "bibles", "extras", "prefs", "finish"];
	}

	onOpen() {
		this.titleEl.setText("Set up Bible Search");
		this.renderStep();
	}

	// Dismissal is never fatal: stop nagging on launch, point at the re-run paths.
	onClose() {
		this.contentEl.empty();
		if (!this.finished) {
			new Notice('Setup skipped — run "Bible Search: Run setup wizard" from the command palette anytime.', 6000);
			this.plugin.settings.onboarded = true;
			this.plugin.saveSettings();
		}
	}

	renderStep() {
		const c = this.contentEl;
		c.empty();
		const steps = this.steps();
		const step = steps[this.stepIdx];
		c.createDiv({ cls: "bible-search-onb-step", text: `Step ${this.stepIdx + 1} of ${steps.length}` });
		this["render_" + step](c);

		const nav = new Setting(c);
		if (this.stepIdx > 0) nav.addButton((b) => b.setButtonText("Back").onClick(() => { this.stepIdx--; this.renderStep(); }));
		nav.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		nav.addButton((b) => b
			.setButtonText(step === "finish" ? (this.mode === "connect" ? "Connect" : "Finish setup") : "Next")
			.setCta()
			.onClick(() => this.next()));
	}

	async next() {
		const step = this.steps()[this.stepIdx];
		if (step === "locate") {
			const path = normalizePath((this.data.htmlPath || "").trim());
			if (!path || path === "/") { new Notice("Enter a vault path for the search HTML."); return; }
			this.data.htmlPath = path;
			this.mode = this.detectExisting(path) ? "connect" : "create";
		}
		if (step === "finish") { await this.apply(); return; }
		this.stepIdx++;
		this.renderStep();
	}

	// Same anchor predicate as the plugin's hasData() — keep the two in sync.
	detectExisting(path) {
		return this.app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile;
	}

	/* What of the starter kit is already in this vault? Drives the status step
	 * and the checklist note. Translation/anchor detection mirrors
	 * tools/lib/translations.js so the wizard and the build agree. */
	surveyVault() {
		const has = (p) => !!this.app.vault.getAbstractFileByPath(normalizePath(p));
		const tooling = {
			builder: has("Bible/build-bible-search.js"),
			template: has(TEMPLATE_PATH),
			importer: has("tools/import-bible.js"),
		};
		const { translations, anchor } = surveyTranslations(this.app);
		return { tooling, translations, anchor };
	}

	// The build command, targeting the path the user chose in the wizard.
	buildCmd() {
		return `node "Bible/build-bible-search.js" . "Bible/bible-search-template.html" "${this.data.htmlPath}"`;
	}

	/* ── steps ─────────────────────────────────────────────── */

	render_welcome(c) {
		c.createEl("p", {
			text:
				"Welcome to Bible Search. This short wizard sets up a searchable Bible — every verse, " +
				"plus topics, articles and history — as a page you can open right inside Obsidian. " +
				"A few taps and you're ready to search.",
		});
		const rec = c.createEl("div", { cls: "bible-search-onb-rec" });
		rec.createEl("strong", { text: "Tip: give Bible Search its own vault. " });
		rec.appendText(
			"A full Bible is ~1,200 notes per translation, and topics, articles and history add many more. " +
			"Keeping all of it in a dedicated Obsidian vault keeps that bulk out of your personal notes, your " +
			"graph uncluttered and sync fast — you can switch vaults anytime from Obsidian's vault menu. " +
			"If this is that vault, carry on.");
	}

	render_locate(c) {
		c.createEl("p", {
			text:
				"Bible Search hosts a generated HTML page — the search interface, built from this " +
				"vault's Bible text and articles (the verse text itself lives beside it in " +
				"Bible/search-data/). First, where is (or where will) that page (be)?",
		});
		new Setting(c)
			.setName("Search interface file")
			.setDesc("Vault path to the generated Bible Search HTML.")
			.addText((t) => t
				.setPlaceholder(DEFAULT_SETTINGS.htmlPath)
				.setValue(this.data.htmlPath)
				.onChange((v) => { this.data.htmlPath = v; }));

		// A generated file may already exist under another name — offer what's there.
		const candidates = this.app.vault.getFiles()
			.filter((f) => f.extension === "html" && !f.name.includes("template"))
			.slice(0, 5);
		if (candidates.length) {
			c.createEl("p", { cls: "setting-item-description", text: "HTML files already in this vault:" });
			for (const f of candidates) {
				new Setting(c)
					.setName(f.path)
					.addButton((b) => b.setButtonText("Use this file").onClick(() => {
						this.data.htmlPath = f.path;
						this.renderStep();
					}));
			}
		}
	}

	render_existing(c) {
		const f = this.app.vault.getAbstractFileByPath(this.data.htmlPath);
		const size = f instanceof TFile && f.stat ? ` (${(f.stat.size / 1024 / 1024).toFixed(1)} MB)` : "";
		c.createEl("p", {
			text:
				`Found "${this.data.htmlPath}"${size} — connecting to it. ` +
				"Nothing in the vault is touched; the next step just confirms a preference.",
		});
	}

	render_status(c) {
		const s = this.surveyVault();
		c.createEl("p", {
			text:
				`No file at "${this.data.htmlPath}" yet — the wizard can build it for you. ` +
				"Here is what this vault already has:",
		});
		const row = (ok, name, desc) =>
			new Setting(c).setName(`${ok ? "✓" : "✗"} ${name}`).setDesc(desc);
		row(s.tooling.builder, "Search builder", "Bible/build-bible-search.js");
		row(s.tooling.template, "Search template", "Bible/bible-search-template.html");
		row(s.tooling.importer, "Bible importer", "tools/import-bible.js");
		row(
			s.translations.length > 0,
			s.translations.length ? `Translations: ${s.translations.join(", ")}` : "No Bible text yet",
			s.translations.length
				? (s.anchor ? `Anchor translation: ${s.anchor} (owns the bare "Ruth 1" stems).` : "⚠ No anchor detected — exactly one translation must use unsuffixed chapter files.")
				: "Folders under Bible/ holding canonical book folders count as translations."
		);
		new Setting(c)
			.setName("Write a setup checklist note")
			.setDesc(`Creates "${SETUP_NOTE_PATH}" in the vault root with the exact commands for the missing pieces. Never overwrites an existing note.`)
			.addToggle((t) => t.setValue(this.data.writeSetupNote).onChange((v) => { this.data.writeSetupNote = v; }));
	}

	render_bibles(c) {
		const s = this.surveyVault();
		c.createEl("p", {
			text:
				"Download Bible text now? These translations are public domain — free to store " +
				"whole in your vault. The wizard downloads them and builds the search page, no " +
				"other tools needed. Existing files are never overwritten.",
		});
		for (const d of DOWNLOADABLE) {
			const complete = isTranslationComplete(this.app, d.trans);
			const partial = !complete && s.translations.includes(d.trans);
			if (partial) this.data.downloads[d.trans] = true;
			new Setting(c)
				.setName(d.label + (complete ? " — already in this vault" : partial ? " — partially downloaded, will resume" : ""))
				.setDesc(d.desc)
				.addToggle((t) => t
					.setValue(complete ? false : this.data.downloads[d.trans])
					.setDisabled(complete)
					.onChange((v) => { this.data.downloads[d.trans] = v; }));
		}
		const lic = c.createEl("details", { cls: "bible-search-ref" });
		lic.createEl("summary", {
			text: "Why no ESV, NIV, CSB, NLT or AMP? (And how to add one you're licensed to store.)",
		});
		lic.createEl("pre", { text: LICENSED_REF.body });
		c.createEl("p", {
			cls: "setting-item-description",
			text: "Each translation is ~1,200 small notes and takes a few minutes on a normal connection.",
		});
	}

	// Which downloads are actually actionable: picked, and not fully downloaded.
	// A partial translation (aborted download) stays pending so a re-run resumes it.
	pendingDownloads() {
		return computePending(this.app, this.data.downloads);
	}

	// Detected presence per content layer, for the Extras step. The two folder-less
	// layers are present when their source module OR downloaded pack is in the vault —
	// the same files their builders read.
	layerStatus() {
		const v = this.app.vault;
		const mdCount = (folder) => v.getMarkdownFiles()
			.filter((f) => f.path.startsWith(folder + "/") && !/^readme$/i.test(f.basename)).length;
		const packPresent = {
			onthisday: () =>
				!!(v.getAbstractFileByPath("tools/data/on-this-day.js") ||
					v.getAbstractFileByPath(ONTHISDAY_PACK_PATH)),
			churchhistory: () =>
				!!(v.getAbstractFileByPath("tools/data/denominations.js") ||
					v.getAbstractFileByPath(CHURCHHISTORY_PACK_PATH)),
		};
		const out = {};
		for (const L of CONTENT_LAYERS) {
			out[L.key] = L.folder ? { present: mdCount(L.folder) > 0, count: mdCount(L.folder) }
				: { present: packPresent[L.key]() };
		}
		return out;
	}

	render_extras(c) {
		c.createEl("p", {
			text:
				"The Bible is the core. These extra search layers are optional — include the ones you want. " +
				"Each becomes its own tab; a layer with no content is left out automatically.",
		});
		const st = this.layerStatus();
		for (const L of CONTENT_LAYERS) {
			const { present, count } = st[L.key];
			let desc;
			if (L.key === "articles") {
				desc = present
					? `${count} notes in Teaching/.`
					: "Add teaching notes under Teaching/ and rebuild. Articles can't be bundled — most are copyrighted.";
			} else if (L.key === "onthisday") {
				desc = present
					? "Christian-year calendar data is in this vault."
					: "Not in this vault yet — download the shareable pack (original blurbs + public data, no copyrighted text).";
			} else if (L.key === "churchhistory") {
				desc = present
					? "Denomination family-tree data is in this vault."
					: "Not in this vault yet — download the shareable pack (original blurbs + public data, no copyrighted text).";
			} else {
				desc = present ? `${count} notes in ${L.folder}/.` : `No notes in ${L.folder}/ yet — add some and rebuild.`;
			}
			const setting = new Setting(c)
				.setName(L.label)
				.setDesc(desc)
				.addToggle((t) => t.setValue(this.data.layers[L.key]).onChange((v) => { this.data.layers[L.key] = v; }));
			// The two shareable layers — offer the pack download when absent.
			const PACKS = {
				onthisday:     { dl: downloadOnThisDayPack,     done: (n) => `On This Day pack added — ${n} calendar days.` },
				churchhistory: { dl: downloadChurchHistoryPack, done: (n) => `Church History pack added — ${n} branches.` },
			};
			if (PACKS[L.key] && !present) {
				setting.addButton((b) => b
					.setButtonText("Download pack")
					.onClick(async () => {
						b.setButtonText("Downloading…").setDisabled(true);
						try {
							const n = await PACKS[L.key].dl(this.app);
							this.data.layers[L.key] = true;
							new Notice(PACKS[L.key].done(n));
							this.renderStep(); // re-detect: now shows as present + on
						} catch (e) {
							new Notice(e && e.message ? e.message : String(e), 8000);
							b.setButtonText("Download pack").setDisabled(false);
						}
					}));
			}
		}
	}

	render_prefs(c) {
		new Setting(c)
			.setName("Open notes in a new tab")
			.setDesc("Keep the search tab in place when a verse or article link is clicked.")
			.addToggle((t) => t.setValue(this.data.openNotesInNewTab).onChange((v) => { this.data.openNotesInNewTab = v; }));
	}

	render_finish(c) {
		const pending = this.mode === "create" ? this.pendingDownloads() : [];
		c.createEl("p", {
			text: this.mode === "connect"
				? "Connecting to the existing search file and saving these settings:"
				: "Ready to finish — this is what happens next:",
		});
		const ul = c.createEl("ul");
		ul.createEl("li", { text: `Search interface file: ${this.data.htmlPath}` });
		ul.createEl("li", { text: `Open notes in a new tab: ${this.data.openNotesInNewTab ? "yes" : "no"}` });
		const included = CONTENT_LAYERS.filter((l) => this.data.layers[l.key]).map((l) => l.label);
		ul.createEl("li", { text: `Extra layers: ${included.length ? included.join(", ") : "none — Bible only"}` });
		for (const d of pending) {
			ul.createEl("li", { text: `Download ${d.label}${d.anchor ? " — anchor translation" : ""}` });
		}
		if (pending.length) {
			ul.createEl("li", { text: `Build the search page at "${this.data.htmlPath}" and open it` });
		}
		if (this.mode === "create" && this.data.writeSetupNote) {
			ul.createEl("li", { text: `Checklist note: ${SETUP_NOTE_PATH} (skipped if it already exists)` });
		}
	}

	/* ── apply ─────────────────────────────────────────────── */

	// Idempotent: skip any file that already exists, so a re-run or a racing
	// device sync never overwrites real data. (No write-guard stamp needed —
	// the plugin's modify-watcher only watches htmlPath, which the wizard only
	// writes through the build, which the watcher is supposed to see.)
	async writeIfAbsent(path, content) {
		await writeIfAbsent(this.app, path, content);
	}

	setupNoteContent(survey) {
		const s = survey || this.surveyVault();
		const toolingMissing = [
			!s.tooling.builder && "`Bible/build-bible-search.js`",
			!s.tooling.template && "`Bible/bible-search-template.html`",
			!s.tooling.importer && "`tools/` (the whole folder, including `lib/` and `data/`)",
		].filter(Boolean);

		const sections = [];
		if (toolingMissing.length) {
			sections.push(
				"## Get the tooling\n\n" +
				`This vault is missing: ${toolingMissing.join(", ")}.\n` +
				"Copy them from a vault that has the system — the share rules and full copy list\n" +
				"are in `docs/starter-kit-setup.html` (what may travel: the code, KJV, the enrichment;\n" +
				"what may not: ESV/NLT/AMP text, Teaching articles, a built `Bible Search.html`)."
			);
		}
		if (!s.translations.length) {
			sections.push(
				"## Import Bible text\n\n" +
				"Easiest: re-run the setup wizard (command palette → \"Bible Search: Run setup wizard\") and let it\n" +
				"download KJV/BSB/WEB and build the search — no other tools needed. The Node importer\n" +
				"below does the same from a terminal:\n\n" +
				"KJV (public domain) is the anchor — it owns the bare `Ruth 1` stems everything links to.\n" +
				"BSB (public domain since 2023) is the readable modern one. Both are legal to store.\n\n" +
				"```\n" +
				"# prove the shape with one book first\n" +
				"node tools/import-bible.js . KJV --api eng_kjv --anchor --book Ruth\n" +
				"node tools/import-bible.js . BSB --book Ruth\n" +
				"\n" +
				"# happy? do the whole Bible (a few minutes each)\n" +
				"node tools/import-bible.js . KJV --api eng_kjv --anchor\n" +
				"node tools/import-bible.js . BSB\n" +
				"```"
			);
		} else if (!s.anchor) {
			sections.push(
				"## Fix the anchor translation\n\n" +
				`Found ${s.translations.join(", ")}, but none uses unsuffixed chapter files (\`Ruth 1.md\`).\n` +
				"Exactly one translation must own the bare stems — everything generated links to it.\n" +
				"Re-import one with `--anchor` (keep it KJV unless you're prepared to regenerate\n" +
				"every cross-reference)."
			);
		}
		sections.push(
			"## Build the search\n\n" +
			"```\n" + this.buildCmd() + "\n```"
		);
		sections.push(
			"## Open it\n\n" +
			'Click the book icon in the left ribbon, or Cmd/Ctrl+P → "Open Bible Search".\n' +
			"If the view opens blank, check Settings → Bible Search → *Search interface file*\n" +
			`matches where the build wrote the HTML (currently set to \`${this.data.htmlPath}\`).`
		);

		return (
			"# Bible Search setup\n\n" +
			"Written by the Bible Search setup wizard — delete this note once the search is running.\n" +
			"Run every command from the vault root (the folder that contains `.obsidian`), on a\n" +
			"desktop with Node.js installed.\n\n" +
			sections.join("\n\n") + "\n"
		);
	}

	// The only method that touches disk.
	async apply() {
		const p = this.plugin;
		try {
			p.settings.htmlPath = normalizePath(this.data.htmlPath);
			p.settings.openNotesInNewTab = this.data.openNotesInNewTab;
			p.settings.layers = { ...this.data.layers };
			p.settings.onboarded = true;
			await p.saveSettings();
			if (this.mode === "connect") {
				this.finished = true;
				const layersChanged = JSON.stringify(this.data.layers) !== this._initialLayers;
				const hasText = surveyTranslations(this.app).translations.length > 0;
				this.close();
				p.refreshViews();
				// A layer change only reaches the page through a rebuild. Do it now when
				// the vault has the Bible text to build from; otherwise say so plainly.
				if (layersChanged && hasText) {
					new Notice("Bible Search connected — rebuilding to apply your layer choices.");
					await p.rebuildIndex();
				} else {
					new Notice(layersChanged
						? "Bible Search connected — run “Rebuild search index” to apply your layer choices."
						: "Bible Search connected.", layersChanged ? 8000 : 4000);
				}
				await p.activateView();
				return;
			}

			const survey = this.surveyVault();
			const pending = this.pendingDownloads();
			if (this.data.writeSetupNote) {
				await this.writeIfAbsent(SETUP_NOTE_PATH, this.setupNoteContent());
			}
			// Only bail to the manual checklist when there is nothing to download
			// AND no Bible text to build from. With text in the vault (even from an
			// earlier aborted run), fall through so the template fetch + build always
			// happen — otherwise the wizard ends with no search page.
			if (!pending.length && !survey.translations.length) {
				this.finished = true;
				this.close();
				new Notice("Setup saved" + (this.data.writeSetupNote ? ` — follow "${SETUP_NOTE_PATH}" to build the search.` : "."), 6000);
				if (this.data.writeSetupNote) this.app.workspace.openLinkText(SETUP_NOTE_PATH, "", true);
				return;
			}

			// Download + build. `finished` is set now so closing the modal mid-way
			// doesn't fire the "setup skipped" notice — the work carries on and
			// announces itself when done. The resume ticket is written first, so if
			// this run is interrupted (quit, sleep, network), the plugin resumes it
			// automatically on the next launch.
			p.settings.setupDownloads = { ...this.data.downloads };
			await p.saveSettings();
			this.finished = true;
			await this.runDownloads(pending);
		} catch (e) {
			new Notice("Setup failed: " + (e && e.message ? e.message : e), 8000);
		}
	}

	// Long-running phase: swap the modal to a progress panel, fetch each
	// translation, make sure the template exists, build, open the view.
	async runDownloads(pending) {
		const c = this.contentEl;
		c.empty();
		c.createDiv({ cls: "bible-search-onb-step", text: "Downloading Bible text" });
		const status = c.createEl("p", { text: "Starting…" });
		c.createEl("p", {
			cls: "setting-item-description",
			text: "This takes a few minutes per translation. Closing this window won't stop it — a notice appears when everything is ready.",
		});
		const setStatus = (t) => { status.setText(t); };

		try {
			const { built, problems } = await runSetupPipeline(this.app, this.plugin.settings.htmlPath, pending, setStatus, this.plugin.settings.layers);
			this.close();
			if (problems.length) {
				// Built, but with gaps — keep the ticket so the next launch resumes.
				new Notice(
					`Bible Search built, but some downloads didn't finish (${problems.join("; ")}). ` +
					"It will resume automatically on the next launch — finished files are kept.",
					12000
				);
			} else {
				this.plugin.settings.setupDownloads = null;
				await this.plugin.saveSettings();
				new Notice(
					`Bible Search ready — ${built.verses.toLocaleString()} verses across ${built.translations.join(", ")}.`,
					8000
				);
			}
			this.plugin.refreshViews();
			await this.plugin.activateView();
		} catch (e) {
			// Ticket stays set: the next launch picks this up automatically.
			const msg = e && e.message ? e.message : String(e);
			setStatus("Failed: " + msg);
			new Notice("Bible setup didn't finish: " + msg + " — it resumes automatically on the next launch; finished files are kept.", 10000);
		}
	}
}

class BibleSearchView extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.frame = null;
		this.renderGen = 0; // bumped per render / on close to invalidate stale in-flight reads
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return "Bible Search";
	}

	getIcon() {
		return "book-open-text";
	}

	async onOpen() {
		await this.render();
	}

	async render() {
		// Guard against overlapping renders and against continuing past onClose:
		// a rebuild-while-open (two modify events) or a close during the slow 20 MB
		// read would otherwise leak the Blob or mount a second iframe. Each render
		// takes a token; if a newer one started (or the view closed) while we awaited
		// the read, we revoke the URL we just made and bail.
		const gen = ++this.renderGen;
		const container = this.contentEl;
		container.empty();
		container.addClass("bible-search-view");
		this.releaseBlob();

		const showError = (title, detail) => {
			const box = container.createDiv({ cls: "bible-search-error" });
			box.createEl("h3", { text: title });
			for (const line of detail) box.createEl("p", { text: line });
		};

		const path = this.plugin.settings.htmlPath;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			showError("Bible Search file not found", [
				`Looked for: ${path}`,
				"Set the correct path in Settings → Bible Search, or regenerate the file.",
			]);
			return;
		}

		// The page is ~20 MB. Reuse a plugin-level Blob URL keyed on the file's
		// mtime+size, so closing/reopening the view — or a rebuild firing "modify"
		// more than once — doesn't re-read and re-decode 20 MB from the (iCloud-
		// backed) vault each time. Only a genuine content change (mtime/size moves)
		// pays the read again. On mobile this is the difference between an instant
		// reopen and a multi-second stall plus a fresh 20 MB ArrayBuffer for the GC.
		let blobUrl = this.plugin.cachedHtmlBlobUrl(path, file.stat);
		if (!blobUrl) {
			// readBinary, not cachedRead: cachedRead would UTF-8 decode it into a JS
			// string AND hold that string in Obsidian's read cache for the session —
			// two 20 MB copies before the iframe has parsed anything. The ArrayBuffer
			// goes straight into the Blob; the browser decodes it once, lazily.
			let buf;
			try {
				buf = await this.app.vault.readBinary(file);
			} catch (e) {
				// On an iCloud vault a 20 MB file can be evicted/undownloaded — surface it
				// rather than leaving a blank pane. (Only if we're still the live render.)
				if (gen === this.renderGen) {
					showError("Couldn't load Bible Search", [
						String(e && e.message ? e.message : e),
						"The file may still be syncing from iCloud. Try again in a moment, or rebuild it.",
					]);
				}
				return;
			}

			// A newer render started, or the view closed, while we were reading. Don't
			// touch the (possibly detached) container, and don't build a Blob nobody mounts.
			if (gen !== this.renderGen) return;

			blobUrl = this.plugin.storeHtmlBlob(path, file.stat, buf);
		}

		const iframe = container.createEl("iframe", { cls: "bible-search-frame" });
		iframe.addEventListener("load", () => {
			if (gen !== this.renderGen) return; // superseded between src-set and load
			this.frame = iframe;
			this.wireBridge(iframe);
			this.syncTheme();
		});
		iframe.src = blobUrl;
	}

	// Match the app rather than the OS — inside Obsidian, Obsidian's theme is the truth.
	// The page ignores this if the reader made an explicit choice with the theme chip.
	syncTheme() {
		const theme = document.body.classList.contains("theme-light") ? "light" : "dark";
		this.frame?.contentWindow?.setBibleSearchTheme?.(theme);
	}

	/*
	 * Same-origin (blob) iframe: capture clicks on the generator's
	 * obsidian://open links and open the note inside this window
	 * instead of bouncing through the OS protocol handler.
	 */
	wireBridge(iframe) {
		const doc = iframe.contentDocument;
		if (!doc) return;

		// Split builds keep verse text in Bible/search-data/*.json; the page (a
		// same-origin blob iframe) pulls each translation through this hook on
		// first use. The id whitelist is strict — the page is ours, but nothing
		// coming out of an iframe gets to name an arbitrary vault path.
		const win = iframe.contentWindow;
		if (win) {
			win.bibleSearchLoadData = async (id) => {
				if (!/^bd-[A-Za-z0-9]{1,24}$/.test(id)) throw new Error("Unknown payload: " + id);
				const p = normalizePath(`${DATA_PATH}/${id}.json`);
				const f = this.app.vault.getAbstractFileByPath(p);
				if (!(f instanceof TFile)) {
					throw new Error(`${id.slice(3)} verse data not found at "${p}" — it may still be syncing from iCloud. Run "Rebuild search index" if it never appears.`);
				}
				// readBinary + decode: the string is handed to the page and parsed
				// once there — no copy lingering in Obsidian's read cache.
				return new TextDecoder().decode(await this.app.vault.readBinary(f));
			};
			// Warm the default translation once the shell has settled, so the first
			// search hits parsed data instead of waiting on a disk read.
			setTimeout(() => {
				try { win.bibleSearchPrefetch?.(); } catch (e) { /* page gone — fine */ }
			}, 800);
		}

		doc.addEventListener(
			"click",
			(evt) => {
				// evt.target belongs to the iframe's realm, so `instanceof Element` against
				// OUR realm's Element is always false — duck-type on .closest instead.
				const target = evt.target && typeof evt.target.closest === "function" ? evt.target : null;
				const anchor = target && target.closest('a[href^="obsidian://"]');
				if (!anchor) return;

				// Anchors marked data-open belong to the page's in-page reader
				// ("Read ↗", verse numbers) — the page preventDefaults them itself;
				// their obsidian:// href is only a right-click fallback. Intercepting
				// here would hijack them into opening the note instead of the reader.
				if (anchor.hasAttribute("data-open")) return;

				evt.preventDefault();
				evt.stopPropagation();

				const href = anchor.getAttribute("href") || "";
				const query = href.split("?")[1] || "";
				const linkPath = new URLSearchParams(query).get("file");
				if (!linkPath) return;

				const newTab = this.plugin.settings.openNotesInNewTab;
				this.app.workspace.openLinkText(linkPath, "", newTab);
			},
			true
		);
	}

	releaseBlob() {
		// The Blob URL is now owned and cached by the plugin (shared across opens and
		// across leaves), so the view no longer revokes it — closing one view must not
		// pull the URL out from under another, nor discard the cache we reopen from.
		this.frame = null;
	}

	async onClose() {
		// Invalidate any render still awaiting its read, so its continuation bails
		// instead of mounting an iframe on this detached view.
		this.renderGen++;
		this.releaseBlob();
	}
}

class BibleSearchSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Open a vault note, closing the settings modal behind us so the note is actually visible.
	openDoc(path) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file) {
			new Notice(`Not found: ${path}`);
			return;
		}
		this.app.setting?.close?.();
		this.app.workspace.openLinkText(path, "", true);
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		/* ── interface ─────────────────────────────────────────── */
		new Setting(containerEl).setName("Interface").setHeading();

		new Setting(containerEl)
			.setName("Search interface file")
			.setDesc("Vault path to the generated Bible Search HTML.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.htmlPath)
					.setValue(this.plugin.settings.htmlPath)
					.onChange(async (value) => {
						const raw = value.trim() || DEFAULT_SETTINGS.htmlPath;
						// Normalize so the stored path matches what the modify-event filter
						// compares against (file.path is always normalized).
						this.plugin.settings.htmlPath = normalizePath(raw);
						await this.plugin.saveSettings();
						this.plugin.refreshViews(); // already debounced
					})
			);

		new Setting(containerEl)
			.setName("Open notes in a new tab")
			.setDesc("Keep the search tab in place when a verse or article link is clicked.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openNotesInNewTab).onChange(async (value) => {
					this.plugin.settings.openNotesInNewTab = value;
					await this.plugin.saveSettings();
				})
			);

		/* ── content layers ────────────────────────────────────── */
		new Setting(containerEl).setName("Content layers").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"The Bible is always searchable. Turn an extra layer off to leave it out of the " +
				"built page — its tab disappears and the file gets a little smaller. A layer with no " +
				"content is skipped automatically. Rebuild for changes to take effect.",
		});
		const mdCount = (folder) => this.app.vault.getMarkdownFiles()
			.filter((f) => f.path.startsWith(folder + "/") && !/^readme$/i.test(f.basename)).length;
		const packPresent = {
			onthisday: () =>
				!!(this.app.vault.getAbstractFileByPath("tools/data/on-this-day.js") ||
					this.app.vault.getAbstractFileByPath(ONTHISDAY_PACK_PATH)),
			churchhistory: () =>
				!!(this.app.vault.getAbstractFileByPath("tools/data/denominations.js") ||
					this.app.vault.getAbstractFileByPath(CHURCHHISTORY_PACK_PATH)),
		};
		for (const L of CONTENT_LAYERS) {
			const n = L.folder ? mdCount(L.folder) : 0;
			const desc = L.folder
				? (n ? `${n} note${n === 1 ? "" : "s"} in ${L.folder}/` : `No notes in ${L.folder}/ yet`)
				: (packPresent[L.key]() ? `${L.label} data found in this vault` : `No ${L.label} data in this vault yet`);
			new Setting(containerEl)
				.setName(L.label)
				.setDesc(desc)
				.addToggle((t) => t
					.setValue(layerEnabled(this.plugin.settings.layers, L.key))
					.onChange(async (v) => {
						this.plugin.settings.layers = { ...this.plugin.settings.layers, [L.key]: v };
						await this.plugin.saveSettings();
					}));
		}
		new Setting(containerEl)
			.setDesc("Changes apply the next time the page is built.")
			.addButton((b) => b
				.setButtonText("Rebuild now")
				.setCta()
				.onClick(() => this.plugin.rebuildIndex()));

		/* ── rebuilding ────────────────────────────────────────── */
		new Setting(containerEl).setName("Rebuilding").setHeading();

		const status = this.app.vault.getAbstractFileByPath(this.plugin.settings.htmlPath)
			? `Found — this tab reloads itself whenever the file is rebuilt.`
			: `Missing at "${this.plugin.settings.htmlPath}" — build it, or correct the path above.`;

		new Setting(containerEl)
			.setName("Rebuild the search index")
			.setDesc(
				`The interface is generated from the vault: Bible full text plus every article under Teaching/. ` +
					`Rebuild after adding or editing content. ${status}`
			)
			.addButton((btn) =>
				btn
					.setButtonText("Rebuild now")
					.setCta()
					.onClick(() => this.plugin.rebuildIndex())
			);

		// The terminal path is only advertised when the Node builder actually ships
		// in this vault — a slim clone (enrichment kit parked) skips it entirely.
		const has = (p) => !!this.app.vault.getAbstractFileByPath(p);
		if (has("Bible/build-bible-search.js")) {
			const rebuild = new Setting(containerEl)
				.setName("Rebuild from the terminal instead")
				.setDesc(
					"The Node builder produces the same page." +
						(has("tools/gen-hubs.js")
							? " It pairs with the enrichment generators (cross-references, hubs, commentary)."
							: "") +
						" Run from the vault root."
				);
			rebuild.addButton((btn) =>
				btn
					.setButtonText("Copy command")
					.onClick(async () => {
						// navigator.clipboard can be missing/blocked in WKWebView (Obsidian iOS).
						try {
							await navigator.clipboard.writeText(REBUILD_CMD);
							new Notice("Rebuild command copied");
						} catch (e) {
							new Notice("Couldn't access the clipboard — select the command below and copy it.");
						}
					})
			);
			containerEl.createEl("pre", { cls: "bible-search-cmd", text: REBUILD_CMD });
		}

		/* ── documentation ─────────────────────────────────────── */
		// Only the docs this vault actually has — nothing advertised as "(missing)".
		const docs = DOCS.filter((doc) => has(doc.path));
		if (docs.length) {
			new Setting(containerEl).setName("Documentation").setHeading();
			containerEl.createEl("p", {
				cls: "setting-item-description bible-search-doclead",
				text:
					"Each folder documents the shape its content must take. Get the shape right and the " +
					"content is picked up on the next rebuild — no configuration here.",
			});

			for (const doc of docs) {
				new Setting(containerEl)
					.setName(doc.name)
					.setDesc(doc.desc)
					.addButton((btn) =>
						btn
							.setButtonText(doc.path)
							.onClick(() => this.openDoc(doc.path))
					);
			}
		}

		/* ── quick reference ───────────────────────────────────── */
		new Setting(containerEl).setName("Quick reference").setHeading();

		for (const ref of QUICK_REF) {
			const details = containerEl.createEl("details", { cls: "bible-search-ref" });
			details.createEl("summary", { text: ref.title });
			details.createEl("pre", { text: ref.body });
		}

		/* ── setup ─────────────────────────────────────────────── */
		new Setting(containerEl).setName("Setup").setHeading();

		new Setting(containerEl)
			.setName("Setup wizard")
			.setDesc("Re-run the first-run wizard — locate the search file (or plan the build on a fresh vault) and set preferences.")
			.addButton((btn) =>
				btn.setButtonText("Run setup wizard").onClick(() => new OnboardingWizard(this.app, this.plugin).open())
			);
	}
}

class BibleSearchPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new BibleSearchView(leaf, this));

		this.addRibbonIcon("book-open-text", "Open Bible Search", () => this.activateView());
		this.addCommand({
			id: "open",
			name: "Open search",
			callback: () => this.activateView(),
		});
		this.addCommand({
			id: "setup",
			name: "Run setup wizard",
			callback: () => new OnboardingWizard(this.app, this).open(),
		});
		this.addCommand({
			id: "rebuild",
			name: "Rebuild search index",
			callback: () => this.rebuildIndex(),
		});

		this.addSettingTab(new BibleSearchSettingTab(this.app, this));

		// First-run wizard / interrupted-setup resume, after layout-ready so the
		// vault is indexed before we probe. A live resume ticket outranks
		// everything: it means a wizard run didn't finish (quit, sleep, network),
		// so pick it up silently — no one should have to notice it failed.
		// Otherwise, silent adoption is the load-bearing safety: if the flag is
		// unset but the search HTML already exists (existing user, new device,
		// restored sync), adopt without opening anything. Only truly-empty
		// installs see the wizard.
		this.app.workspace.onLayoutReady(async () => {
			if (this.settings.setupDownloads) { await this.resumeSetup(); return; }
			if (this.settings.onboarded) return;
			if (this.hasData()) {
				this.settings.onboarded = true;
				await this.saveSettings();
				return;
			}
			new OnboardingWizard(this.app, this).open();
		});

		// The tools/ pipeline rewrites the HTML on regeneration — reload open views.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file.path === normalizePath(this.settings.htmlPath)) this.refreshViews();
			})
		);

		// Obsidian fires css-change when the theme flips — carry it into the iframe.
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
					if (leaf.view instanceof BibleSearchView) leaf.view.syncTheme();
				}
			})
		);
	}

	onunload() {
		// registerView/registerEvent clean themselves up; the refresh debounce is a
		// raw setTimeout, so it's ours to cancel — otherwise a pending tick can fire
		// against views that are already gone.
		clearTimeout(this._refreshTimer);
		this.releaseHtmlBlob();
	}

	// ── Shared Blob-URL cache for the generated HTML ─────────────────────────
	// One 20 MB Blob URL, owned by the plugin and keyed on the file's mtime+size,
	// reused by every BibleSearchView open until the file actually changes. This
	// turns close/reopen (and a rebuild's repeated "modify" events) from a 20 MB
	// re-read into a no-op — the single biggest repeat cost on mobile / iCloud.

	// Return the cached URL when it still matches the file on disk, else null.
	cachedHtmlBlobUrl(path, stat) {
		const c = this._htmlBlob;
		return c && c.path === path && c.mtime === stat.mtime && c.size === stat.size
			? c.url
			: null;
	}

	// Build a fresh Blob URL for `buf`, revoking any previous one, and cache it.
	storeHtmlBlob(path, stat, buf) {
		this.releaseHtmlBlob();
		const url = URL.createObjectURL(new Blob([buf], { type: "text/html" }));
		this._htmlBlob = { path, mtime: stat.mtime, size: stat.size, url };
		return url;
	}

	// Revoke and forget the cached Blob URL (on unload, or when the file changes).
	releaseHtmlBlob() {
		if (this._htmlBlob) {
			URL.revokeObjectURL(this._htmlBlob.url);
			this._htmlBlob = null;
		}
	}

	// Finish an interrupted wizard run. The ticket in settings.setupDownloads
	// survives quits, crashes and network drops; this re-derives what's still
	// missing (finished translations drop out via the book-note markers) and
	// runs the same pipeline the wizard uses. The ticket is cleared only when
	// every pick is complete AND the search page is built.
	async resumeSetup() {
		if (this._setupRunning) return;
		this._setupRunning = true;
		try {
			const pending = computePending(this.app, this.settings.setupDownloads);
			if (!pending.length && this.hasData()) {
				// Finished after all (completed elsewhere, or synced in) — retire it.
				this.settings.setupDownloads = null;
				await this.saveSettings();
				return;
			}
			const notice = new Notice("Bible Search: resuming interrupted setup…", 0);
			try {
				const { built, problems } = await runSetupPipeline(
					this.app, this.settings.htmlPath, pending,
					(t) => notice.setMessage("Bible Search: " + t), this.settings.layers);
				notice.hide();
				if (problems.length) {
					new Notice(`Bible Search: still incomplete (${problems.join("; ")}) — will try again on the next launch.`, 10000);
				} else {
					this.settings.setupDownloads = null;
					await this.saveSettings();
					new Notice(`Bible Search setup finished — ${built.verses.toLocaleString()} verses across ${built.translations.join(", ")}.`, 8000);
				}
				this.refreshViews();
			} catch (e) {
				notice.hide();
				new Notice("Bible Search: resume failed (" + (e && e.message ? e.message : e) + ") — will try again on the next launch.", 10000);
			}
		} finally {
			this._setupRunning = false;
		}
	}

	// Same anchor predicate as the wizard's detectExisting — keep the two in sync.
	hasData() {
		return this.app.vault.getAbstractFileByPath(normalizePath(this.settings.htmlPath)) instanceof TFile;
	}

	// In-app rebuild: same output as the Node builder, no terminal required.
	// (The enrichment generators — cross-refs, hubs, commentary — are still
	// Node-only; this only rebuilds the search page itself.)
	async rebuildIndex() {
		if (this._rebuilding) { new Notice("A rebuild is already running."); return; }
		this._rebuilding = true;
		const notice = new Notice("Rebuilding Bible Search…", 0);
		try {
			// A fresh vault (or an aborted wizard run) may not have the template yet —
			// fetch it from the pinned release rather than failing with a dead end.
			if (!(this.app.vault.getAbstractFileByPath(normalizePath(TEMPLATE_PATH)) instanceof TFile)) {
				notice.setMessage("Fetching the search template…");
				const res = await requestUrl({ url: TEMPLATE_URL });
				await writeIfAbsent(this.app, TEMPLATE_PATH, res.text);
			}
			const r = await buildSearchIndex(this.app, this.settings.htmlPath, (t) => notice.setMessage(t), this.settings.layers);
			notice.hide();
			const extras = [
				r.articles && `${r.articles} articles`,
				r.topics && `${r.topics} topics`,
				r.faq && `${r.faq} FAQ`,
				r.history && `${r.history} history`,
				r.onthisday && `${r.onthisday} On This Day days`,
				r.churchhistory && `${r.churchhistory} Church History branches`,
			].filter(Boolean).join(", ");
			new Notice(`Rebuilt "${this.settings.htmlPath}" — ${r.verses.toLocaleString()} verses${extras ? `, ${extras}` : ""}.`, 6000);
		} catch (e) {
			notice.hide();
			new Notice("Rebuild failed: " + (e && e.message ? e.message : e), 8000);
		} finally {
			this._rebuilding = false;
		}
	}

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	refreshViews() {
		// The external 20 MB write fires "modify" more than once, sometimes mid-write.
		// Debounce so open views re-render once, after the writes settle — avoids torn
		// reads and back-to-back renders.
		clearTimeout(this._refreshTimer);
		this._refreshTimer = setTimeout(() => {
			// The file was rewritten — drop the cached Blob so the re-render reads the
			// new bytes. (render() also guards on mtime/size; this frees the stale
			// 20 MB immediately rather than waiting for the next createObjectURL.)
			this.releaseHtmlBlob();
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
				if (leaf.view instanceof BibleSearchView) leaf.view.render();
			}
		}, 300);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

module.exports = BibleSearchPlugin;
// For the node smoke test only — Obsidian ignores extra properties.
module.exports.OnboardingWizard = OnboardingWizard;
module.exports.BibleSearchView = BibleSearchView;
module.exports.__testables = {
	BOOK_ORDER, BOOK_IDS, DOWNLOADABLE, HELLOAO_API, TEMPLATE_PATH,
	apiVerseText, toParagraphs, fmValue, fmList, isHub, firstHeading, firstUrl, safeUrl,
	collectNotesFromVault, buildOnThisDayFromVault, CONTENT_LAYERS, layerEnabled,
	downloadOnThisDayPack, ONTHISDAY_PACK_PATH,
	buildChurchHistoryFromVault, downloadChurchHistoryPack, CHURCHHISTORY_PACK_PATH,
	surveyTranslations, buildSearchIndex, importTranslation, writeIfAbsent,
	isTranslationComplete, fetchJson, runSetupPipeline, computePending,
};
