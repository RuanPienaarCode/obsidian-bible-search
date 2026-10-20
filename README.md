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

## Opening a passage from elsewhere

Two supported ways in. Both open the passage in the reader, and both read the reference
exactly as the search box does: `John 15:5`, `1 Cor 13:4-7`, `john 3 16`, `Ps 23`,
`Song of Solomon 2:4`. It opens in the translation the page is showing, at the first verse
named, with that verse's study card open. A bare chapter opens at its top.

**A link**, in a note, a browser or another app:

```
obsidian://bible-search?ref=John%2015:5
```

Add `&vault=<name>` to choose the vault, as with any Obsidian link. With no `ref` it just
opens Bible Search. Anything that goes wrong is shown in a notice.

**Another plugin** in the same vault:

```js
const bs = app.plugins.plugins["bible-search"];
if (bs && bs.api && bs.api.openPassage) {
  try {
    if (await bs.api.openPassage("John 15:5")) return;   // the reader is on the passage
  } catch (e) {
    new Notice(e.message);   // set up, but this reference couldn't be opened
    return;
  }
}
// not installed, or not set up in this vault: fall back
```

| | |
| --- | --- |
| `api.version` | `1`. Moves only if `openPassage` changes in a way that breaks a caller. |
| `api.openPassage(ref)` | Returns a promise. `true` once the reader has opened at the reference. `false`, with nothing opened, when this vault has no search page yet: your cue to fall back. Rejects with an `Error` worded for the reader when the page is there but can't open the reference; the view stays open. A `ref` that isn't a non-empty string rejects with a `TypeError` before anything opens. |

Look the plugin up on each use rather than keeping `api`. After Bible Search is disabled
or reloaded, an `api` kept from before answers `false`. When the reader opens but has no
text to show there (a chapter the translation doesn't have, or a translation still
syncing), it says so itself, and `openPassage` has still done its job.

## Network

Two hosts, only during setup or a rebuild. Never on a schedule.

- `bible.helloao.org` — your chosen translations (Free Use Bible API)
- `raw.githubusercontent.com` — the page template, plus whichever optional extras you
  picked (dictionary, maps, church history, on this day, prayers)

The template is the search page's own HTML and JavaScript. Each plugin release pins
one tagged version of it, and a rebuild fetches it again only when a plugin update has
moved that pin. A template you have edited yourself is kept, never overwritten.

Every file fetched from `raw.githubusercontent.com` (the template and each extra) is
checked against the SHA-256 recorded in the plugin release. A file that doesn't match
is refused and nothing is written.

If setup is interrupted (Obsidian closed mid-download), the remaining downloads resume
by themselves the next time Obsidian starts. Finished files are kept.

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

**Code.** [AGPL-3.0](LICENSE) — use it, change it, share it, personally or
commercially; anything you distribute or run as a network service on top of it has to
be AGPL-3.0 with its source available too. Bible text keeps its own licence.
