# Bible Search

Full-text Bible search and reading in a pane inside your vault. Local, free, no account.

**Install:** Settings → Community plugins → Browse → "Bible Search" → Install → Enable.
A setup wizard does the rest.

---

## What it does

| | |
| --- | --- |
| **Search** | Full-text search across every verse. Results link back to the note. |
| **Reader** | Read by chapter. Open a verse to see its cross-references, the places it names, and the Hebrew or Greek behind the English. |
| **Highlights and notes** | Highlight, bookmark and annotate any verse. Stored per verse, so they survive a rebuild or a change of translation. |
| **Timeline** | Bible and church history on a single timeline. |
| **Translations** | Two dozen English translations compared by approach, date and reading level. |
| **Setup wizard** | Downloads the text and builds the page on first run. No terminal needed. |
| **Local** | No account, no cloud, no telemetry. Text lands in your vault as notes. |
| **Desktop and mobile** | Obsidian 1.4.0 and later. Follows your theme. |
| **Resumable** | Interrupted downloads pick up where they stopped. |

### Optional extras

The wizard offers these at the end. Take all, some or none. Anything you skip does not
appear, and you can add it later by running the wizard again.

| | |
| --- | --- |
| **Dictionary** | The Hebrew and Greek words behind the English, linked from the verse you are reading. |
| **Maps** | The places a passage names, the journeys, the tribal allotments, the spread of the early church, and a set of antique map plates. Pan and zoom. |
| **Church History** | The branches of the church and how they separated, as a tree. |
| **On This Day** | Events that fall on today's date. |
| **Prayers** | A collection of prayers, written into your vault as notes. |

### From your own notes

Study material already in your vault joins the search and gets its own tab: `Topics/`,
`FAQ/`, `Bible History/` and `Teaching/` articles. Each appears only when it has content.
Commentary works the same way if your vault has it. The
[starter vault](https://github.com/RuanPienaarCode/scripture-vault) comes with the layout
already set up.

## Setup

The wizard asks two questions:

- **Where does the search page live?** Default: `Bible Search.html` at the vault root.
- **Which translations?** KJV and BSB by default, WEB optional. All public domain.

A few minutes per translation, then it builds and opens. If you are already set up on
another device, it adopts the existing page without rebuilding.

## Commands

- `Bible Search: Open search` — or click the book icon in the ribbon
- `Bible Search: Rebuild search index` — after editing vault content
- `Bible Search: Run setup wizard` — add translations, move the page

## Network

Two hosts, only during setup or rebuild. Never in the background, never on a schedule.

- `bible.helloao.org` — your chosen translations (Free Use Bible API)
- `raw.githubusercontent.com` — the page template, plus whichever optional extras you
  picked (dictionary, maps, church history, on this day, prayers)

## Translations and licensing

**Offered:** KJV, BSB, WEB — all public domain.

**Not offered:** ESV, NLT, AMP and other modern versions. These licence *passage*
quotation, not whole-Bible storage. If you hold the rights yourself, the in-app guide
shows the note format for importing one.

> **Note:** a built search page embeds the full Bible text. Do not share yours if your
> vault contains copyrighted translations. Have each person run the wizard instead.

## Support

Free, and staying that way. If you would like to say thanks:
[PayPal](https://www.paypal.com/paypalme/ruanpienaar86)

## Links

- [Latest release](https://github.com/RuanPienaarCode/obsidian-bible-search/releases/latest) — manual install
- [scripture-vault](https://github.com/RuanPienaarCode/scripture-vault) — the full starter vault
- [bible.helloao.org](https://bible.helloao.org) — Bible text source

Code: [PolyForm Noncommercial 1.0.0](LICENSE) — free for personal and other
noncommercial use; commercial use needs a separate licence. Bible text keeps its
own licence.
