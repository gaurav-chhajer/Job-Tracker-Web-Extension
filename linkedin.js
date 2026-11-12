// Runs INSIDE a LinkedIn people-search tab via chrome.scripting.executeScript.
// Self-contained. Reads only the "N results" line that the page already shows.
export function readCount(want) {
  if (/authwall|\/login|\/uas\/|checkpoint/.test(location.href)) return { state: "login" };
  const body = document.body ? document.body.innerText : "";
  if (/No results found|No matching results|couldn.t find anyone/i.test(body)) return { state: "ready", n: 0 };
  const m = body.match(/(?:About\s+)?([\d,]+)\+?\s+results?\b/i) || body.match(/\bof\s+([\d,]+)\s+results?\b/i);
  if (m) return { state: "ready", n: parseInt(m[1].replace(/,/g, ""), 10) };

  // No count line on this layout: count result cards, not every profile link on the page
  // (mutual-connection names and sidebar suggestions also link to profiles).
  // A real result card carries a degree badge ("1st", "2nd", "3rd") next to the name.
  const degreeOf = (a) => {
    const name = (a.textContent || "").replace(/\s+/g, " ").trim();
    let el = a;
    for (let i = 0; i < 5; i++) {
      el = el.parentElement;
      if (!el) break;
      const t = (el.innerText || "").replace(/\s+/g, " ");
      if (t.length > 900) break;
      const at = t.indexOf(name);
      if (at < 0) continue;
      // The badge sits right after the person's own name, so mutual-connection names
      // and sidebar suggestions (no badge after them) are not counted.
      const d = t.slice(at + name.length, at + name.length + 40).match(/^[\s•·\-–]*(1st|2nd|3rd)\b/);
      if (d) return d[1];
    }
    return "";
  };
  const cards = new Map();
  document.querySelectorAll('a[href*="/in/"]').forEach((a) => {
    if (a.closest("header, nav")) return;
    const path = a.pathname.replace(/\/$/, "");
    if (!/^\/in\/[^/]+$/.test(path) || cards.has(path) || !a.textContent.trim()) return;
    cards.set(path, degreeOf(a));
  });
  const withBadge = [...cards.values()].filter(Boolean);
  if (withBadge.length) return { state: "ready", n: withBadge.filter((d) => d === want).length, atLeast: true };

  // Looser pass: the badge is somewhere inside the result card. Group by card so a card that
  // also links to mutual connections is still one person.
  const items = new Set();
  document.querySelectorAll('a[href*="/in/"]').forEach((a) => {
    if (a.closest("header, nav, aside")) return;
    const card = a.closest('li, [role="listitem"], [data-view-name]');
    if (!card) return;
    const t = (card.innerText || "").replace(/\s+/g, " ");
    const d = t.length <= 900 && t.match(/\b(1st|2nd|3rd)\b/);
    if (d && d[1] === want) items.add(card);
  });
  const top = [...items].filter((c) => ![...items].some((o) => o !== c && c.contains(o)));
  if (top.length) return { state: "ready", n: top.length, atLeast: true };

  const first = document.querySelector('main a[href*="/in/"]');
  return {
    state: "loading",
    url: location.pathname,
    links: document.querySelectorAll('a[href*="/in/"]').length,
    badge: /\b(1st|2nd|3rd)\b/.test(body),
    sample: first ? (first.closest("li, div")?.innerText || "").replace(/\s+/g, " ").slice(0, 140) : body.replace(/\s+/g, " ").slice(0, 100),
  };
}

// Pure text builder, shared by the popup. first/second are { n, atLeast }.
// A card-based count is exact below one page (about 10 results) and "10+" above it.
export function describeNetwork(company, first, second) {
  const num = (c) => (c.atLeast && c.n >= 10 ? `${c.n}+` : c.n.toLocaleString());
  const conn = (c) => `${num(c)} ${c.n === 1 ? "connection" : "connections"}`;
  const people = (c) => `${num(c)} ${c.n === 1 ? "person" : "people"}`;
  if (first.n > 0 && second.n > 0)
    return `You have ${conn(first)} at ${company}, and ${people(second)} two steps away. Message a connection, or ask a mutual contact for an intro.`;
  if (first.n > 0) return `You have ${conn(first)} at ${company}. Reach out to ${first.n === 1 ? "them" : "them"} for a referral.`;
  if (second.n > 0)
    return `You have no direct connections at ${company}, but ${people(second)} ${second.n === 1 ? "is" : "are"} two steps away. Ask a mutual contact for an intro.`;
  return `No 1st- or 2nd-degree connections found for "${company}". You can still look at everyone there and message someone directly.`;
}
