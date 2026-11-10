// Fetches plan prices from Priors. A content script on artificialanalysis.ai cannot reach another
// origin under that page's rules, so the request is made here and the answer cached for a while.
const DEFAULT_BASE = "https://mypriors.com", MAX_AGE_MS = 30 * 60 * 1000;

async function prices(force) {
  const { base = DEFAULT_BASE, cache } = await chrome.storage.local.get(["base", "cache"]);
  if (!force && cache && cache.base === base && Date.now() - cache.at < MAX_AGE_MS) return { ok: true, data: cache.data, at: cache.at };
  try {
    const res = await fetch(`${base}/api/plan-prices`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Priors answered ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.models)) throw new Error("Priors sent no models");
    const at = Date.now();
    await chrome.storage.local.set({ cache: { base, at, data } });
    return { ok: true, data, at };
  } catch (e) {
    // The last good answer is better than nothing while Priors is unreachable.
    return cache && cache.base === base ? { ok: true, data: cache.data, at: cache.at, stale: String(e.message ?? e) } : { ok: false, error: String(e.message ?? e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "prices") return false;
  prices(!!msg.force).then(reply);
  return true;
});
