import { getSettings, saveSettings, parseNotionId, checkDatabase, fixDatabase, createDatabase } from "./notion.js";

const $ = (id) => document.getElementById(id);
const say = (id, text, kind = "") => { $(id).textContent = text; $(id).className = "msg " + kind; };

(async () => {
  const { token, databaseId } = await getSettings();
  $("token").value = token;
  $("databaseUrl").value = databaseId;
})();

async function testConnection(autoFixed = false) {
  const token = $("token").value.trim();
  const databaseId = parseNotionId($("databaseUrl").value);
  if (!token) return say("msg1", "Paste your integration secret first.", "err");
  if (!databaseId) return say("msg1", "That doesn't look like a Notion database URL or ID.", "err");
  say("msg1", "Testing…");
  try {
    let { title, problems, patch } = await checkDatabase({ token, databaseId });
    await saveSettings({ token, databaseId });
    if (patch && !autoFixed) {
      // Only adds/renames columns; never deletes or retypes anything.
      say("msg1", "Adding missing columns…");
      try {
        await fixDatabase({ token, databaseId }, patch);
        return testConnection(true);
      } catch (e) {
        say("msg1", `Couldn't add columns automatically: ${e.message} In Notion, open your integration > Capabilities and enable "Update content" and "Insert content".`, "err");
        return;
      }
    }
    if (!problems.length) return say("msg1", `Connected to "${title}". You're ready to track applications.`, "ok");

    $("msg1").className = "msg err";
    $("msg1").textContent = `Connected to "${title}", but it needs changes:`;
    const ul = document.createElement("ul");
    ul.className = "problems";
    problems.forEach((p) => ul.append(Object.assign(document.createElement("li"), { textContent: p })));
    $("msg1").append(ul);

    if (patch) {
      const btn = Object.assign(document.createElement("button"), {
        className: "secondary",
        textContent: "Add missing columns",
      });
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await fixDatabase({ token, databaseId }, patch);
          await testConnection(true);
        } catch (e) {
          say("msg1", e.message, "err");
        }
      };
      $("msg1").append(btn);
    }
  } catch (e) {
    say("msg1", e.message, "err");
  }
}
$("saveTest").addEventListener("click", () => testConnection());

$("create").addEventListener("click", async () => {
  const token = $("token").value.trim();
  const parentId = parseNotionId($("parentUrl").value);
  if (!token) return say("msg2", "Paste your integration secret in step 1 first.", "err");
  if (!parentId) return say("msg2", "That doesn't look like a Notion page URL.", "err");
  say("msg2", "Creating…");
  try {
    const db = await createDatabase(token, parentId);
    const databaseId = db.id.replace(/-/g, "");
    await saveSettings({ token, databaseId });
    $("databaseUrl").value = databaseId;
    say("msg2", "Created and connected. You're ready to track applications.", "ok");
  } catch (e) {
    say("msg2", e.message, "err");
  }
});
