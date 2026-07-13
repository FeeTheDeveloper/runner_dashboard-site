/* Agent Assistant for the Business Status Dashboard
 *
 * Two personalities in one:
 *   1. LOCAL — a rules engine that inspects state and emits ranked
 *      recommendations plus a "best plays" playbook. No network. Free.
 *   2. CLAUDE — direct browser call to the Anthropic Messages API using
 *      a user-supplied key. The dashboard state is packaged as a JSON
 *      system-block so replies stay grounded in the actual data.
 *
 * The dashboard uses `window.BizAgent` to invoke both.
 */
(function () {
  "use strict";

  const API_KEY_STORAGE = "biz-agent-api-key-v1";
  const CHAT_STORAGE    = "biz-agent-chat-v1";
  const MODEL_STORAGE   = "biz-agent-model-v1";

  // ---------- Plays library ----------
  // Each play has: id, tier, title, desc, done(b) — a predicate that
  // decides whether this play has been completed for the active business.
  const PLAYS = [
    // Tier 1 — Foundation
    { id: "ein",       tier: "foundation", title: "Register EIN",
      desc: "IRS EIN — required for every downstream account.",
      done: (b) => !!(b.ein && b.ein.trim()) },
    { id: "duns",      tier: "foundation", title: "Get DUNS Number",
      desc: "Free from D&B; unlocks the PAYDEX credit file.",
      done: (b) => !!(b.duns && b.duns.trim()) || b.dunsStatus === "issued" },
    { id: "address",   tier: "foundation", title: "Verify business address",
      desc: "Real physical address (not a PO box). Bureaus verify it.",
      done: (b) => (b.checklist || []).some((i) => /address/i.test(i.label) && i.done) },
    { id: "phone",     tier: "foundation", title: "List a business phone (411)",
      desc: "Directory-listed business line — required by many creditors.",
      done: (b) => (b.checklist || []).some((i) => /phone|411/i.test(i.label) && i.done) },
    { id: "bank",      tier: "foundation", title: "Open a business bank account",
      desc: "Mercury, Chase, Novo, Bluevine — pick one and route income through it.",
      done: (b) => (b.bank || []).some((a) => a.type === "checking" && a.status === "active") },
    { id: "web",       tier: "foundation", title: "Website + professional email",
      desc: "Domain email at your business address. Lenders check.",
      done: (b) => (b.checklist || []).some((i) => /website|email/i.test(i.label) && i.done) },

    // Tier 2 — Starter Net 30 (the classic credit-building vendors)
    { id: "uline",     tier: "starter", title: "Open Net 30 with Uline",
      desc: "Reports to D&B; approves early with just EIN + DUNS.",
      done: (b) => hasVendor(b, /uline/i) },
    { id: "grainger",  tier: "starter", title: "Open Net 30 with Grainger",
      desc: "Reports to D&B; industrial supplies. Easy early approval.",
      done: (b) => hasVendor(b, /grainger/i) },
    { id: "quill",     tier: "starter", title: "Open Net 30 with Quill",
      desc: "Reports to D&B; office supplies. Often first credit line issued.",
      done: (b) => hasVendor(b, /quill/i) },
    { id: "summa",     tier: "starter", title: "Open Net 30 with Summa Office Supplies",
      desc: "Reports to D&B and Equifax Business. Fast approval.",
      done: (b) => hasVendor(b, /summa/i) },
    { id: "crown",     tier: "starter", title: "Open Net 30 with Crown Office Supplies",
      desc: "Reports to D&B, Equifax, and CreditSafe.",
      done: (b) => hasVendor(b, /crown/i) },

    // Tier 3 — Store credit
    { id: "amazon-biz",  tier: "store", title: "Amazon Business Pay-in-Full",
      desc: "Reports to D&B once seasoned. Order early, pay early.",
      done: (b) => hasVendor(b, /amazon/i) },
    { id: "home-depot",  tier: "store", title: "Home Depot Commercial Revolving",
      desc: "Reports to Experian Business & D&B.",
      done: (b) => hasVendor(b, /home\s?depot/i) },
    { id: "lowes",       tier: "store", title: "Lowe's Business Advantage",
      desc: "Reports to D&B and Experian Business.",
      done: (b) => hasVendor(b, /lowe/i) },

    // Tier 4 — Fleet cards
    { id: "wex",         tier: "fleet", title: "WEX Fleet card",
      desc: "Reports to D&B and Experian Business.",
      done: (b) => hasVendor(b, /wex/i) },
    { id: "fuelman",     tier: "fleet", title: "Fuelman fleet card",
      desc: "Reports to D&B, Experian, Equifax.",
      done: (b) => hasVendor(b, /fuelman/i) },

    // Tier 5 — Bank credit
    { id: "biz-cc",      tier: "bank", title: "First business credit card",
      desc: "Chase Ink, Amex Blue Business, or Cap One Spark once EIN-seasoned.",
      done: (b) => (b.bank || []).some((a) => a.type === "credit" && a.status === "active") },
    { id: "loc",         tier: "bank", title: "Line of credit or SBA loan",
      desc: "Bluevine, Fundbox, or your primary bank. Requires 6+ months of deposits.",
      done: (b) => (b.bank || []).some((a) => (a.type === "loc" || a.type === "loan") && a.status === "active") },

    // Tier 6 — Scale
    { id: "monitor",     tier: "scale", title: "Enroll in monitoring (NAV / My D&B)",
      desc: "Watch scores + report errors. Bureaus won't fix what you don't dispute.",
      done: (b) => ["dnb","nav"].some((k) => b.integrations && b.integrations[k] && b.integrations[k].status === "verified") },
    { id: "paydex-80",   tier: "scale", title: "Hit PAYDEX 80 (pay early on 3+ tradelines)",
      desc: "Pay each Net 30 vendor within 20 days for 3 months.",
      done: (b) => typeof b.credit.db === "number" && b.credit.db >= 80 },
    { id: "sbss-160",    tier: "scale", title: "Reach FICO SBSS 160+",
      desc: "Threshold for SBA-backed loans and premium bank lines.",
      done: (b) => typeof b.credit.fico === "number" && b.credit.fico >= 160 },
  ];

  const TIER_LABEL = {
    foundation: "1 · Found.",
    starter:    "2 · Starter",
    store:      "3 · Store",
    fleet:      "4 · Fleet",
    bank:       "5 · Bank",
    scale:      "6 · Scale",
  };

  function hasVendor(b, rx) {
    return (b.net30 || []).some((n) => rx.test(n.vendor || "") &&
      (n.status === "approved" || n.status === "pending"));
  }

  // ---------- Recommendation engine ----------
  // Returns a list ordered high → low with { id, priority, title, reason,
  // action?: { label, route?, focus? } }.
  function recommendations(state) {
    const b = state.businesses.find((x) => x.id === state.activeId);
    const recs = [];

    if (!b) {
      recs.push({
        id: "add-business", priority: "high",
        title: "Add your first business",
        reason: "The dashboard needs at least one business to track.",
        action: { label: "Open the Add Business form", focus: "addBusinessBtn" },
      });
      return recs;
    }

    // Foundation gaps
    if (!b.ein) {
      recs.push({ id: "ein", priority: "high",
        title: "Get an EIN",
        reason: "Every credit account, bank, and vendor requires the EIN.",
        action: { label: "Apply at irs.gov/EIN", link: "https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online" } });
    }
    if (!b.duns || b.dunsStatus === "none") {
      recs.push({ id: "duns", priority: "high",
        title: "Request a DUNS number (free)",
        reason: "DUNS opens the D&B PAYDEX file. Without it, half of the vendor plays won't approve.",
        action: { label: "Start DUNS request", link: "https://www.dnb.com/duns/get-a-duns.html" } });
    }
    if (b.dunsStatus === "requested" || b.dunsStatus === "pending") {
      recs.push({ id: "duns-check", priority: "med",
        title: "Check DUNS request status",
        reason: "You marked DUNS as " + b.dunsStatus + ". D&B usually turns it around in 5 business days.",
        action: { label: "Update integration status", focus: "integrationGrid" } });
    }

    // Bank
    const hasChecking = (b.bank || []).some((a) => a.type === "checking" && a.status === "active");
    if (!hasChecking) {
      recs.push({ id: "open-bank", priority: "high",
        title: "Open a business checking account",
        reason: "You have no active business checking. Mercury, Bluevine, and Novo have no monthly fees.",
        action: { label: "Add a bank account", focus: "addBankBtn" } });
    }
    const mercury = b.integrations && b.integrations.mercury;
    if (mercury && mercury.status === "not_started") {
      recs.push({ id: "link-mercury", priority: "med",
        title: "Link Mercury Bank",
        reason: "Mercury has a public API and MCP connector; linking enables auto-refreshed balances.",
        action: { label: "Update Mercury integration", focus: "integrationGrid" } });
    }
    const cash = (b.bank || [])
      .filter((a) => a.type === "checking" || a.type === "savings")
      .reduce((n, a) => n + Number(a.balance || 0), 0);
    if (hasChecking && cash < 1000) {
      recs.push({ id: "fund-bank", priority: "med",
        title: "Fund the business account",
        reason: "Cash of " + fmtMoney(cash) + " is thin. Most Net 30 vendors and bank cards look for consistent 4-figure balances.",
      });
    }

    // Net 30
    const n30 = b.net30 || [];
    const approved = n30.filter((n) => n.status === "approved").length;
    if (approved < 3) {
      recs.push({ id: "more-net30", priority: "high",
        title: "Open " + (3 - approved) + " more Net 30 tradeline" + ((3 - approved) === 1 ? "" : "s"),
        reason: "PAYDEX scores generate after 3+ tradelines report. You have " + approved + " approved.",
        action: { label: "Add a vendor", focus: "addNet30Btn" } });
    }
    const anyReports = n30.some((n) => n.reports && (n.reports.db || n.reports.exp || n.reports.eq));
    if (n30.length && !anyReports) {
      recs.push({ id: "reporting-vendors", priority: "high",
        title: "None of your Net 30 vendors report to a bureau",
        reason: "Net 30 that doesn't report doesn't build credit. Swap in Uline / Grainger / Quill / Summa / Crown.",
      });
    }
    const pending = n30.filter((n) => n.status === "pending");
    if (pending.length) {
      recs.push({ id: "chase-pending", priority: "med",
        title: "Follow up on " + pending.length + " pending vendor" + (pending.length === 1 ? "" : "s"),
        reason: "Pending: " + pending.map((n) => n.vendor).join(", ") + ". Vendors usually decide inside a week.",
      });
    }

    // Credit
    if (b.credit.db == null && b.credit.exp == null && b.credit.eq == null) {
      recs.push({ id: "pull-scores", priority: "med",
        title: "Pull your first bureau scores",
        reason: "You don't have any scores logged yet. Enroll in NAV or My D&B and log the baseline.",
        action: { label: "Open credit modal", focus: "editCreditBtn" } });
    }
    if (typeof b.credit.db === "number" && b.credit.db < 80 && approved >= 3) {
      recs.push({ id: "paydex-push", priority: "med",
        title: "Push PAYDEX to 80",
        reason: "You're at " + b.credit.db + ". Paying 3+ tradelines 20 days early for 60 days usually lifts it above 80.",
      });
    }

    // Reminders
    const now = Date.now();
    const overdue = (b.reminders || []).filter((r) => new Date(r.due).getTime() < now);
    if (overdue.length) {
      recs.push({ id: "overdue-reminders", priority: "high",
        title: overdue.length + " overdue reminder" + (overdue.length === 1 ? "" : "s"),
        reason: overdue.slice(0, 3).map((r) => r.title).join(" · "),
      });
    }
    const soon = (b.reminders || []).filter((r) => {
      const d = new Date(r.due).getTime();
      return d >= now && (d - now) / 86400000 <= 7;
    });
    if (soon.length) {
      recs.push({ id: "soon-reminders", priority: "med",
        title: soon.length + " reminder" + (soon.length === 1 ? "" : "s") + " due this week",
        reason: soon.slice(0, 3).map((r) => r.title + " (" + r.due + ")").join(" · "),
      });
    }

    // Checklist
    const undone = (b.checklist || []).filter((i) => !i.done);
    if (undone.length && recs.length < 5) {
      recs.push({ id: "next-checklist", priority: "low",
        title: 'Complete "' + undone[0].label + '"',
        reason: "Next unchecked setup item.",
      });
    }

    // If everything above is quiet, nudge the higher-tier plays.
    if (recs.length === 0) {
      const nextPlay = PLAYS.find((p) => !p.done(b));
      if (nextPlay) {
        recs.push({ id: "next-play-" + nextPlay.id, priority: "low",
          title: nextPlay.title, reason: nextPlay.desc });
      } else {
        recs.push({ id: "clean", priority: "low",
          title: "Nothing urgent — keep paying tradelines early",
          reason: "All foundation and starter plays are complete. Focus on cadence: pay 20 days early, log scores monthly." });
      }
    }

    // High-priority first, then med, then low.
    const rank = { high: 0, med: 1, low: 2 };
    recs.sort((a, z) => rank[a.priority] - rank[z.priority]);
    return recs;
  }

  function fmtMoney(n) {
    return "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  // ---------- Playbook helpers ----------
  function playsForBusiness(state, tierFilter) {
    const b = state.businesses.find((x) => x.id === state.activeId);
    return PLAYS
      .filter((p) => !tierFilter || tierFilter === "all" || p.tier === tierFilter)
      .map((p) => ({
        id: p.id, tier: p.tier, tierLabel: TIER_LABEL[p.tier],
        title: p.title, desc: p.desc,
        done: !!b && p.done(b),
      }));
  }

  // ---------- Claude API ----------
  const SYSTEM_PROMPT =
    "You are the assistant inside a business-credit dashboard. You have " +
    "access to the user's live dashboard state as JSON in the next system " +
    "message. Answer concisely (max 4 short paragraphs). When you " +
    "recommend actions, mention specific vendors, bureaus, or dashboard " +
    "fields by name. Never invent scores or numbers not present in the " +
    "state — say 'not tracked yet' instead.";

  function getApiKey() { return localStorage.getItem(API_KEY_STORAGE) || ""; }
  function setApiKey(v) {
    if (v) localStorage.setItem(API_KEY_STORAGE, v);
    else   localStorage.removeItem(API_KEY_STORAGE);
  }
  function getSavedModel() { return localStorage.getItem(MODEL_STORAGE) || "local"; }
  function setSavedModel(v) { localStorage.setItem(MODEL_STORAGE, v); }

  function loadChat() {
    try { return JSON.parse(localStorage.getItem(CHAT_STORAGE) || "[]"); }
    catch { return []; }
  }
  function saveChat(messages) {
    localStorage.setItem(CHAT_STORAGE, JSON.stringify(messages.slice(-40)));
  }

  function stateSnapshot(state) {
    const b = state.businesses.find((x) => x.id === state.activeId);
    if (!b) return { active: null, businessCount: state.businesses.length };
    return {
      active: {
        name: b.name, type: b.type, industry: b.industry, ein: b.ein,
        duns: b.duns, dunsStatus: b.dunsStatus, formed: b.formed,
        checklist: (b.checklist || []).map((i) => ({ label: i.label, done: i.done })),
        net30: (b.net30 || []).map((n) => ({
          vendor: n.vendor, status: n.status, limit: n.limit,
          balance: n.balance, reports: n.reports, opened: n.opened,
        })),
        bank: (b.bank || []).map((a) => ({
          institution: a.institution, accountName: a.accountName,
          type: a.type, balance: a.balance, availableCredit: a.availableCredit,
          status: a.status,
        })),
        credit: b.credit,
        reminders: b.reminders || [],
        integrations: b.integrations || {},
      },
      businessCount: state.businesses.length,
    };
  }

  async function askLocal(question, state) {
    const q = question.toLowerCase();
    const recs = recommendations(state);
    const b = state.businesses.find((x) => x.id === state.activeId);

    if (!b) return "Add a business first. The Add Business button is in the top bar.";

    if (/next|what.*(should|do)|start|priority/.test(q)) {
      const top = recs.slice(0, 3)
        .map((r, i) => (i + 1) + ". [" + r.priority.toUpperCase() + "] " + r.title + " — " + r.reason)
        .join("\n");
      return "Top next steps:\n" + top;
    }
    if (/duns/.test(q)) {
      if (b.duns) return "DUNS " + b.duns + " (" + b.dunsStatus + "). Linked to the My D&B integration.";
      return "No DUNS yet. Request one free at dnb.com/duns/get-a-duns.html — usually 5 business days.";
    }
    if (/paydex|d&b|dnb/.test(q)) {
      const s = b.credit.db;
      return s == null
        ? "No PAYDEX score logged yet. Once 3+ vendors that report to D&B are active for a full billing cycle, pull the score and log it via Update Scores."
        : "PAYDEX " + s + ". " + (s >= 80 ? "Strong — protects it by paying early." : "Below 80 — pay every tradeline 20 days before the due date for 60 days.");
    }
    if (/net\s?30|vendor|tradeline/.test(q)) {
      const list = (b.net30 || []).map((n) => "• " + n.vendor + " (" + n.status + ", limit " + fmtMoney(n.limit) + ")").join("\n");
      return list ? "Net 30 accounts:\n" + list : "No Net 30 accounts tracked. Start with Uline, Grainger, Quill, Summa, or Crown.";
    }
    if (/bank|mercury|cash|balance/.test(q)) {
      const list = (b.bank || []).map((a) => "• " + a.institution + " · " + a.accountName + " " + fmtMoney(a.balance)).join("\n");
      return list ? "Bank accounts:\n" + list : "No bank accounts tracked. Open a business checking (Mercury/Bluevine/Novo) and link it.";
    }
    if (/remind|due|deadline|filing/.test(q)) {
      const list = (b.reminders || []).map((r) => "• " + r.title + " on " + r.due).join("\n");
      return list ? "Reminders:\n" + list : "No reminders set.";
    }
    if (/play|playbook|recommend|order|sequence/.test(q)) {
      const nextPlays = PLAYS.filter((p) => !p.done(b)).slice(0, 5)
        .map((p, i) => (i + 1) + ". [" + TIER_LABEL[p.tier] + "] " + p.title + " — " + p.desc)
        .join("\n");
      return "Next plays:\n" + nextPlays;
    }
    // Fallback: dump the top recommendation.
    if (recs[0]) return "Best next step: [" + recs[0].priority.toUpperCase() + "] " + recs[0].title + " — " + recs[0].reason;
    return "Everything looks handled. Keep paying tradelines 20 days early.";
  }

  async function askClaude(question, state, model) {
    const key = getApiKey();
    if (!key) throw new Error("No API key set. Click Set API Key.");
    const snapshot = stateSnapshot(state);
    const body = {
      model,
      max_tokens: 1024,
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        { type: "text", text: "Current dashboard state:\n```json\n" + JSON.stringify(snapshot, null, 2) + "\n```" },
      ],
      messages: [{ role: "user", content: question }],
    };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error("Claude API " + res.status + ": " + text.slice(0, 300));
    }
    const data = await res.json();
    return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim() ||
      "(empty reply)";
  }

  async function ask(question, state, model) {
    if (!model || model === "local") return askLocal(question, state);
    return askClaude(question, state, model);
  }

  // ---------- Public ----------
  window.BizAgent = {
    PLAYS, TIER_LABEL,
    recommendations,
    playsForBusiness,
    ask,
    stateSnapshot,
    getApiKey, setApiKey,
    getSavedModel, setSavedModel,
    loadChat, saveChat,
  };
})();
