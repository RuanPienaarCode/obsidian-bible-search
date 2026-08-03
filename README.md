# Bible Search

Full-text Bible search and reading, in a pane, inside your vault. Local, free, no account.

**Install:** Settings → Community plugins → Browse → "Bible Search" → Install → Enable.
A setup wizard does the rest.

---

## Features

| | |
| --- | --- |
| 🔍 **Search** | Every verse, instantly. Results link back to the note. |
| 🧙 **Zero setup** | First-run wizard downloads the text and builds the page. No terminal. |
| 🔒 **Local** | No account, no cloud, no telemetry. Text lands in your vault as notes. |
| 📱 **Mobile** | Desktop and mobile, Obsidian 1.4.0+. Follows your theme. |
| ♻️ **Resumable** | Interrupted downloads pick up where they stopped. |

## Setup

The wizard asks two questions:

- **Where does the search page live?** Default: `Bible Search.html` at the vault root.
- **Which translations?** KJV ✓ · BSB ✓ · WEB (optional). All public domain.

A few minutes per translation, then it builds and opens. Already set up on another
device? It adopts the existing page silently.

## Commands

- `Bible Search: Open search` — or click the book icon in the ribbon
- `Bible Search: Rebuild search index` — after editing vault content
- `Bible Search: Run setup wizard` — add translations, move the page

## Network

Two hosts, only during setup or rebuild. Never in the background, never on a schedule.

- `bible.helloao.org` → your chosen translations (Free Use Bible API)
- `raw.githubusercontent.com` → the page template, only if missing from your vault

## Translations & licensing

**Offered:** KJV, BSB, WEB — public domain.
**Not offered:** ESV, NLT, AMP and other modern versions. They licence *passage*
quotation, not whole-Bible storage. Hold the rights yourself? The in-app guide shows
the note format to import it.

> ⚠️ A built search page embeds the full Bible text. Don't share yours if your vault
> contains copyrighted translations — have each person run the wizard instead.

## Support

Free forever. If you'd like to say thanks:
[PayPal](https://www.paypal.com/paypalme/ruanpienaar86) ☕

## Links

- [Latest release](https://github.com/RuanPienaarCode/obsidian-bible-search/releases/latest) — manual install
- [scripture-vault](https://github.com/RuanPienaarCode/scripture-vault) — the full starter vault
- [bible.helloao.org](https://bible.helloao.org) — Bible text source

Code: MIT ([LICENSE](LICENSE)). Bible text keeps its own licence.
