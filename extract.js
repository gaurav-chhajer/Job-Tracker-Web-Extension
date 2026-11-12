// Runs INSIDE the job page via chrome.scripting.executeScript.
// Must be fully self-contained: no imports, no outside variables.
export function extractJob() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const decode = (s) => {
    const t = document.createElement("textarea");
    t.innerHTML = s || "";
    return clean(t.value);
  };
  const pick = (selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const v = el && clean(el.textContent);
      if (v) return v;
    }
    return "";
  };
  const meta = (name) =>
    clean(document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute("content"));

  const host = location.hostname.replace(/^www\./, "");
  const parts = location.pathname.split("/").filter(Boolean);
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  let title = "", company = "", place = "";
  let url = location.href;

  // 1. Site-specific selectors
  if (host.endsWith("linkedin.com")) {
    title = pick([".job-details-jobs-unified-top-card__job-title h1", ".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", ".top-card-layout__title", "h1"]);
    company = pick([".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name", ".topcard__org-name-link"]);
    // LinkedIn now uses generated class names, so also read stable signals:
    // the page title ("Role | Company | LinkedIn" or "Company hiring Role in Place | LinkedIn"),
    // the company link, and the "Place · 1 week ago" line.
    const heading = (meta("og:title") || document.title).replace(/^\(\d+\)\s*/, "");
    const hiring = heading.match(/^(.+?) hiring (.+?)(?: in (.+?))? \|\s*LinkedIn$/i);
    const bars = heading.split(/\s+\|\s+/).map(clean).filter((x) => x && !/^LinkedIn$/i.test(x));
    if (hiring) {
      company = company || hiring[1];
      title = title || hiring[2];
      place = hiring[3] || "";
    } else if (bars.length >= 2) {
      title = title && title !== "LinkedIn" ? title : bars[0];
      company = company || bars[bars.length - 1];
    }
    if (!company) {
      for (const a of document.querySelectorAll('a[href*="/company/"]')) {
        const t = clean(a.textContent);
        if (t && !a.closest("header, nav")) { company = t; break; }
      }
    }
    if (!place) {
      for (const el of document.querySelectorAll("main p, main span, p, span")) {
        const t = clean(el.textContent);
        const m = t.length < 200 && t.match(/^([^·]{2,80}?)\s·\s(?:Reposted\s)?(?:\d+\s+\w+\s+ago|Over \d+|\d+\s+(?:applicants|people))/i);
        if (m) { place = m[1]; break; }
      }
    }
    const id = new URLSearchParams(location.search).get("currentJobId") || (location.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/) || [])[1];
    if (id) url = `https://www.linkedin.com/jobs/view/${id}/`;
  } else if (host.endsWith("greenhouse.io")) {
    title = pick([".app-title", "h1.section-header", "h1"]);
    company = pick([".company-name"]).replace(/^at\s+/i, "");
    const m = document.title.match(/^Job Application for (.+) at (.+)$/i);
    if (m) { title = title || m[1]; company = company || m[2]; }
    if (!company && parts[0]) company = cap(parts[0]);
  } else if (host.endsWith("lever.co")) {
    title = pick([".posting-headline h2", "h2"]);
    company = parts[0] ? cap(parts[0]) : "";
    place = pick([".posting-categories .location"]);
  } else if (host.endsWith("myworkdayjobs.com")) {
    title = pick(['[data-automation-id="jobPostingHeader"]', "h1"]);
    company = cap(host.split(".")[0]);
    place = pick(['[data-automation-id="locations"] dd']);
  } else if (host.endsWith("indeed.com")) {
    title = pick(['[data-testid="jobsearch-JobInfoHeader-title"]', ".jobsearch-JobInfoHeader-title"]);
    company = pick(['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]']);
    const jk = new URLSearchParams(location.search).get("jk") || new URLSearchParams(location.search).get("vjk");
    if (jk) url = `${location.origin}/viewjob?jk=${jk}`;

    // Apply flow (smartapply.indeed.com): card reads "Role" then "Company - Place"
    if (host.startsWith("smartapply.") && !company) {
      const lines = (document.body.innerText || "").split("\n").map(clean).filter(Boolean);
      const j = lines.findIndex((l) => /^.+? - .+,.+$/.test(l));
      if (j > 0) {
        const m = lines[j].match(/^(.+?) - (.+)$/);
        company = m[1];
        place = m[2];
        title = title || lines[j - 1];
      }
    }
  } else if (host.endsWith("wellfound.com")) {
    // Apply modal text: "APPLY TO / Heizen / Staff Forward Deployed… / pay / Location / Hyderabad …"
    const dlg = document.querySelector('[role="dialog"], [class*="modal" i]');
    const lines = ((dlg || document.body).innerText || "").split("\n").map(clean).filter(Boolean);
    const i = lines.findIndex((l) => /^apply to$/i.test(l));
    if (i >= 0) {
      company = lines[i + 1] || "";
      title = lines[i + 2] || "";
      const li = lines.findIndex((l) => /^location$/i.test(l));
      if (li >= 0) place = lines[li + 1] || "";
    }
    if (!company && parts[0] === "company" && parts[1]) company = cap(parts[1]);
    if (!title && parts[0] === "jobs") title = pick(["h1"]);
  } else if (host.endsWith("workatastartup.com")) {
    // Title format: "Role at Company | Y Combinator's Work at a Startup"
    const m = (meta("og:title") || document.title).match(/^(.+) at (.+?)\s*\|/);
    if (m) { title = clean(m[1]); company = clean(m[2]); }
    const lines = (document.body.innerText || "").split("\n").map(clean).filter(Boolean);
    const li = lines.findIndex((l) => /^location$/i.test(l));
    if (li >= 0) place = lines[li + 1] || "";
  }

  // 2. Structured data (JobPosting JSON-LD) used by most careers pages
  const posts = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n === "object") {
      const t = n["@type"];
      if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) posts.push(n);
      if (n["@graph"]) walk(n["@graph"]);
    }
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try { walk(JSON.parse(s.textContent)); } catch {}
  });
  const p = posts[0];
  if (p) {
    title = title || decode(p.title);
    const org = p.hiringOrganization;
    company = company || decode(typeof org === "string" ? org : org?.name);
    if (!place) {
      const jl = Array.isArray(p.jobLocation) ? p.jobLocation[0] : p.jobLocation;
      const a = jl?.address;
      if (a && typeof a === "object") {
        place = [a.addressLocality, a.addressRegion, a.addressCountry?.name || a.addressCountry]
          .filter((x) => x && typeof x === "string").join(", ");
      }
    }
  }

  // 3. Generic fallbacks
  if (!title) title = meta("og:title") || pick(["h1"]) || clean(document.title);
  title = title.replace(/\s*[|\-–]\s*(LinkedIn|Indeed.*|Greenhouse|Lever)$/i, "");
  if (!company) {
    const m = title.match(/^(.+) (?:at|@) (.+?)(?:\s*\|.*)?$/i);
    if (m) { title = m[1]; company = m[2]; }
  }
  if (!company) company = meta("og:site_name");
  if (!company) {
    const label = host.split(".").filter((x) => !["www", "jobs", "careers", "apply", "boards", "com", "org", "net", "io", "co"].includes(x))[0];
    company = cap(label || host);
  }

  // The Indeed apply flow has one URL for every job, which would make the
  // duplicate check treat different applications as the same one. Key by job.
  if (host.startsWith("smartapply.") && !/[?&]jk=/.test(url)) {
    const link = document.querySelector('a[href*="jk="]');
    const jk = link && (new URL(link.href, location.href).searchParams.get("jk"));
    url = jk
      ? `https://www.indeed.com/viewjob?jk=${jk}`
      : `${location.origin}${location.pathname}?app=${encodeURIComponent(`${company}|${title}`.toLowerCase())}`;
  }

  // Strip tracking params so the same job always has the same URL
  try {
    const u = new URL(url);
    [...u.searchParams.keys()].forEach((k) => {
      if (/^(utm_|gh_src|lever-|trk|tracking|refid|ref$|source$|src$)/i.test(k)) u.searchParams.delete(k);
    });
    u.hash = "";
    url = u.toString();
  } catch {}

  return { title: title.slice(0, 200), company: company.slice(0, 120), location: place.slice(0, 120), url };
}