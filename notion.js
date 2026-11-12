// Thin wrapper around the Notion REST API. Shared by popup and settings page.
const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

export const PROPS = {
  title: "Role",
  company: "Company",
  status: "Status",
  date: "Date Applied",
  url: "URL",
  location: "Location",
  notes: "Notes",
  referral: "Referral Contact",
};

export const STATUSES = ["Saved", "Applied", "Interviewing", "Offer", "Rejected", "Withdrawn"];

// Role and Company may each be the database's title column or a plain text column
// (a database has exactly one title column, and Notion can't convert it).
// Everything else must be exactly this type.
const EXPECTED_TYPES = {
  [PROPS.status]: "select",
  [PROPS.date]: "date",
  [PROPS.url]: "url",
  [PROPS.location]: "rich_text",
  [PROPS.notes]: "rich_text",
  [PROPS.referral]: "rich_text",
};
const TEXT_LIKE = ["title", "rich_text"];

const STATUS_COLORS = { Saved: "gray", Applied: "blue", Interviewing: "yellow", Offer: "green", Rejected: "red", Withdrawn: "brown" };
const COLUMN_DEFS = {
  [PROPS.status]: () => ({ select: { options: STATUSES.map((name) => ({ name, color: STATUS_COLORS[name] })) } }),
  [PROPS.date]: () => ({ date: {} }),
  [PROPS.url]: () => ({ url: {} }),
  [PROPS.location]: () => ({ rich_text: {} }),
  [PROPS.notes]: () => ({ rich_text: {} }),
  [PROPS.referral]: () => ({ rich_text: {} }),
};

export async function getSettings() {
  const { token = "", databaseId = "" } = await chrome.storage.local.get(["token", "databaseId"]);
  return { token, databaseId };
}

export async function saveSettings(values) {
  await chrome.storage.local.set(values);
}

// Accepts a Notion URL or a raw id (with or without dashes).
export function parseNotionId(input) {
  if (!input) return "";
  const path = input.trim().split("?")[0].split("#")[0].replace(/\/$/, "").replace(/-/g, "");
  const m = path.match(/([0-9a-f]{32})$/i);
  return m ? m[1].toLowerCase() : "";
}

function friendlyError(status, data) {
  if (status === 401) return "Notion rejected the token. Check that you copied the full integration secret.";
  if (status === 404)
    return "Notion can't find that page or database. Open it in Notion, choose ••• > Connections, and add your integration.";
  if (status === 429) return "Notion is rate limiting requests. Wait a few seconds and try again.";
  return data?.message || `Notion returned an error (${status}).`;
}

async function call(token, method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Couldn't reach Notion. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError(res.status, data));
  return data;
}

const text = (s) => ({ rich_text: s ? [{ text: { content: String(s).slice(0, 2000) } }] : [] });

const titleColumn = (props) => Object.keys(props).find((k) => props[k].type === "title");

// Writes to a column as whatever type it actually is (title or rich_text).
const textValue = (type, s) =>
  type === "title" ? { title: s ? [{ text: { content: String(s).slice(0, 2000) } }] : [] } : text(s);

