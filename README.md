# Bible Search

Full-text Bible search and reading in a first-class Obsidian view. A setup wizard
downloads public-domain translations, builds a searchable page from your vault, and
opens it in a pane — no terminal, no build step, no extra tooling.

Works on desktop and mobile.

## What it does

- **Search the whole Bible from a pane.** Click the book icon in the ribbon, type a
  phrase, jump to the verse. Results link straight back to the note in your vault.
- **Sets itself up on first run.** The wizard asks where the search page should live
  and which translations you want, downloads them, builds the index, and opens it.
- **Survives interruptions.** If a download is cut short by a quit, a sleep, or a
  dropped connection, the next launch picks up exactly where it stopped. A single bad
  chapter is recorded and skipped, not fatal.
- **Adopts an existing setup silently.** If the search page is already in the vault —
  a second device, a restored sync, a re-install — the plugin adopts it without
  showing you anything. Only genuinely empty installs see the wizard.
- **Follows your theme.** The view re-syncs when Obsidian's theme changes.

## Install

**From the community store** (once approved): Settings → Community plugins → Browse →
search "Bible Search" → Install → Enable.

**Manually:** download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](https://github.com/RuanPienaarCode/obsidian-bible-search/releases/latest)
into `<your vault>/.obsidian/plugins/bible-search/`, then enable the plugin in
Settings → Community plugins.

## Getting started

On first run the wizard opens automatically. It asks for:

1. **Where the search page lives** — defaults to `Bible Search.html` at the vault root.
2. **Which translations to download** — **KJV** and **BSB** are pre-selected, **WEB** is
   optional. All three are public domain.

Downloading takes a few minutes per translation. When it finishes, the search page is
built and opened.

Re-run it any time from the command palette:

| Command | What it does |
| --- | --- |
| **Bible Search: Run setup wizard** | Re-runs the wizard (add translations, move the page) |
| **Bible Search: Open search** | Opens the search view |
| **Bible Search: Rebuild search index** | Rebuilds the page after editing vault content |

## Network use

This plugin makes network requests to exactly two hosts, both only during setup or a
rebuild — never in the background, never on a schedule:

| Host | What for |
| --- | --- |
| `bible.helloao.org` | Downloads the Bible text you selected in the wizard (Free Use Bible API) |
| `raw.githubusercontent.com` | Fetches the search-page template, only if your vault doesn't already have `Bible/bible-search-template.html` |

No telemetry, no analytics, no account, and nothing is sent anywhere. Downloaded text
is written into your vault as ordinary Markdown notes that you own.

## Translations and licensing

The wizard only offers translations that are **public domain**: **KJV**, **BSB**
(public domain since 2023), and **WEB**.

Copyrighted translations — ESV, NLT, AMP and most modern versions — licence *passage*
quotation, not whole-Bible storage. They are deliberately not offered for download.
If you hold the rights to a translation's full text, the plugin's in-app guide (in
Settings) shows the exact note format to add it yourself.

**Do not share a built search page from a vault containing copyrighted translations** —
the page embeds the full text. Each person should build their own from their own vault,
which is what the wizard is for.

## The full vault

This plugin is the search half of a larger starter kit. If you want the whole thing —
the Bible note structure, the search-page template, the Node importer, and a Teaching
article layout — see
[scripture-vault](https://github.com/RuanPienaarCode/scripture-vault).

## Credits

- Bible text: [bible.helloao.org](https://bible.helloao.org) (Free Use Bible API)

## Licence

MIT — see [LICENSE](LICENSE).
