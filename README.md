# lecture-deck-tools

Add-ons for HTML slide decks exported from [Claude Design](https://claude.ai) (decks built on its `<deck-stage>` component), made for teaching from an iPad:

- **Ink**: write on slides with an Apple Pencil (or a mouse). Ink autosaves on the device, and one tap publishes it to GitHub so students see it on the hosted deck.
- **Laser pointer**: a red dot with a short fading trail that follows the Pencil, including hover on iPads that support it. Never saved.
- **Pencil and finger navigation**: a quick tap on the slide advances to the next slide or build; a tap near the left edge goes back. Thumbnail taps, links and buttons still work.
- **Palm rejection**: a resting hand doesn't draw, navigate, select text or drag images.
- **Present mode**: full screen with the thumbnail rail and other chrome hidden.

Used for the AA228V/CS238V lectures at Stanford: <https://smkatz12.github.io/aa228v-lectures/>.

## Add it to a deck

1. Export the deck from Claude Design as **multiple files** and rename `Your Deck.dc.html` to `index.html`.
2. Copy `deck-ink.js` and `present.js` next to it (or into a shared folder for all your decks).
3. In `index.html`, give the deck its own id and load the two scripts, right after the deck's own scripts:

```html
<meta name="deck-id" content="mycourse-lecture01">
...
<script src="deck-ink.js"></script>
<script src="present.js"></script>
```

   If the export already includes a `deck-ink.js` from Claude Design, replace it with this one.
4. Host the folder anywhere static, for example GitHub Pages (add an empty `.nojekyll` file at the repo root).

Optional, before the scripts load:

```html
<script>
  window.DeckInkConfig = {
    colors: ['#ffffff', '#ffd166', '#80b9ff'],   // pen colors
    font: "Avenir, 'Helvetica Neue', sans-serif" // toolbar and button font
  };
</script>
```

## Using it

| | |
|---|---|
| **P**, or the **Present** button in the top-right corner | Enter or leave present mode (Esc also leaves) |
| **L**, or the target button in the toolbar | Laser pointer on/off |
| Quick Pencil or finger tap on the slide | Next slide or build |
| Tap in the left 12% of the slide | Previous |
| Pencil stroke | Draw (when the pen tool is on) |
| Pin button in the toolbar | Keep the toolbar visible (dims while idle) |

Ink is stored as vector strokes in 1920×1080 slide coordinates, keyed by slide number. Each device autosaves its own work in the browser; **Publish** writes `ink.json` into the deck's folder, and every visitor loads it from there.

## Publishing ink from an iPad (one-time setup per device)

1. On GitHub: Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Repository access: only the repository that hosts your decks.
   - Permissions: **Contents: Read and write**. Nothing else.
2. Open a deck on the iPad, tap the gear in the ink toolbar and fill in the repository (`owner/name`), branch and token. Leave **Folder path** blank: each deck publishes into its own folder, worked out from the page address.
3. After writing, tap **Publish**. GitHub Pages shows the change after about a minute.

The token is stored only in that device's browser; **Forget token** removes it.

## Notes

- Ink is keyed by slide number, so inserting or reordering slides after publishing shifts existing ink.
- Add `?inkdebug` to a deck's address to see what the iPad reports for each touch, which helps with palm-rejection tuning.
- Built for Claude Design's `<deck-stage>` (it listens for `slidechange` and uses the deck's `goTo`, and presents via the `__omelette_presenting` message). Other deck frameworks would need small changes.

## License

MIT
