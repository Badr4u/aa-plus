# AA Plus

A Chrome extension that puts Priors controls on artificialanalysis.ai. Local only: load it unpacked.

## What it does

- **Subscription pricing on AA's own cost charts.** With it on (the default), every model a first-party plan sells is priced at that plan's share of API price, the same figures Priors uses. AA draws its own charts, tooltips and sort order from the repriced numbers, so it still looks like AA. Each repriced chart says "Subscription pricing · AA Plus" beside its title. Models with no plan stay at API price.
- **Plan per lab.** The panel lists each lab that sells more than one plan; picking one reprices that lab's models on it.
- **An added chart**, "Plan Price vs. API Price": the share of API price a subscriber pays, per model, drawn in AA's style under the headline cards.

Open the panel with the "A+" button at the bottom right of any AA page. Changing the pricing or a plan reloads the page, because the numbers are swapped before AA's code reads them.

## Install

1. Open `chrome://extensions`, turn on Developer mode.
2. "Load unpacked", pick this folder.
3. Open https://artificialanalysis.ai. The first visit reloads once after the plan data arrives.

## How it works

| File | Job |
| --- | --- |
| `hook.js` | Runs in the page before AA's code. AA gets chart data three ways and all three are covered: the decrypted model table (`JSON.parse` is wrapped), the ready-made bar lists of the headline cards, and the short model lists the lower charts start from (both arrive in Next.js page data, `self.__next_f`). Cost fields are multiplied by the plan's share; token list prices are left alone. |
| `content.js` | The panel, the added chart, the labels. Keeps settings and plan prices in the page's `localStorage` (`aaplus:v1`), which is where the hook reads them. |
| `chart.js` | The added chart, as plain SVG. |
| `background.js` | Fetches `https://mypriors.com/api/plan-prices` (cached 30 minutes). |

Plan data is `GET /api/plan-prices` on Priors (`src/lib/plan-prices.ts` there): per model, the share of API price on its default plan and on each plan its lab sells, with the model's AA slugs.

## Test

```bash
node test/run.mjs                              # against mypriors.com
node test/run.mjs --base http://localhost:48766 --shots /tmp/aaplus-shots
```

Loads the extension in a headless Chromium with a throwaway profile and checks it on the live AA site: the headline cost card is repriced and still sorted, every chart labelled as repriced really differs from its API-priced figures, the plan picker changes a lab's costs, the added chart is drawn, `/models` works. No window opens.

## Known limits

- Only charts are checked. A sentence, table or model detail page on AA that quotes a cost may still show the API price.
- A free tier is not treated as a price: a model free today uses its paid plan, or stays at API price.
- AA can change its page data at any time. The hook never throws into the page; if a shape changes, charts fall back to AA's own numbers and the test above fails.
