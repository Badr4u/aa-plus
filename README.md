# AA Plus

A Chrome extension that puts Priors controls on artificialanalysis.ai, inline and in AA's own look. Local only: load it unpacked.

## What it does

- **A control row where AA's "Effort: Max | API Default" switch was**, and again (sticky) above the main charts: Pricing (API | Subscription), Effort (Highest, API default, or any set of None to Max), Plans (the plan each lab is priced on).
- **Subscription pricing on AA's own cost charts.** Each model a first-party plan sells is priced at that plan's share of API price, the figures Priors uses. Models with no plan stay at API price. Every cost chart that really follows the setting gets an API | Subscription switch beside its title.
- **Effort selection.** Highest is each model's top effort (AA's "Max"). API default is the effort AA marks, where it marks one. Picking efforts shows the charted models at those efforts; the headline cards keep one bar per model (its best at the picked efforts), AA's interactive charts show every picked configuration.
- **Nothing reloads.** AA's own charts redraw with AA's animation; the three headline cards are redrawn by AA Plus and tween between states.
- **An added chart**, "Plan Price vs. API Price", under the headline cards.
- **Toolbar popup** with the same settings (plus the switch for the added chart). The page and the popup stay in step.

## Install

1. Open `chrome://extensions`, turn on Developer mode.
2. "Load unpacked", pick this folder. After pulling changes, press the reload arrow on the extension card.
3. Open https://artificialanalysis.ai.

## How it works

| File | Job |
| --- | --- |
| `page.js` | Runs in the page's own JavaScript world. Nothing is rewritten while the page loads. It finds the React context AA's charts read from (selected rows, full list, setter) and hands it new rows: repriced copies for Subscription pricing, other configurations of the same models for an effort choice. The "by release" chart has its own store with no setter for rows, so those rows are repriced in place and the store is nudged. It reports rows and state to `content.js`. |
| `content.js` | The inline UI: control rows, switches on cost charts, the headline cards (redrawn from `page.js`'s rows so they follow the controls), the added chart. Settings live in `chrome.storage.local`. |
| `chart.js` | Animated SVG bar charts in AA's look. Bars keep their identity, so a change slides, resizes and counts instead of redrawing. |
| `shared.js` | Effort parsing and choice, plan share lookup, settings. `shared.page.js` is a byte-for-byte copy for the page world (Chrome injects one file into one world only): run `cp shared.js shared.page.js` after editing; the test fails if they differ. |
| `popup.html`, `popup.js` | The toolbar popup. |
| `background.js` | Fetches `https://mypriors.com/api/plan-prices` (cached 30 minutes). |
| `icons/logo.svg` | AA's mark with a plus. `node test/icons.mjs` renders the PNGs. |

## Test

```bash
node test/run.mjs                 # against the live AA site and mypriors.com
node test/run.mjs --shots /tmp/aaplus-shots
```

Loads the extension in a headless Chromium with a throwaway profile. It checks that the controls replace AA's switch, that a pricing change updates the cards in place (a frame in between shows a value in between, and the page never reloads), that an effort pick changes configurations, that every chart carrying the switch really shows different figures at API and plan prices (home and `/models`), that the plan picker and the popup work. No window opens.

`node demo/record.mjs <work dir> [out.mp4]` records the demo the same way.

## Known limits

- It depends on AA's internals (the names in its React context, the shape of its rows). The code never throws into the page; when a shape changes, AA's own cards and switch come back untouched and the test fails.
- Only charts are covered. A sentence, table or model detail page on AA that quotes a cost still shows the API price.
- "API default" is known only for the models AA marks (the headline set); others stay at their highest effort.
- A free tier is not treated as a price: a model free today uses its paid plan, or stays at API price.
- Under AA's fixed header nothing is clickable, the control row included, until you scroll it clear.
