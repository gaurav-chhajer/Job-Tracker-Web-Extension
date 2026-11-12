// Runs INSIDE a LinkedIn people-search tab via chrome.scripting.executeScript.
// Self-contained. Reads only the "N results" line that the page already shows.
export function readCount() {
  if (/authwall|\/login|\/uas\/|checkpoint/.test(location.href)) return { state: "login" };
  const body = document.body ? document.body.innerText : "";
  if (/No results found|No matching results|couldn.t find anyone/i.test(body)) return { state: "ready", n: 0 };
  const m = body.match(/(?:About\s+)?([\d,]+)\+?\s+results?\b/i) || body.match(/\bof\s+([\d,]+)\s+results?\b/i);
  if (m) return { state: "ready", n: parseInt(m[1].replace(/,/g, ""), 10) };
  // No count line on this page layout: count the profile cards that are showing (a lower bound).
  const seen = new Set();
  document.querySelectorAll('a[href*="/in/"]').forEach((a) => {
    if (a.closest("header, nav")) return;
    const path = a.pathname.replace(/\/$/, "");
    if (/^\/in\/[^/]+$/.test(path) && a.textContent.trim()) seen.add(path);
  });
  if (seen.size) return { state: "ready", n: seen.size, atLeast: true };
  return { state: "loading", sample: body.replace(/\s+/g, " ").slice(0, 160), url: location.pathname };
}

// Pure text builder, shared by the popup.
export function describeNetwork(company, first, second, approx = false) {
  const people = (n) => `${approx && n > 0 ? "at least " : ""}${n.toLocaleString()} ${n === 1 ? "person" : "people"}`;
  if (first > 0 && second > 0)
    return `${people(first)} you know and ${people(second)} two steps away match "${company}". Message someone you know, or ask a mutual contact for an intro.`;
  if (first > 0) return `${people(first)} you know ${first === 1 ? "matches" : "match"} "${company}". Reach out for a referral.`;
  if (second > 0)
    return `No direct connections, but ${people(second)} two steps away ${second === 1 ? "matches" : "match"} "${company}". Ask a mutual contact for an intro.`;
  return `No 1st- or 2nd-degree connections found for "${company}". You can still look at everyone there and message someone directly.`;
}