// Builds page properties that fit the database's real layout. Columns that are
// missing or the wrong type are skipped so a save still works; Settings reports them.
export function buildProperties(props, job) {
  const out = {};
  const has = (name, type) => props[name]?.type === type;
  const titleName = titleColumn(props);

  const roleName = TEXT_LIKE.includes(props[PROPS.title]?.type) ? PROPS.title : titleName;
  const companyName = TEXT_LIKE.includes(props[PROPS.company]?.type) ? PROPS.company : null;
  if (roleName) out[roleName] = textValue(props[roleName].type, job.title);
  if (companyName && companyName !== roleName) out[companyName] = textValue(props[companyName].type, job.company);

  // The title column is what Notion shows as the row name, so never leave it blank.
  if (titleName) {
    if (!out[titleName]) out[titleName] = textValue("title", job.company || job.title);
    if (!out[titleName].title.length) out[titleName] = textValue("title", "Untitled role");
  }

  if (has(PROPS.status, "select") && job.status) out[PROPS.status] = { select: { name: job.status } };
  if (has(PROPS.date, "date") && job.date) out[PROPS.date] = { date: { start: job.date } };
  if (has(PROPS.location, "rich_text")) out[PROPS.location] = text(job.location);
  if (has(PROPS.notes, "rich_text")) out[PROPS.notes] = text(job.notes);
  if (has(PROPS.referral, "rich_text") && job.referral) out[PROPS.referral] = text(job.referral);
  if (has(PROPS.url, "url") && /^https?:\/\//.test(job.url)) out[PROPS.url] = { url: job.url.slice(0, 2000) };
  return out;
}

export async function createApplication({ token, databaseId }, job) {
  const db = await call(token, "GET", `/databases/${databaseId}`);
  const properties = buildProperties(db.properties || {}, job);
  return call(token, "POST", "/pages", { parent: { database_id: databaseId }, properties });
}

export async function findByUrl({ token, databaseId }, url) {
  if (!/^https?:\/\//.test(url)) return null;
  const data = await call(token, "POST", `/databases/${databaseId}/query`, {
    filter: { property: PROPS.url, url: { equals: url } },
    page_size: 1,
  });
  const page = data.results?.[0];
  if (!page) return null;
  return { id: page.id, url: page.url, status: page.properties?.[PROPS.status]?.select?.name || "" };
}

export async function updateStatus({ token }, pageId, status) {
  return call(token, "PATCH", `/pages/${pageId}`, {
    properties: { [PROPS.status]: { select: { name: status } } },
  });
}

// Compares the database to what the extension needs. Returns
//   problems: human-readable issues (empty = good)
//   patch:    the properties body that fixes everything fixable by adding or renaming
//             columns (null if nothing is fixable). Wrong-type columns are never touched.
export function analyzeSchema(props) {
  const problems = [];
  const patch = {};
  const titleName = titleColumn(props);

  // Role / Company: either may be the title column, the other must be plain text.
  const roleOk = TEXT_LIKE.includes(props[PROPS.title]?.type);
  const companyOk = TEXT_LIKE.includes(props[PROPS.company]?.type);
  for (const name of [PROPS.title, PROPS.company]) {
    if (props[name] && !TEXT_LIKE.includes(props[name].type))
      problems.push(`Column "${name}" should be a title or text column, but is ${props[name].type}.`);
  }
  if (!roleOk && !props[PROPS.title]) {
    if (titleName && titleName !== PROPS.company) {
      patch[titleName] = { name: PROPS.title };
      problems.push(`The title column is called "${titleName}"; it will be renamed to "${PROPS.title}".`);
    } else {
      patch[PROPS.title] = { rich_text: {} };
      problems.push(`Missing column "${PROPS.title}" (type: rich_text).`);
    }
  }
  if (!companyOk && !props[PROPS.company]) {
    patch[PROPS.company] = { rich_text: {} };
    problems.push(`Missing column "${PROPS.company}" (type: rich_text).`);
  }

  for (const [name, type] of Object.entries(EXPECTED_TYPES)) {
    const prop = props[name];
    if (!prop) {
      patch[name] = COLUMN_DEFS[name]();
      problems.push(`Missing column "${name}" (type: ${type}).`);
    } else if (prop.type !== type) {
      problems.push(`Column "${name}" should be type ${type}, but is ${prop.type}. Change it in Notion.`);
    }
  }
  return { problems, patch: Object.keys(patch).length ? patch : null };
}

export async function checkDatabase({ token, databaseId }) {
  const db = await call(token, "GET", `/databases/${databaseId}`);
  const { problems, patch } = analyzeSchema(db.properties || {});
  return { title: db.title?.[0]?.plain_text || "Untitled", problems, patch };
}

// Adds the missing columns (never deletes or retypes anything).
export async function fixDatabase({ token, databaseId }, patch) {
  return call(token, "PATCH", `/databases/${databaseId}`, { properties: patch });
}

export async function createDatabase(token, parentPageId) {
  const colors = { Saved: "gray", Applied: "blue", Interviewing: "yellow", Offer: "green", Rejected: "red", Withdrawn: "brown" };
  return call(token, "POST", "/databases", {
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Job Applications" } }],
    properties: {
      [PROPS.title]: { title: {} },
      [PROPS.company]: { rich_text: {} },
      [PROPS.status]: { select: { options: STATUSES.map((name) => ({ name, color: colors[name] })) } },
      [PROPS.date]: { date: {} },
      [PROPS.url]: { url: {} },
      [PROPS.location]: { rich_text: {} },
      [PROPS.notes]: { rich_text: {} },
      [PROPS.referral]: { rich_text: {} },
    },
  });
}
