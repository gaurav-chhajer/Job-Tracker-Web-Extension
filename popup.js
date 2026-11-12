import { getSettings, createApplication, findByUrl, updateStatus, STATUSES } from "./notion.js";
import { extractJob } from "./extract.js";
import { readCount, describeNetwork } from "./linkedin.js";

const $ = (id) => document.getElementById(id);
let settings, existing = null, currentUrl = "";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const say = (text, kind = "") => { $("msg").textContent = text; $("msg").className = "msg " + kind; };

async function init() {
  settings = await getSettings();
  $("openSettings").onclick = () => chrome.runtime.openOptionsPage();
  if (!settings.token || !settings.databaseId) { $("setup").hidden = false; return; }

  $("form").hidden = false;
  $("gear").onclick = () => chrome.runtime.openOptionsPage();
  for (const s of STATUSES) $("status").append(new Option(s, s));
  $("status").value = "Applied";
  $("date").value = today();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let job = { title: "", company: "", location: "", url: tab?.url || "" };
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJob });
    if (res?.result) job = res.result;
  } catch {
    say("Couldn't read this page. Fill in the details by hand.");
  }
  currentUrl = job.url;
  $("title").value = job.title;
  $("company").value = job.company;
  $("location").value = job.location;
  $("urlText").textContent = job.url;
  $("urlText").title = job.url;

  try {
    existing = await findByUrl(settings, job.url);
    if (existing) {
      $("status").value = existing.status || "Applied";
      $("notice").hidden = false;
      $("notice").textContent = `Already tracked as "${existing.status || "no status"}". Change the status to update it.`;
      $("save").textContent = "Update status";
    }
  } catch (e) {
    say(e.message, "err");
  }
}

// Connection check: loads each LinkedIn people search once in a background tab,
// reads the "N results" line, closes the tab. Only runs when you click the button.
const searchUrl = (company, degree) => {
  const q = new URLSearchParams({ keywords: company, origin: "FACETED_SEARCH" });
  if (degree) q.set("network", JSON.stringify([degree]));
  return `https://www.linkedin.com/search/results/people/?${q}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function countFor(company, degree) {
  const tab = await chrome.tabs.create({ url: searchUrl(company, degree), active: false });
  try {
    const end = Date.now() + 20000;
    let last = null;
    while (Date.now() < end) {
      await sleep(700);
      const t = await chrome.tabs.get(tab.id);
      if (t.status !== "complete") continue;
      let r;
      try { [{ result: r }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readCount }); }
      catch (e) { return { error: "read", detail: e.message }; }
      if (r?.state === "login") return { error: "login" };
      if (r?.state === "ready") return { n: r.n, atLeast: !!r.atLeast };
      last = r;
    }
    return { error: "timeout", detail: last ? `${last.url} | ${last.sample}` : "page never finished loading" };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

$("check").addEventListener("click", async () => {
  const company = $("company").value.trim();
  const box = $("network");
  if (!company) return say("Enter a company name first.", "err");
  const btn = $("check");
  btn.disabled = true;
  box.hidden = false;
  box.textContent = "Checking LinkedIn…";
  const first = await countFor(company, "F");
  const second = first.error === "login" ? first : await countFor(company, "S");
  btn.disabled = false;
  box.textContent = "";
  const p = document.createElement("p");
  // Only offer a link when it leads somewhere: skip a degree that has no results.
  // If the counts couldn't be read, offer all three.
  const known = !first.error && !second.error;
  const links = [["1st-degree", "F", first.n], ["2nd-degree", "S", second.n], ["Everyone", "", 1]]
    .filter(([, , n]) => !known || n > 0)
    .map(([label, d]) =>
      Object.assign(document.createElement("a"), { href: searchUrl(company, d), target: "_blank", textContent: label }));
  if (first.error === "login" || second.error === "login") {
    p.textContent = "You're not signed in to LinkedIn in this browser. Sign in, then try again.";
  } else if (first.error || second.error) {
    p.textContent = "Couldn't read the counts from LinkedIn. Open the searches yourself:";
    const why = Object.assign(document.createElement("div"), {
      textContent: `Reason: ${[first, second].filter((x) => x.error).map((x) => `${x.error}: ${x.detail || ""}`).join(" / ")}`,
    });
    why.style.cssText = "font-size:11px;margin-bottom:6px;word-break:break-word";
    p.append(why);
  } else {
    p.textContent = describeNetwork(company, first.n, second.n, first.atLeast || second.atLeast);
  }
  box.append(p, ...links);
});

$("save").addEventListener("click", async () => {
  const btn = $("save");
  btn.disabled = true;
  say("Saving…");
  try {
    if (existing) {
      await updateStatus(settings, existing.id, $("status").value);
      say("Status updated.", "ok");
    } else {
      const page = await createApplication(settings, {
        title: $("title").value.trim(),
        company: $("company").value.trim(),
        location: $("location").value.trim(),
        status: $("status").value,
        date: $("date").value || today(),
        notes: $("notes").value.trim(),
        referral: $("referral").value.trim(),
        url: currentUrl,
      });
      existing = { id: page.id, url: page.url, status: $("status").value };
      $("msg").innerHTML = "";
      const a = Object.assign(document.createElement("a"), { href: page.url, target: "_blank", textContent: "Open in Notion" });
      $("msg").className = "msg ok";
      $("msg").append("Saved. ", a);
      btn.textContent = "Update status";
    }
  } catch (e) {
    say(e.message, "err");
  } finally {
    btn.disabled = false;
  }
});

init();
