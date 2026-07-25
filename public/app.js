/* Business Status Dashboard
 * Tracks businesses, Net 30 accounts, banking, and business credit.
 * State persists to localStorage; other tabs sync via the storage event.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "business-dashboard-v2";
  const ASSISTANT_KEY = "business-dashboard-assistant-v2";
  const LEGACY_STORAGE_KEYS = ["business-dashboard-v1"];
  const LEGACY_ASSISTANT_KEYS = ["business-dashboard-assistant-v1"];
  const DEFAULT_CHECKLIST = [
    "EIN registered",
    "DUNS number obtained",
    "Business address verified",
    "Business phone listed (411)",
    "Business bank account opened",
    "Website live",
    "Google Business profile",
    "State filings current",
  ];

  const PLATFORM_CONFIG = {
    stripe: {
      title: "Stripe Account",
      idLabel: "Account ID",
      idPlaceholder: "acct_1234567890",
      statusOptions: [
        { value: "not_setup",  label: "Not Set Up" },
        { value: "pending",    label: "Pending" },
        { value: "active",     label: "Active" },
        { value: "suspended",  label: "Suspended" },
      ],
      hasUrl: false,
    },
    yelp: {
      title: "Yelp Business Listing",
      idLabel: "Business ID / Alias",
      idPlaceholder: "my-business-cityname",
      statusOptions: [
        { value: "not_listed", label: "Not Listed" },
        { value: "pending",    label: "Pending" },
        { value: "listed",     label: "Listed" },
        { value: "claimed",    label: "Claimed & Verified" },
      ],
      hasUrl: true,
      urlLabel: "Yelp URL",
      urlPlaceholder: "https://www.yelp.com/biz/...",
    },
    google: {
      title: "Google Business Profile",
      idLabel: "Place ID",
      idPlaceholder: "ChIJ...",
      statusOptions: [
        { value: "not_listed",  label: "Not Listed" },
        { value: "pending",     label: "Pending Verification" },
        { value: "unverified",  label: "Unverified" },
        { value: "verified",    label: "Verified" },
      ],
      hasUrl: true,
      urlLabel: "Profile URL",
      urlPlaceholder: "https://business.google.com/...",
    },
  };

  // ---------- State ----------
  let state = load();
  let editing = { net30Id: null, bankId: null, platformKey: null, sbaCertId: null, apiConfigId: null };
  let assistant = loadAssistant();

  function loadAssistant() {
    try {
      const raw = localStorage.getItem(ASSISTANT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.messages)) return parsed;
      }
    } catch { /* ignore */ }
    return { messages: [] };
  }
  function saveAssistant() {
    localStorage.setItem(ASSISTANT_KEY, JSON.stringify(assistant));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.businesses)) return parsed;
      }
    } catch (e) {
      console.warn("state load failed", e);
    }
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    LEGACY_ASSISTANT_KEYS.forEach((key) => localStorage.removeItem(key));
    return emptyState();
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  function uid() {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    return "id-" + Math.floor(performance.now() * 1000).toString(36) +
      "-" + arr[0].toString(36) + "-" + arr[1].toString(36);
  }
  function activeBusiness() {
    return state.businesses.find((b) => b.id === state.activeId) || null;
  }

  // ---------- Assistant ----------
  function assistantPush(role, text) {
    const msg = { id: uid(), ts: Date.now(), role, text: String(text ?? "") };
    assistant.messages.push(msg);
    if (assistant.messages.length > 200) assistant.messages = assistant.messages.slice(-200);
    saveAssistant();
    renderAssistant();
  }

  function assistantSummary() {
    const b = activeBusiness();
    if (!b) return "No active business selected.";
    return [
      'Active: "' + b.name + '"',
      "Reminders: " + (b.reminders ? b.reminders.length : 0),
      "Checklist: " + (b.checklist ? b.checklist.length : 0),
      "Net30: " + (b.net30 ? b.net30.length : 0),
      "Banking: " + (b.banking ? b.banking.length : 0),
    ].join(" • ");
  }

  function renderAssistant() {
    const logEl = $("#assistantLog");
    const metaEl = $("#assistantMeta");
    if (!logEl || !metaEl) return;

    metaEl.textContent = assistantSummary();

    logEl.innerHTML = "";
    assistant.messages.forEach((m) => {
      const wrap = document.createElement("div");
      wrap.className = "assistant-msg " + (m.role || "assistant");

      const top = document.createElement("div");
      top.className = "assistant-msg-top";

      const role = document.createElement("div");
      role.className = "assistant-role";
      role.textContent = m.role === "user" ? "You" : m.role === "system" ? "System" : "Assistant";

      const ts = document.createElement("div");
      ts.className = "assistant-ts";
      ts.textContent = fmtTime(m.ts);

      const text = document.createElement("div");
      text.className = "assistant-text";
      text.textContent = m.text;

      top.appendChild(role);
      top.appendChild(ts);
      wrap.appendChild(top);
      wrap.appendChild(text);
      logEl.appendChild(wrap);
    });

    logEl.scrollTop = logEl.scrollHeight;
  }

  function assistantHelpText() {
    const due = fmtDateISO(Date.now() + 7 * 24 * 60 * 60 * 1000) || "YYYY-MM-DD";
    return [
      "Things I can do:",
      "- read state (say: summary)",
      "- export / import (say: export, or paste JSON after: import)",
      '- add checklist item: add checklist "Open business bank account"',
      '- add reminder: add reminder "Pay sales tax" due ' + due,
      "- Supabase: supabase whoami, or supabase select <table> [columns] [limit]",
      "- GitHub: github me, or github issue owner/repo \"Title\" \"Body\"",
    ].join("\n");
  }

  function parseQuotedArgs(s) {
    const out = [];
    const re = /\"([^\"]*)\"|'([^']*)'|(\\S+)/g;
    let m;
    while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
  }

  function tryParseDateToken(token) {
    const v = String(token || "").trim();
    if (!v) return null;
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) return v;
    const dt = new Date(v);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
    return null;
  }

  async function assistantGitHub(opLine) {
    const args = parseQuotedArgs(opLine);
    const sub = (args[1] || "").toLowerCase();

    if (sub === "me") {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "GET", path: "/user" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "GitHub request failed");
      return "GitHub user: " + (json?.login || "unknown");
    }

    if (sub === "issue") {
      const repo = args[2];
      const title = args[3] || "New issue";
      const body = args[4] || "";
      if (!repo || !repo.includes("/")) return 'Usage: github issue owner/repo "Title" "Body"';

      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "POST",
          path: "/repos/" + repo + "/issues",
          body: { title, body },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "GitHub issue create failed");
      return "Created issue #" + json.number + ": " + json.title;
    }

    return 'Try: github me  OR  github issue owner/repo "Title" "Body"';
  }

  async function assistantSupabase(opLine) {
    const args = parseQuotedArgs(opLine);
    const sub = (args[1] || "").toLowerCase();
    if (sub === "whoami") {
      const res = await fetch("/api/supabase", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ op: "whoami" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return "Supabase whoami failed: " + (json?.error || res.status);
      if (!json?.userClaims) return "No user claims returned (send Authorization: Bearer <access_token>).";
      return "Supabase user: " + (json.userClaims?.sub || "unknown");
    }
    if (sub === "select") {
      const table = args[2];
      const columns = args[3] || "*";
      const limit = args[4] ? Number(args[4]) : 25;
      if (!table) return 'Usage: supabase select table [columns="*"] [limit=25]';

      const res = await fetch("/api/supabase", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ op: "select", table, columns, limit }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return "Supabase select failed: " + (json?.error || res.status);
      return "Supabase select ok (" + (json?.data ? json.data.length : 0) + " row(s)).";
    }
    return "Try: supabase whoami  OR  supabase select <table> [columns] [limit]";
  }

  async function assistantHandle(text) {
    const line = String(text || "").trim();
    const lower = line.toLowerCase();

    if (!line) return;

    if (lower === "help" || lower === "?") return assistantHelpText();
    if (lower === "summary" || lower === "status") return assistantSummary();

    if (lower === "export") {
      $("#exportBtn").click();
      return "Exported dashboard JSON.";
    }

    if (lower.startsWith("import ")) {
      const payload = line.slice("import ".length).trim();
      try {
        const parsed = JSON.parse(payload);
        if (!parsed || !Array.isArray(parsed.businesses)) return "That JSON doesn't look like a dashboard export (missing businesses[]).";
        state = parsed;
        save();
        render();
        return "Imported dashboard JSON.";
      } catch (e) {
        return "Import failed: invalid JSON (" + e.message + ").";
      }
    }

    if (lower.startsWith("add checklist")) {
      const args = parseQuotedArgs(line);
      const item = args.slice(2).join(" ").trim();
      if (!item) return 'Usage: add checklist "Checklist item"';
      const b = activeBusiness();
      if (!b) return "No active business selected.";
      b.checklist.push({ id: uid(), text: item, done: false });
      log("task", 'Added checklist item "' + item + '"');
      persist();
      return 'Added checklist item: "' + item + '"';
    }

    if (lower.startsWith("add reminder")) {
      const args = parseQuotedArgs(line);
      const b = activeBusiness();
      if (!b) return "No active business selected.";

      const dueIdx = args.findIndex((x) => String(x).toLowerCase() === "due");
      const titleParts = dueIdx === -1 ? args.slice(2) : args.slice(2, dueIdx);
      const title = titleParts.join(" ").trim();
      const dueToken = dueIdx === -1 ? null : args[dueIdx + 1];
      const due = tryParseDateToken(dueToken) || fmtDateISO(Date.now() + 7 * 24 * 60 * 60 * 1000);
      if (!title) return 'Usage: add reminder "Title" due YYYY-MM-DD';
      if (!due) return "Please provide a due date like 2026-08-15.";

      b.reminders.push({ id: uid(), title, due, notes: "", done: false });
      log("task", 'Added reminder "' + title + '" due ' + fmtDate(due));
      persist();
      return 'Added reminder: "' + title + '" due ' + due;
    }

    if (lower.startsWith("github")) return await assistantGitHub(line);
    if (lower.startsWith("supabase")) return await assistantSupabase(line);

    return 'Say "help" for commands.';
  }

  function bindAssistantUi() {
    const btn = $("#assistantBtn");
    const form = $("#assistantForm");
    const input = $("#assistantInput");
    const clearBtn = $("#assistantClearBtn");

    if (btn) btn.addEventListener("click", () => {
      openModal("modalAssistant");
      if (assistant.messages.length === 0) assistantPush("assistant", assistantHelpText());
      setTimeout(() => input && input.focus(), 0);
      renderAssistant();
    });

    if (clearBtn) clearBtn.addEventListener("click", () => {
      if (!confirm("Clear assistant chat?")) return;
      assistant.messages = [];
      saveAssistant();
      assistantPush("assistant", assistantHelpText());
    });

    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = (input && input.value) ? input.value : "";
      if (!text.trim()) return;
      if (input) input.value = "";

      assistantPush("user", text);
      try {
        const reply = await assistantHandle(text);
        if (reply) assistantPush("assistant", reply);
      } catch (err) {
        assistantPush("system", "Error: " + (err && err.message ? err.message : String(err)));
      }
    });
  }
  function log(tag, msg) {
    state.activity.unshift({ id: uid(), ts: Date.now(), tag, msg });
    if (state.activity.length > 200) state.activity.length = 200;
  }
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return "—";
    const s = Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
    return "$" + s;
  }
  function fmtDate(d) {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString(); } catch { return d; }
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return hh + ":" + mm;
  }
  function fmtDateISO(d) {
    if (!d) return "";
    try {
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return "";
      return dt.toISOString().slice(0, 10);
    } catch {
      return "";
    }
  }
  function daysBetween(a, b) {
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  function inferIndustryFromName(name) {
    const n = String(name || "").toLowerCase();
    if (/tech|software|digital|ai|api|gemini|coding|developer/.test(n)) return "Technology";
    if (/staffing|management|consult|associate|methods|solutions|contracts|forms/.test(n)) return "Professional Services";
    if (/transport|logistics|freight|towing|ride share|mobile exchange|auto|rental|trucking|supply/.test(n)) return "Transportation";
    if (/real estate|property|holdings|investments|ranch/.test(n)) return "Real Estate & Holdings";
    if (/media|branding|creators|publishing|marketing|links|know before you go/.test(n)) return "Media & Marketing";
    if (/cleaning|maid|recovery|security|vet|gang|crew/.test(n)) return "Services";
    if (/wireless|phone|telecom/.test(n)) return "Retail & Telecom";
    if (/auto|dealer|vehicle/.test(n)) return "Automotive";
    if (/analytics/.test(n)) return "Analytics";
    if (/government|govt|secretary|sba|sam/.test(n)) return "Government & Compliance";
    return "General Operations";
  }

  function emptyState() {
    return {
      businesses: [],
      activeId: null,
      activity: [],
    };
  }

  // ---------- Business helpers ----------
  function seedBusiness(name, type, industry, ein, formed) {
    return {
      id: uid(),
      name,
      type,
      industry,
      ein,
      formed: formed || null,
      createdAt: Date.now(),
      checklist: DEFAULT_CHECKLIST.map((label) => ({
        id: uid(), label, done: false,
      })),
      net30: [],
      bank: [],
      credit: {
        db: null, exp: null, eq: null, fico: null,
        updatedAt: null,
        history: [],
      },
      reminders: [],
      platforms: {
        stripe: { id: "", url: "", status: "not_setup" },
        yelp:   { id: "", url: "", status: "not_listed" },
        google: { id: "", url: "", status: "not_listed" },
      },
      gov: {
        sam: { uei: "", cageCode: "", status: "not_registered", expirationDate: null },
        sbaCerts: [],
      },
      apiConfigs: [
        { id: uid(), name: "SAM.gov API Key",       service: "samgov", apiKey: "", environment: "production", status: "not_configured", notes: "" },
        { id: uid(), name: "Stripe Secret Key",     service: "stripe", apiKey: "", environment: "test",       status: "not_configured", notes: "" },
      ],
    };
  }

  // ---------- Render ----------
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function render() {
    renderBusinessSelect();
    renderTiles();
    renderBusinessCard();
    renderProfilesCard();
    renderNet30();
    renderBank();
    renderApiConfigs();
    renderCredit();
    renderReminders();
    renderActivity();
  }

  function renderBusinessSelect() {
    const sel = $("#businessSelect");
    sel.innerHTML = "";
    if (state.businesses.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No businesses — add one";
      opt.value = "";
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    state.businesses.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name;
      if (b.id === state.activeId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderTiles() {
    $("#statBusinesses").textContent = state.businesses.length;
    $("#statBusinessesFoot").textContent = state.businesses.length === 1 ? "tracked" : "tracked";

    let totalNet30 = 0, approvedNet30 = 0;
    let scoreSum = 0, scoreCount = 0;
    let cash = 0, availCredit = 0;
    state.businesses.forEach((b) => {
      totalNet30 += b.net30.length;
      approvedNet30 += b.net30.filter((n) => n.status === "approved").length;
      ["db", "exp", "eq"].forEach((k) => {
        if (typeof b.credit[k] === "number") {
          scoreSum += b.credit[k];
          scoreCount++;
        }
      });
      b.bank.forEach((a) => {
        if (a.type === "checking" || a.type === "savings") cash += Number(a.balance || 0);
        availCredit += Number(a.availableCredit || 0);
      });
    });
    $("#statNet30").textContent = totalNet30;
    $("#statNet30Foot").textContent = approvedNet30 + " approved";
    $("#statCredit").textContent = scoreCount ? Math.round(scoreSum / scoreCount) : "—";
    $("#statCreditFoot").textContent = scoreCount ? scoreCount + " scores tracked" : "across bureaus";
    $("#statCash").textContent = fmtMoney(cash);
    $("#statCashFoot").textContent = fmtMoney(availCredit) + " avail credit";
  }

  function renderBusinessCard() {
    const b = activeBusiness();
    const summary = $("#businessSummary");
    const list = $("#checklist");
    const ageEl = $("#businessAge");
    summary.innerHTML = "";
    list.innerHTML = "";
    if (!b) {
      ageEl.textContent = "—";
      summary.innerHTML = '<div class="empty-state">Add a business to get started.</div>';
      return;
    }
    ageEl.textContent = b.formed
      ? Math.max(0, daysBetween(new Date(b.formed).getTime(), Date.now())) + " days old"
      : "Formation date not set";

    const items = [
      ["Legal Name", b.name],
      ["Entity Type", b.type || "—"],
      ["Industry", b.industry || "—"],
      ["EIN", b.ein || "—"],
      ["Formed", fmtDate(b.formed)],
    ];
    items.forEach(([k, v]) => {
      const el = document.createElement("div");
      el.className = "summary-item";
      el.innerHTML = '<div class="k"></div><div class="v"></div>';
      el.querySelector(".k").textContent = k;
      el.querySelector(".v").textContent = v;
      summary.appendChild(el);
    });

    b.checklist.forEach((item) => {
      const row = document.createElement("div");
      row.className = "checkitem" + (item.done ? " done" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = item.done;
      cb.addEventListener("change", () => {
        item.done = cb.checked;
        log("task", (cb.checked ? "Completed" : "Reopened") + ' checklist item "' + item.label + '"');
        persist();
      });
      const span = document.createElement("span");
      span.textContent = item.label;
      const rm = document.createElement("button");
      rm.className = "btn btn-danger";
      rm.textContent = "×";
      rm.title = "Remove item";
      rm.addEventListener("click", () => {
        b.checklist = b.checklist.filter((i) => i.id !== item.id);
        log("task", 'Removed checklist item "' + item.label + '"');
        persist();
      });
      row.appendChild(cb);
      row.appendChild(span);
      row.appendChild(rm);
      list.appendChild(row);
    });
  }

  function platformStatusLabel(status) {
    return {
      not_setup:       "Not Set Up",
      not_listed:      "Not Listed",
      not_registered:  "Not Registered",
      not_configured:  "Not Configured",
      active:          "Active",
      verified:        "Verified",
      listed:          "Listed",
      claimed:         "Claimed",
      pending:         "Pending",
      unverified:      "Unverified",
      suspended:       "Suspended",
      expired:         "Expired",
      denied:          "Denied",
      inactive:        "Inactive",
    }[status] || status || "—";
  }

  function platformStatusChipClass(status) {
    return {
      active:         "chip chip-green",
      verified:       "chip chip-green",
      listed:         "chip chip-green",
      claimed:        "chip chip-green",
      pending:        "chip chip-yellow",
      unverified:     "chip chip-yellow",
      suspended:      "chip chip-red",
      expired:        "chip chip-red",
      denied:         "chip chip-red",
    }[status] || "chip chip-gray";
  }

  function certTypeLabel(type) {
    return {
      "8a":     "8(a) Business Dev",
      hubzone:  "HUBZone",
      wosb:     "WOSB",
      edwosb:   "EDWOSB",
      vosb:     "VOSB",
      sdvosb:   "SDVOSB",
      dbe:      "DBE",
      sdb:      "SDB",
    }[type] || type;
  }

  function renderProfilesCard() {
    const b = activeBusiness();
    const platformList = $("#platformList");
    const samInfo      = $("#samInfo");
    const certBody     = $("#sbaCertBody");

    platformList.innerHTML = "";
    samInfo.innerHTML      = "";
    certBody.innerHTML     = "";

    if (!b) {
      platformList.innerHTML = '<div class="empty-state">Add a business to manage profiles.</div>';
      samInfo.innerHTML      = '<div class="empty-state">—</div>';
      certBody.innerHTML     = '<tr><td class="empty" colspan="5">—</td></tr>';
      return;
    }

    // Ensure backward-compat defaults
    if (!b.platforms) {
      b.platforms = {
        stripe: { id: "", url: "", status: "not_setup" },
        yelp:   { id: "", url: "", status: "not_listed" },
        google: { id: "", url: "", status: "not_listed" },
      };
    }
    if (!b.gov) {
      b.gov = {
        sam: { uei: "", cageCode: "", status: "not_registered", expirationDate: null },
        sbaCerts: [],
      };
    }

    // --- Platform Accounts ---
    [
      { key: "stripe", name: "Stripe" },
      { key: "yelp",   name: "Yelp" },
      { key: "google", name: "Google Business" },
    ].forEach(({ key, name }) => {
      const p = b.platforms[key] || { id: "", url: "", status: "" };
      const row = document.createElement("div");
      row.className = "profile-item";

      const nameEl = document.createElement("div");
      nameEl.className = "profile-name";
      nameEl.textContent = name;

      const idEl = document.createElement("div");
      idEl.className = "profile-id";
      idEl.textContent = p.id || "—";

      const chip = document.createElement("span");
      chip.className = platformStatusChipClass(p.status);
      chip.textContent = platformStatusLabel(p.status);

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-small";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openPlatformModal(key));

      row.appendChild(nameEl);
      row.appendChild(idEl);
      row.appendChild(chip);
      row.appendChild(editBtn);
      platformList.appendChild(row);
    });

    // --- SAM.gov ---
    const sam = b.gov.sam || {};
    const samGrid = document.createElement("div");
    samGrid.className = "business-summary";
    [
      ["UEI",        sam.uei        || "—"],
      ["CAGE Code",  sam.cageCode   || "—"],
      ["Status",     platformStatusLabel(sam.status || "not_registered")],
      ["Expires",    fmtDate(sam.expirationDate)],
    ].forEach(([k, v]) => {
      const el = document.createElement("div");
      el.className = "summary-item";
      el.innerHTML = '<div class="k"></div><div class="v"></div>';
      el.querySelector(".k").textContent = k;
      el.querySelector(".v").textContent = v;
      samGrid.appendChild(el);
    });
    samInfo.appendChild(samGrid);

    // --- SBA Certs ---
    const certs = b.gov.sbaCerts || [];
    if (certs.length === 0) {
      certBody.innerHTML = '<tr><td class="empty" colspan="5">No SBA certifications tracked.</td></tr>';
      return;
    }
    certs.forEach((cert) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td></td>" +
        '<td><span class="' + platformStatusChipClass(cert.status) + '"></span></td>' +
        "<td></td><td></td>" +
        '<td class="actions"><button class="btn btn-small" data-edit-cert></button> ' +
        '<button class="btn btn-danger" data-del-cert>×</button></td>';
      const cells = tr.querySelectorAll("td");
      cells[0].textContent = certTypeLabel(cert.type);
      tr.querySelector("span").textContent = platformStatusLabel(cert.status);
      cells[2].textContent = fmtDate(cert.certDate);
      cells[3].textContent = fmtDate(cert.expirationDate);
      tr.querySelector("[data-edit-cert]").textContent = "Edit";
      tr.querySelector("[data-edit-cert]").addEventListener("click", () => openSbaCertModal(cert));
      tr.querySelector("[data-del-cert]").addEventListener("click", () => {
        const label = certTypeLabel(cert.type);
        if (!confirm("Remove " + label + " certification?")) return;
        b.gov.sbaCerts = b.gov.sbaCerts.filter((c) => c.id !== cert.id);
        log("biz", "Removed SBA cert " + label);
        persist();
      });
      certBody.appendChild(tr);
    });
  }

  function statusChipClass(status) {
    return {
      approved: "chip chip-green",
      pending:  "chip chip-yellow",
      denied:   "chip chip-red",
      closed:   "chip chip-gray",
      active:   "chip chip-green",
      frozen:   "chip chip-yellow",
    }[status] || "chip chip-gray";
  }

  function reportsToLabel(r) {
    const parts = [];
    if (r.db) parts.push("D&B");
    if (r.exp) parts.push("Experian");
    if (r.eq) parts.push("Equifax");
    return parts.length ? parts.join(", ") : "—";
  }

  function renderNet30() {
    const body = $("#net30Body");
    body.innerHTML = "";
    const b = activeBusiness();
    if (!b || b.net30.length === 0) {
      body.innerHTML = '<tr><td class="empty" colspan="7">No Net 30 accounts yet. Add a vendor to start tracking.</td></tr>';
      return;
    }
    b.net30.forEach((n) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td></td>" +
        '<td><span class="' + statusChipClass(n.status) + '"></span></td>' +
        "<td></td><td></td><td></td><td></td>" +
        '<td class="actions"><button class="btn btn-small" data-edit-n30></button> <button class="btn btn-danger" data-del-n30>×</button></td>';
      const cells = tr.querySelectorAll("td");
      cells[0].textContent = n.vendor;
      tr.querySelector("span").textContent = n.status;
      cells[2].textContent = fmtMoney(n.limit);
      cells[3].textContent = fmtMoney(n.balance);
      cells[4].textContent = reportsToLabel(n.reports || {});
      cells[5].textContent = fmtDate(n.opened);
      tr.querySelector("[data-edit-n30]").textContent = "Edit";
      tr.querySelector("[data-edit-n30]").addEventListener("click", () => openNet30Modal(n));
      tr.querySelector("[data-del-n30]").addEventListener("click", () => {
        if (!confirm("Delete Net 30 account " + n.vendor + "?")) return;
        b.net30 = b.net30.filter((x) => x.id !== n.id);
        log("net30", "Removed Net 30 vendor " + n.vendor);
        persist();
      });
      body.appendChild(tr);
    });
  }

  function renderBank() {
    const body = $("#bankBody");
    body.innerHTML = "";
    const b = activeBusiness();
    if (!b || b.bank.length === 0) {
      body.innerHTML = '<tr><td class="empty" colspan="7">No bank accounts yet.</td></tr>';
      return;
    }
    const typeLabel = {
      checking: "Checking",
      savings:  "Savings",
      credit:   "Credit Card",
      loc:      "Line of Credit",
      loan:     "Loan",
    };
    b.bank.forEach((a) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td></td><td></td><td></td><td></td><td></td>" +
        '<td><span class="' + statusChipClass(a.status) + '"></span></td>' +
        '<td class="actions"><button class="btn btn-small" data-edit-bk></button> <button class="btn btn-danger" data-del-bk>×</button></td>';
      const cells = tr.querySelectorAll("td");
      cells[0].textContent = a.institution;
      cells[1].textContent = a.accountName;
      cells[2].textContent = typeLabel[a.type] || a.type;
      cells[3].textContent = fmtMoney(a.balance);
      cells[4].textContent = fmtMoney(a.availableCredit);
      tr.querySelector("span").textContent = a.status;
      tr.querySelector("[data-edit-bk]").textContent = "Edit";
      tr.querySelector("[data-edit-bk]").addEventListener("click", () => openBankModal(a));
      tr.querySelector("[data-del-bk]").addEventListener("click", () => {
        if (!confirm("Delete account " + a.accountName + "?")) return;
        b.bank = b.bank.filter((x) => x.id !== a.id);
        log("bank", "Removed bank account " + a.accountName + " (" + a.institution + ")");
        persist();
      });
      body.appendChild(tr);
    });
  }

  function bandFor(score, max) {
    const pct = (score / max) * 100;
    if (pct < 40) return "low";
    if (pct < 70) return "mid";
    return "good";
  }

  const API_SERVICE_LABELS = {
    samgov: "SAM.gov",
    stripe: "Stripe",
    other:  "Other",
  };

  function apiConfigStatusChipClass(status) {
    return {
      active:          "chip chip-green",
      inactive:        "chip chip-yellow",
      expired:         "chip chip-red",
      not_configured:  "chip chip-gray",
    }[status] || "chip chip-gray";
  }

  const MASK_VISIBLE_CHARS = 4;

  function maskApiKey(key) {
    if (!key) return "—";
    if (key.length <= MASK_VISIBLE_CHARS) return "••••";
    return "••••" + key.slice(-MASK_VISIBLE_CHARS);
  }

  function rosterRows() {
    return state.businesses.map((b) => ({
      name: b.name || "",
      type: b.type || "",
      industry: b.industry || "",
      ein: b.ein || "",
      formed: b.formed || "",
      active: b.id === state.activeId ? "yes" : "no",
    }));
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportRosterJson() {
    downloadText(
      "business-roster-" + new Date().toISOString().slice(0, 10) + ".json",
      JSON.stringify({
        exportedAt: new Date().toISOString(),
        source: "runner_dashboard-site",
        businesses: rosterRows(),
      }, null, 2),
      "application/json"
    );
  }

  function exportRosterCsv() {
    const header = ["name", "type", "industry", "ein", "formed", "active"];
    const lines = [header.join(",")];
    rosterRows().forEach((row) => {
      lines.push([
        row.name,
        row.type,
        row.industry,
        row.ein,
        row.formed,
        row.active,
      ].map(csvEscape).join(","));
    });
    downloadText(
      "business-roster-" + new Date().toISOString().slice(0, 10) + ".csv",
      lines.join("\n"),
      "text/csv"
    );
  }

  function renderApiConfigs() {
    const body = $("#apiConfigBody");
    body.innerHTML = "";
    const b = activeBusiness();
    if (!b) {
      body.innerHTML = '<tr><td class="empty" colspan="6">Add a business to manage API configurations.</td></tr>';
      return;
    }
    if (!b.apiConfigs) b.apiConfigs = [];
    if (b.apiConfigs.length === 0) {
      body.innerHTML = '<tr><td class="empty" colspan="6">No API configurations yet. Click + Config to add one.</td></tr>';
      return;
    }
    b.apiConfigs.forEach((cfg) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td></td><td></td><td></td><td></td>" +
        '<td><span class="' + apiConfigStatusChipClass(cfg.status) + '"></span></td>' +
        '<td class="actions"><button class="btn btn-small" data-edit-api></button> ' +
        '<button class="btn btn-danger" data-del-api>×</button></td>';
      const cells = tr.querySelectorAll("td");
      cells[0].textContent = cfg.name;
      cells[1].textContent = API_SERVICE_LABELS[cfg.service] || cfg.service || "—";
      cells[2].textContent = maskApiKey(cfg.apiKey);
      cells[2].title       = cfg.notes || "";
      cells[3].textContent = cfg.environment || "—";
      tr.querySelector("span").textContent = platformStatusLabel(cfg.status);
      tr.querySelector("[data-edit-api]").textContent = "Edit";
      tr.querySelector("[data-edit-api]").addEventListener("click", () => openApiConfigModal(cfg));
      tr.querySelector("[data-del-api]").addEventListener("click", () => {
        if (!confirm('Remove API config "' + cfg.name + '"?')) return;
        b.apiConfigs = b.apiConfigs.filter((c) => c.id !== cfg.id);
        log("api", 'Removed API config "' + cfg.name + '"');
        persist();
      });
      body.appendChild(tr);
    });
  }

  function renderCredit() {
    const grid = $("#creditGrid");
    grid.innerHTML = "";
    const histBody = $("#creditHistoryBody");
    histBody.innerHTML = "";
    const b = activeBusiness();
    if (!b) {
      grid.innerHTML = '<div class="empty-state">Add a business to track credit scores.</div>';
      histBody.innerHTML = '<tr><td class="empty" colspan="5">No history yet.</td></tr>';
      return;
    }
    const c = b.credit;
    const rows = [
      { key: "db",   name: "D&B PAYDEX",           max: 100 },
      { key: "exp",  name: "Experian Intelliscore", max: 100 },
      { key: "eq",   name: "Equifax Business",     max: 100 },
      { key: "fico", name: "FICO SBSS",            max: 300 },
    ];
    rows.forEach((r) => {
      const val = c[r.key];
      const el = document.createElement("div");
      el.className = "credit-item";
      const pct = typeof val === "number" ? Math.max(4, Math.min(100, (val / r.max) * 100)) : 0;
      const band = typeof val === "number" ? bandFor(val, r.max) : "";
      el.innerHTML =
        '<div class="name"></div>' +
        '<div class="score"></div>' +
        '<div class="credit-bar"><span></span></div>' +
        '<div class="foot"></div>';
      el.querySelector(".name").textContent = r.name;
      el.querySelector(".score").textContent = typeof val === "number" ? val : "—";
      const bar = el.querySelector(".credit-bar > span");
      bar.style.width = pct + "%";
      bar.classList.add(band);
      el.querySelector(".foot").textContent = "Max " + r.max;
      grid.appendChild(el);
    });

    if (!c.history || c.history.length === 0) {
      histBody.innerHTML = '<tr><td class="empty" colspan="5">No score history yet. Click Update Scores.</td></tr>';
      return;
    }
    const bureauLabel = { db: "D&B PAYDEX", exp: "Experian", eq: "Equifax", fico: "FICO SBSS" };
    c.history.slice(0, 30).forEach((entry, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td></td><td></td><td></td>" +
        '<td class="actions"><button class="btn btn-danger" data-del-hist>×</button></td>';
      const cells = tr.querySelectorAll("td");
      cells[0].textContent = fmtDate(entry.date);
      cells[1].textContent = bureauLabel[entry.bureau] || entry.bureau;
      cells[2].textContent = entry.score;
      const prior = c.history.slice(i + 1).find((h) => h.bureau === entry.bureau);
      if (prior) {
        const diff = entry.score - prior.score;
        const arrow = diff > 0 ? "▲" : (diff < 0 ? "▼" : "→");
        const cls = diff > 0 ? "trend-up" : (diff < 0 ? "trend-down" : "trend-flat");
        cells[3].innerHTML = '<span class="' + cls + '">' + arrow + " " + Math.abs(diff) + "</span>";
      } else {
        cells[3].innerHTML = '<span class="trend-flat">—</span>';
      }
      tr.querySelector("[data-del-hist]").addEventListener("click", () => {
        c.history = c.history.filter((h) => h.id !== entry.id);
        log("credit", "Removed credit history entry");
        persist();
      });
      histBody.appendChild(tr);
    });
  }

  function renderReminders() {
    const list = $("#reminderList");
    list.innerHTML = "";
    const b = activeBusiness();
    if (!b || b.reminders.length === 0) {
      list.innerHTML = '<div class="empty-state">No reminders. Track filing deadlines, payments, or renewals.</div>';
      return;
    }
    const now = Date.now();
    const sorted = b.reminders.slice().sort((a, z) => new Date(a.due).getTime() - new Date(z.due).getTime());
    sorted.forEach((r) => {
      const li = document.createElement("li");
      const due = new Date(r.due).getTime();
      const days = daysBetween(now, due);
      if (days < 0) li.classList.add("overdue");
      else if (days <= 7) li.classList.add("soon");
      let dueText;
      if (days < 0) dueText = Math.abs(days) + "d overdue";
      else if (days === 0) dueText = "Today";
      else if (days === 1) dueText = "Tomorrow";
      else dueText = "in " + days + "d";
      li.innerHTML = '<div class="title"></div><div class="due"></div>' +
        '<button class="btn btn-danger" data-del-rem>×</button>';
      li.querySelector(".title").textContent = "[" + r.category + "] " + r.title;
      li.querySelector(".due").textContent = fmtDate(r.due) + " · " + dueText;
      li.querySelector("[data-del-rem]").addEventListener("click", () => {
        b.reminders = b.reminders.filter((x) => x.id !== r.id);
        log("task", 'Removed reminder "' + r.title + '"');
        persist();
      });
      list.appendChild(li);
    });
  }

  function renderActivity() {
    const list = $("#activityList");
    list.innerHTML = "";
    if (state.activity.length === 0) {
      list.innerHTML = '<div class="empty-state">No activity yet.</div>';
      return;
    }
    state.activity.slice(0, 100).forEach((a) => {
      const li = document.createElement("li");
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = fmtTime(a.ts);
      const msg = document.createElement("span");
      msg.className = "msg";
      const tag = document.createElement("span");
      tag.className = "tag tag-" + a.tag;
      tag.textContent = a.tag;
      msg.appendChild(tag);
      msg.appendChild(document.createTextNode(a.msg));
      li.appendChild(time);
      li.appendChild(msg);
      list.appendChild(li);
    });
  }

  // ---------- Persist + broadcast ----------
  function persist() {
    save();
    render();
  }

  // ---------- Modals ----------
  function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.hidden = false;
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.hidden = true;
  }
  document.addEventListener("click", (e) => {
    if (e.target.matches("[data-close]")) {
      const m = e.target.closest(".modal");
      if (m) m.hidden = true;
    }
    if (e.target.classList.contains("modal")) {
      e.target.hidden = true;
    }
  });

  // Add business
  $("#addBusinessBtn").addEventListener("click", () => {
    $("#bName").value = "";
    $("#bType").value = "LLC";
    $("#bIndustry").value = "";
    $("#bEin").value = "";
    $("#bFormed").value = "";
    openModal("modalBusiness");
    setTimeout(() => $("#bName").focus(), 0);
  });
  $("#bSave").addEventListener("click", () => {
    const name = $("#bName").value.trim();
    if (!name) { $("#bName").focus(); return; }
    const b = seedBusiness(
      name,
      $("#bType").value,
      $("#bIndustry").value.trim(),
      $("#bEin").value.trim(),
      $("#bFormed").value || null,
    );
    state.businesses.push(b);
    state.activeId = b.id;
    log("biz", "Added business " + b.name);
    closeModal("modalBusiness");
    persist();
  });

  // Business selector
  $("#businessSelect").addEventListener("change", (e) => {
    state.activeId = e.target.value;
    persist();
  });

  // Checklist add
  $("#addCheckItem").addEventListener("click", addChecklistItem);
  $("#newCheckItem").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addChecklistItem();
  });
  function addChecklistItem() {
    const b = activeBusiness();
    if (!b) return;
    const label = $("#newCheckItem").value.trim();
    if (!label) return;
    b.checklist.push({ id: uid(), label, done: false });
    log("task", 'Added checklist item "' + label + '"');
    $("#newCheckItem").value = "";
    persist();
  }

  // Net 30
  $("#addNet30Btn").addEventListener("click", () => openNet30Modal(null));
  function openNet30Modal(existing) {
    if (!activeBusiness()) { alert("Add a business first."); return; }
    editing.net30Id = existing ? existing.id : null;
    $("#net30Title").textContent = existing ? "Edit Net 30 Vendor" : "Add Net 30 Vendor";
    $("#n30Vendor").value  = existing ? existing.vendor  : "";
    $("#n30Status").value  = existing ? existing.status  : "pending";
    $("#n30Limit").value   = existing ? existing.limit   : "";
    $("#n30Balance").value = existing ? existing.balance : "";
    $("#n30Opened").value  = existing ? existing.opened  : "";
    $("#n30rDB").checked   = !!(existing && existing.reports && existing.reports.db);
    $("#n30rEXP").checked  = !!(existing && existing.reports && existing.reports.exp);
    $("#n30rEQ").checked   = !!(existing && existing.reports && existing.reports.eq);
    openModal("modalNet30");
    setTimeout(() => $("#n30Vendor").focus(), 0);
  }
  $("#n30Save").addEventListener("click", () => {
    const b = activeBusiness();
    if (!b) return;
    const vendor = $("#n30Vendor").value.trim();
    if (!vendor) { $("#n30Vendor").focus(); return; }
    const payload = {
      vendor,
      status: $("#n30Status").value,
      limit: Number($("#n30Limit").value) || 0,
      balance: Number($("#n30Balance").value) || 0,
      opened: $("#n30Opened").value || null,
      reports: {
        db:  $("#n30rDB").checked,
        exp: $("#n30rEXP").checked,
        eq:  $("#n30rEQ").checked,
      },
    };
    if (editing.net30Id) {
      const target = b.net30.find((n) => n.id === editing.net30Id);
      if (target) {
        const priorStatus = target.status;
        Object.assign(target, payload);
        log("net30", "Updated " + vendor + (priorStatus !== payload.status ? " → " + payload.status : ""));
      }
    } else {
      b.net30.push(Object.assign({ id: uid() }, payload));
      log("net30", "Added Net 30 vendor " + vendor + " (" + payload.status + ")");
    }
    closeModal("modalNet30");
    persist();
  });

  // Bank
  $("#addBankBtn").addEventListener("click", () => openBankModal(null));
  function openBankModal(existing) {
    if (!activeBusiness()) { alert("Add a business first."); return; }
    editing.bankId = existing ? existing.id : null;
    $("#bankTitle").textContent = existing ? "Edit Bank Account" : "Add Bank Account";
    $("#bkInst").value    = existing ? existing.institution     : "";
    $("#bkAcct").value    = existing ? existing.accountName     : "";
    $("#bkType").value    = existing ? existing.type            : "checking";
    $("#bkBalance").value = existing ? existing.balance         : "";
    $("#bkAvail").value   = existing ? existing.availableCredit : "";
    $("#bkStatus").value  = existing ? existing.status          : "active";
    openModal("modalBank");
    setTimeout(() => $("#bkInst").focus(), 0);
  }
  $("#bkSave").addEventListener("click", () => {
    const b = activeBusiness();
    if (!b) return;
    const inst = $("#bkInst").value.trim();
    const acct = $("#bkAcct").value.trim();
    if (!inst || !acct) { $("#bkInst").focus(); return; }
    const payload = {
      institution: inst,
      accountName: acct,
      type: $("#bkType").value,
      balance: Number($("#bkBalance").value) || 0,
      availableCredit: Number($("#bkAvail").value) || 0,
      status: $("#bkStatus").value,
    };
    if (editing.bankId) {
      const target = b.bank.find((a) => a.id === editing.bankId);
      if (target) {
        Object.assign(target, payload);
        log("bank", "Updated " + inst + " · " + acct);
      }
    } else {
      b.bank.push(Object.assign({ id: uid() }, payload));
      log("bank", "Added " + payload.type + " account " + acct + " (" + inst + ")");
    }
    closeModal("modalBank");
    persist();
  });

  // Credit
  $("#editCreditBtn").addEventListener("click", () => {
    const b = activeBusiness();
    if (!b) { alert("Add a business first."); return; }
    const c = b.credit;
    $("#crDB").value   = c.db   ?? "";
    $("#crEXP").value  = c.exp  ?? "";
    $("#crEQ").value   = c.eq   ?? "";
    $("#crFICO").value = c.fico ?? "";
    $("#crDate").value = new Date().toISOString().slice(0, 10);
    openModal("modalCredit");
  });
  $("#crSave").addEventListener("click", () => {
    const b = activeBusiness();
    if (!b) return;
    const date = $("#crDate").value || new Date().toISOString().slice(0, 10);
    const updates = [
      ["db",   Number($("#crDB").value)],
      ["exp",  Number($("#crEXP").value)],
      ["eq",   Number($("#crEQ").value)],
      ["fico", Number($("#crFICO").value)],
    ];
    let changed = 0;
    updates.forEach(([k, v]) => {
      if (!Number.isFinite(v)) return;
      const el = document.getElementById(
        { db: "crDB", exp: "crEXP", eq: "crEQ", fico: "crFICO" }[k]
      );
      if (el.value === "") return;
      const prior = b.credit[k];
      if (prior !== v) {
        b.credit[k] = v;
        b.credit.history.unshift({ id: uid(), date, bureau: k, score: v });
        changed++;
      }
    });
    if (changed) {
      b.credit.updatedAt = Date.now();
      log("credit", "Updated " + changed + " credit score" + (changed === 1 ? "" : "s"));
    }
    closeModal("modalCredit");
    persist();
  });

  // Reminders
  $("#addReminderBtn").addEventListener("click", () => {
    if (!activeBusiness()) { alert("Add a business first."); return; }
    $("#rmTitle").value = "";
    $("#rmDate").value = "";
    $("#rmCat").value = "Filing";
    openModal("modalReminder");
    setTimeout(() => $("#rmTitle").focus(), 0);
  });
  $("#rmSave").addEventListener("click", () => {
    const b = activeBusiness();
    if (!b) return;
    const title = $("#rmTitle").value.trim();
    const due = $("#rmDate").value;
    if (!title || !due) return;
    b.reminders.push({
      id: uid(), title, due, category: $("#rmCat").value,
    });
    log("task", 'Added reminder "' + title + '" due ' + fmtDate(due));
    closeModal("modalReminder");
    persist();
  });

  // Platform accounts (Stripe / Yelp / Google Business)
  function openPlatformModal(key) {
    const b = activeBusiness();
    if (!b) { alert("Add a business first."); return; }
    const cfg = PLATFORM_CONFIG[key];
    if (!cfg) return;
    editing.platformKey = key;
    if (!b.platforms) b.platforms = {};
    if (!b.platforms[key]) b.platforms[key] = { id: "", url: "", status: cfg.statusOptions[0].value };
    const p = b.platforms[key];

    $("#platModalTitle").textContent = cfg.title;
    const idLabelEl = $("#platIdLabel");
    idLabelEl.childNodes[0].nodeValue = cfg.idLabel + " ";
    $("#platId").placeholder = cfg.idPlaceholder;
    $("#platId").value = p.id || "";

    const urlLabel = $("#platUrlLabel");
    urlLabel.hidden = !cfg.hasUrl;
    if (cfg.hasUrl) {
      urlLabel.childNodes[0].nodeValue = cfg.urlLabel + " ";
      $("#platUrl").placeholder = cfg.urlPlaceholder || "https://";
      $("#platUrl").value = p.url || "";
    }

    const sel = $("#platStatus");
    sel.innerHTML = "";
    cfg.statusOptions.forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === p.status) opt.selected = true;
      sel.appendChild(opt);
    });

    openModal("modalPlatformAcct");
    setTimeout(() => $("#platId").focus(), 0);
  }
  $("#platSave").addEventListener("click", () => {
    const b = activeBusiness();
    if (!b || !editing.platformKey) return;
    const key = editing.platformKey;
    const cfg = PLATFORM_CONFIG[key];
    if (!b.platforms) b.platforms = {};
    const prior = b.platforms[key] || {};
    b.platforms[key] = {
      id:     $("#platId").value.trim(),
      url:    cfg.hasUrl ? $("#platUrl").value.trim() : "",
      status: $("#platStatus").value,
    };
    log("biz", "Updated " + cfg.title + " → " + platformStatusLabel(b.platforms[key].status));
    closeModal("modalPlatformAcct");
    persist();
  });

  // SAM.gov
  $("#editSamBtn").addEventListener("click", () => {
    const b = activeBusiness();
    if (!b) { alert("Add a business first."); return; }
    if (!b.gov) b.gov = { sam: { uei: "", cageCode: "", status: "not_registered", expirationDate: null }, sbaCerts: [] };
    const sam = b.gov.sam || {};
    $("#samUei").value        = sam.uei          || "";
    $("#samCage").value       = sam.cageCode      || "";
    $("#samStatus").value     = sam.status        || "not_registered";
    $("#samExpiration").value = sam.expirationDate || "";
    openModal("modalSam");
    setTimeout(() => $("#samUei").focus(), 0);
  });
  $("#samSave").addEventListener("click", () => {
    const b = activeBusiness();
    if (!b) return;
    if (!b.gov) b.gov = { sam: {}, sbaCerts: [] };
    b.gov.sam = {
      uei:            $("#samUei").value.trim().toUpperCase(),
      cageCode:       $("#samCage").value.trim().toUpperCase(),
      status:         $("#samStatus").value,
      expirationDate: $("#samExpiration").value || null,
    };
    log("biz", "Updated SAM.gov registration → " + platformStatusLabel(b.gov.sam.status));
    closeModal("modalSam");
    persist();
  });

  // SBA Certifications
  $("#addSbaCertBtn").addEventListener("click", () => openSbaCertModal(null));
  function openSbaCertModal(existing) {
    const b = activeBusiness();
    if (!b) { alert("Add a business first."); return; }
    editing.sbaCertId = existing ? existing.id : null;
    $("#sbaCertTitle").textContent = existing ? "Edit SBA Certification" : "Add SBA Certification";
    $("#sbaCertType").value   = existing ? existing.type           : "8a";
    $("#sbaCertStatus").value = existing ? existing.status         : "pending";
    $("#sbaCertDate").value   = existing ? (existing.certDate || "") : "";
    $("#sbaCertExpiry").value = existing ? (existing.expirationDate || "") : "";
    openModal("modalSbaCert");
  }
  $("#sbaCertSave").addEventListener("click", () => {
    const b = activeBusiness();
    if (!b) return;
    if (!b.gov) b.gov = { sam: {}, sbaCerts: [] };
    if (!b.gov.sbaCerts) b.gov.sbaCerts = [];
    const payload = {
      type:           $("#sbaCertType").value,
      status:         $("#sbaCertStatus").value,
      certDate:       $("#sbaCertDate").value || null,
      expirationDate: $("#sbaCertExpiry").value || null,
    };
    const label = certTypeLabel(payload.type);
    if (editing.sbaCertId) {
      const target = b.gov.sbaCerts.find((c) => c.id === editing.sbaCertId);
      if (target) {
        Object.assign(target, payload);
        log("biz", "Updated SBA cert " + label);
      }
    } else {
      b.gov.sbaCerts.push(Object.assign({ id: uid() }, payload));
      log("biz", "Added SBA cert " + label + " (" + payload.status + ")");
    }
    closeModal("modalSbaCert");
    persist();
  });

  // API Configurations
  $("#addApiConfigBtn").addEventListener("click", () => openApiConfigModal(null));
  function openApiConfigModal(existing) {
    const b = activeBusiness();
    if (!b) { alert("Add a business first."); return; }
    editing.apiConfigId = existing ? existing.id : null;
    $("#apiConfigTitle").textContent = existing ? "Edit API Configuration" : "Add API Configuration";
    $("#apiName").value    = existing ? existing.name        : "";
    $("#apiService").value = existing ? (existing.service || "other") : "samgov";
    $("#apiKey").value     = existing ? existing.apiKey      : "";
    $("#apiEnv").value     = existing ? (existing.environment || "production") : "production";
    $("#apiStatus").value  = existing ? existing.status      : "not_configured";
    $("#apiNotes").value   = existing ? (existing.notes || "") : "";
    openModal("modalApiConfig");
    setTimeout(() => $("#apiName").focus(), 0);
  }
  $("#apiConfigSave").addEventListener("click", () => {
    const b = activeBusiness();
    if (!b) return;
    const name = $("#apiName").value.trim();
    if (!name) { $("#apiName").focus(); return; }
    if (!b.apiConfigs) b.apiConfigs = [];
    const payload = {
      name,
      service:     $("#apiService").value,
      apiKey:      $("#apiKey").value.trim(),
      environment: $("#apiEnv").value,
      status:      $("#apiStatus").value,
      notes:       $("#apiNotes").value.trim(),
    };
    if (editing.apiConfigId) {
      const target = b.apiConfigs.find((c) => c.id === editing.apiConfigId);
      if (target) {
        Object.assign(target, payload);
        log("api", 'Updated API config "' + name + '"');
      }
    } else {
      b.apiConfigs.push(Object.assign({ id: uid() }, payload));
      log("api", 'Added API config "' + name + '"');
    }
    closeModal("modalApiConfig");
    persist();
  });

  // Activity clear
  $("#clearActivityBtn").addEventListener("click", () => {
    if (!confirm("Clear activity feed?")) return;
    state.activity = [];
    persist();
  });

  // Export / Import
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "business-dashboard-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
  $("#exportRosterJsonBtn").addEventListener("click", exportRosterJson);
  $("#exportRosterCsvBtn").addEventListener("click", exportRosterCsv);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.businesses)) throw new Error("Invalid file");
        if (!confirm("Import will replace current dashboard. Continue?")) return;
        state = parsed;
        log("biz", "Imported dashboard from file");
        persist();
      } catch (err) {
        alert("Import failed: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // ---------- Bulk CSV Upload ----------

  // Normalise a string to space-separated tokens, wrapped in leading/trailing
  // spaces so that word-boundary checks work with a simple includes() call.
  function normTokens(str) {
    return " " + String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  }

  // Classification: keyword → sector.
  // Keywords are pre-normalised once at load time; the same normalisation is
  // applied to the haystack so "bar" won't match inside "barbaric".
  const CLASSIFICATION_RULES = [
    { cls: "Technology",        cssClass: "cls-technology",    keywords: ["tech","software","digital","web","webapp","saas","cyber","database","cloud","gaming","coding","developer","devops","computer","hardware","electronics","telecom","network","infosec","artificial intelligence","machine learning"] },
    { cls: "Healthcare",        cssClass: "cls-healthcare",    keywords: ["health","medical","dental","pharma","biotech","clinic","hospital","therapy","wellness","mental","vision","rehab","nursing","physician","doctor","nurse","lab","laboratory"] },
    { cls: "Retail",            cssClass: "cls-retail",        keywords: ["retail","store","shop","ecommerce","boutique","merchandise","fashion","apparel","clothing","jewelry","gift shop","supplies","wholesale","distribution","import","export"] },
    { cls: "Food & Beverage",   cssClass: "cls-food",          keywords: ["food","restaurant","cafe","catering","beverage","tavern","saloon","bakery","brewery","winery","kitchen","dining","pizza","taco","burger","grill","bistro","deli","snack","drink","bar","lounge"] },
    { cls: "Construction",      cssClass: "cls-construction",  keywords: ["construct","contractor","building","plumbing","electrical","hvac","renovation","remodel","landscaping","roofing","paving","welding","carpentry","masonry","excavation","infrastructure"] },
    { cls: "Finance",           cssClass: "cls-finance",       keywords: ["finance","accounting","cpa","tax","insurance","investment","mortgage","banking","credit union","lending","fund","wealth","capital","brokerage","payroll","bookkeeping","audit"] },
    { cls: "Real Estate",       cssClass: "cls-realestate",    keywords: ["real estate","realty","property","rental","housing","commercial real","residential","apartments","leasing","asset management","land"] },
    { cls: "Professional Svcs", cssClass: "cls-professional",  keywords: ["consulting","law firm","legal","attorney","marketing","advertising","staffing","human resource","management","recruitment","research","training","coaching","engineering services"] },
    { cls: "Transportation",    cssClass: "cls-transportation",keywords: ["transport","logistics","delivery","freight","trucking","moving","fleet","courier","shipping","warehouse","supply chain","auto repair","vehicle"] },
    { cls: "Manufacturing",     cssClass: "cls-manufacturing", keywords: ["manufacturing","production","factory","fabrication","assembly","industrial","machining","printing","packaging","chemical","materials","metal","steel","plastics"] },
  ].map((rule) => ({ ...rule, keywords: rule.keywords.map(normTokens) }));

  function classifyBusiness(industry, name) {
    const haystack = normTokens((industry || "") + " " + (name || ""));
    for (const rule of CLASSIFICATION_RULES) {
      for (const normKw of rule.keywords) {
        if (haystack.includes(normKw)) return rule;
      }
    }
    return { cls: "Other", cssClass: "cls-other", keywords: [] };
  }

  // Helper: pluralise "business / businesses"
  function fmtBusinessCount(n) {
    return n + " Business" + (n !== 1 ? "es" : "");
  }

  // Robust CSV parser (handles quoted fields, newlines in quotes, large files)
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (inQ) {
        if (ch === '"' && next === '"') { field += '"'; i++; }
        else if (ch === '"') { inQ = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQ = true; }
        else if (ch === ',') { row.push(field.trim()); field = ""; }
        else if (ch === '\n' || ch === '\r') {
          row.push(field.trim()); field = "";
          if (row.some(Boolean)) rows.push(row);
          row = [];
          if (ch === '\r' && next === '\n') i++;
        } else { field += ch; }
      }
    }
    row.push(field.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }

  // Map a header string to a canonical field key
  function mapHeader(h) {
    const cleanedHeader = h.toLowerCase().replace(/[\s_\-]+/g, "");
    if (["name","businessname","legalname","company","companyname","bizname","business"].includes(cleanedHeader)) return "name";
    if (["type","entitytype","entity","businesstype","structure","legalstructure","form"].includes(cleanedHeader)) return "type";
    if (["industry","sector","field","vertical","businesssector"].includes(cleanedHeader)) return "industry";
    if (["ein","taxid","federaltaxid","taxpayerid","tin","fein"].includes(cleanedHeader)) return "ein";
    if (["formed","incorporated","startdate","dateformed","dateincorporated","foundeddate","founded","opened"].includes(cleanedHeader)) return "formed";
    if (["classification","class","category","segment"].includes(cleanedHeader)) return "classification";
    return null;
  }

  // Normalise entity type string to one of the select option values
  function normaliseEntityType(raw) {
    if (!raw) return "LLC";
    const s = raw.trim().toLowerCase();
    if (s.includes("s-corp") || s.includes("s corp") || s === "scorp") return "S-Corp";
    if (s.includes("c-corp") || s.includes("c corp") || s === "ccorp" || s === "corporation") return "C-Corp";
    if (s.includes("sole") || s.includes("proprietor") || s === "sp") return "Sole Prop";
    if (s.includes("partner")) return "Partnership";
    if (s.includes("llc") || s.includes("l.l.c")) return "LLC";
    return raw.trim() || "LLC";
  }

  // Parse raw CSV rows into structured business preview objects
  function csvRowsToBusinesses(rows) {
    if (rows.length < 2) throw new Error("CSV must have a header row and at least one data row.");
    const headers = rows[0].map((h) => mapHeader(h));
    const businesses = [];
    const existingNames = new Set(state.businesses.map((b) => b.name.trim().toLowerCase()));

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every((c) => !c)) continue; // skip blank rows
      const rec = {};
      headers.forEach((key, idx) => {
        if (key) rec[key] = row[idx] || "";
      });
      const name = (rec.name || "").trim();
      if (!name) continue;
      const industry = (rec.industry || "").trim();
      const clsRule = rec.classification
        ? { cls: rec.classification, cssClass: "cls-other", keywords: [] }
        : classifyBusiness(industry, name);
      if (rec.classification) {
        // Try to match css class from built-in rules
        const found = CLASSIFICATION_RULES.find((r) => r.cls.toLowerCase() === rec.classification.toLowerCase());
        if (found) { clsRule.cls = found.cls; clsRule.cssClass = found.cssClass; }
      }
      businesses.push({
        _rowIdx: i,
        name,
        type: normaliseEntityType(rec.type),
        industry,
        ein: (rec.ein || "").trim(),
        formed: (rec.formed || "").trim(),
        classification: clsRule.cls,
        classificationCss: clsRule.cssClass,
        duplicate: existingNames.has(name.toLowerCase()),
        selected: !existingNames.has(name.toLowerCase()),
      });
    }
    if (businesses.length === 0) throw new Error("No valid business rows found. Ensure the CSV has a 'name' column.");
    return businesses;
  }

  // Bulk upload state
  let bulkParsed = [];
  let bulkFilterClass = "";
  let bulkSortBy = "name";

  function buildClassStats(rows) {
    const counts = {};
    rows.forEach((r) => {
      counts[r.classification] = counts[r.classification] || { cls: r.classification, css: r.classificationCss, count: 0 };
      counts[r.classification].count++;
    });
    return Object.values(counts).sort((a, b) => b.count - a.count);
  }

  function renderBulkPreview() {
    const stats = buildClassStats(bulkParsed);
    // Stats chips
    const statsEl = $("#bulkStats");
    statsEl.innerHTML = "";
    stats.forEach((s) => {
      const chip = document.createElement("span");
      chip.className = "bulk-stat-chip chip " + s.css;
      chip.textContent = s.cls + " (" + s.count + ")";
      chip.addEventListener("click", () => {
        bulkFilterClass = (bulkFilterClass === s.cls) ? "" : s.cls;
        $("#bulkFilterClass").value = bulkFilterClass;
        renderBulkTable();
      });
      statsEl.appendChild(chip);
    });

    // Filter dropdown options
    const filterSel = $("#bulkFilterClass");
    filterSel.innerHTML = '<option value="">All</option>';
    stats.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.cls;
      opt.textContent = s.cls + " (" + s.count + ")";
      filterSel.appendChild(opt);
    });
    filterSel.value = bulkFilterClass;

    renderBulkTable();
  }

  function renderBulkTable() {
    let rows = bulkParsed.slice();

    if (bulkFilterClass) rows = rows.filter((r) => r.classification === bulkFilterClass);

    rows.sort((a, b) => {
      if (bulkSortBy === "classification") return a.classification.localeCompare(b.classification);
      if (bulkSortBy === "type") return a.type.localeCompare(b.type);
      return a.name.localeCompare(b.name);
    });

    const tbody = $("#bulkPreviewBody");
    tbody.innerHTML = "";
    rows.forEach((rec) => {
      const tr = document.createElement("tr");
      if (rec.duplicate) tr.className = "bulk-duplicate";
      const status = rec.duplicate
        ? '<span class="chip chip-yellow">Duplicate</span>'
        : '<span class="chip chip-green">New</span>';
      tr.innerHTML =
        '<td><input type="checkbox" class="bulk-row-check" data-row="' + rec._rowIdx + '"' + (rec.selected ? " checked" : "") + (rec.duplicate ? ' title="Already exists"' : "") + ' /></td>' +
        '<td>' + escapeHtml(rec.name) + '</td>' +
        '<td>' + escapeHtml(rec.type) + '</td>' +
        '<td>' + escapeHtml(rec.industry || "—") + '</td>' +
        '<td><span class="chip bulk-stat-chip ' + rec.classificationCss + '">' + escapeHtml(rec.classification) + '</span></td>' +
        '<td>' + escapeHtml(rec.ein || "—") + '</td>' +
        '<td>' + escapeHtml(rec.formed || "—") + '</td>' +
        '<td>' + status + '</td>';
      tbody.appendChild(tr);
    });

    const selCount = bulkParsed.filter((r) => r.selected).length;
    $("#bulkRowCount").textContent = rows.length + " row" + (rows.length !== 1 ? "s" : "") + " shown";
    $("#bulkImportBtn").textContent = "Import " + fmtBusinessCount(selCount);
    // Select-all state
    const allChecked = rows.length > 0 && rows.every((r) => r.selected);
    $("#bulkSelectAll").checked = allChecked;
    $("#bulkSelectAll").indeterminate = !allChecked && rows.some((r) => r.selected);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function resetBulkModal() {
    bulkParsed = [];
    bulkFilterClass = "";
    bulkSortBy = "name";
    $("#bulkDropZone").hidden = false;
    $("#bulkResults").hidden = true;
    $("#bulkImportBtn").hidden = true;
    $("#bulkResetBtn").hidden = true;
    $("#bulkSubtitle").textContent = "Upload a CSV file to parse, classify, and import businesses.";
    $("#uploadCsvFileModal").value = "";
  }

  function handleCsvFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      alert("Please select a CSV (.csv) file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(reader.result);
        bulkParsed = csvRowsToBusinesses(rows);
        $("#bulkDropZone").hidden = true;
        $("#bulkResults").hidden = false;
        $("#bulkImportBtn").hidden = false;
        $("#bulkResetBtn").hidden = false;
        $("#bulkSubtitle").textContent = "Parsed " + bulkParsed.length + " record" + (bulkParsed.length !== 1 ? "s" : "") + " from " + file.name + ". Review, then import.";
        renderBulkPreview();
      } catch (err) {
        alert("CSV parse error: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // Topbar button
  $("#uploadCsvBtn").addEventListener("click", () => {
    resetBulkModal();
    openModal("modalBulkUpload");
  });
  // Topbar hidden file input (redundant path, kept for programmatic use)
  $("#uploadCsvFile").addEventListener("change", (e) => {
    handleCsvFile(e.target.files[0]);
    e.target.value = "";
  });

  // Modal file input (browse link)
  $("#uploadCsvFileModal").addEventListener("change", (e) => {
    handleCsvFile(e.target.files[0]);
    e.target.value = "";
  });

  // Click on drop zone triggers file chooser
  $("#bulkDropZone").addEventListener("click", (e) => {
    if (e.target.tagName !== "LABEL" && e.target.tagName !== "INPUT") {
      $("#uploadCsvFileModal").click();
    }
  });

  // Drag-and-drop
  ["dragenter", "dragover"].forEach((evt) => {
    $("#bulkDropZone").addEventListener(evt, (e) => {
      e.preventDefault();
      $("#bulkDropZone").classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    $("#bulkDropZone").addEventListener(evt, (e) => {
      e.preventDefault();
      $("#bulkDropZone").classList.remove("drag-over");
    });
  });
  $("#bulkDropZone").addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    handleCsvFile(file);
  });

  // Filter / sort controls
  $("#bulkFilterClass").addEventListener("change", (e) => {
    bulkFilterClass = e.target.value;
    renderBulkTable();
  });
  $("#bulkSortBy").addEventListener("change", (e) => {
    bulkSortBy = e.target.value;
    renderBulkTable();
  });

  // Select-all checkbox
  $("#bulkSelectAll").addEventListener("change", (e) => {
    const checked = e.target.checked;
    // Only affect currently visible rows
    $$(".bulk-row-check").forEach((cb) => {
      const idx = parseInt(cb.dataset.row, 10);
      const rec = bulkParsed.find((r) => r._rowIdx === idx);
      if (rec) rec.selected = checked;
      cb.checked = checked;
    });
    const selCount = bulkParsed.filter((r) => r.selected).length;
    $("#bulkImportBtn").textContent = "Import " + fmtBusinessCount(selCount);
  });

  // Individual row checkbox (event delegation)
  $("#bulkPreviewBody").addEventListener("change", (e) => {
    if (!e.target.classList.contains("bulk-row-check")) return;
    const idx = parseInt(e.target.dataset.row, 10);
    const rec = bulkParsed.find((r) => r._rowIdx === idx);
    if (rec) rec.selected = e.target.checked;
    // Update select-all
    const visible = $$(".bulk-row-check");
    const allChecked = visible.length > 0 && visible.every((cb) => cb.checked);
    $("#bulkSelectAll").checked = allChecked;
    $("#bulkSelectAll").indeterminate = !allChecked && visible.some((cb) => cb.checked);
    const selCount = bulkParsed.filter((r) => r.selected).length;
    $("#bulkImportBtn").textContent = "Import " + fmtBusinessCount(selCount);
  });

  // Reset (re-upload)
  $("#bulkResetBtn").addEventListener("click", resetBulkModal);

  // Import selected
  $("#bulkImportBtn").addEventListener("click", () => {
    const toImport = bulkParsed.filter((r) => r.selected);
    if (toImport.length === 0) { alert("Select at least one business to import."); return; }
    if (!confirm("Import " + fmtBusinessCount(toImport.length) + "?")) return;
    toImport.forEach((rec) => {
      const newBusiness = seedBusiness(rec.name, rec.type, rec.industry, rec.ein, rec.formed || null);
      newBusiness.classification = rec.classification;
      state.businesses.push(newBusiness);
      log("biz", "Bulk imported: " + rec.name + " [" + rec.classification + "]");
    });
    if (!state.activeId && state.businesses[0]) state.activeId = state.businesses[0].id;
    closeModal("modalBulkUpload");
    persist();
  });

  // ---------- end Bulk CSV Upload ----------


  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        state = JSON.parse(e.newValue);
        render();
      } catch { /* ignore */ }
    }
  });

  // First-run bootstrap
  if (state.businesses.length === 0) {
    log("biz", "Dashboard initialized. Click + Business to begin.");
  }
  if (!state.activeId && state.businesses[0]) state.activeId = state.businesses[0].id;
  save();
  render();
  bindAssistantUi();
  renderAssistant();
})();
