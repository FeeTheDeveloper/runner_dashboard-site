/* Integrations layer for Business Status Dashboard
 *
 * Provides two callable methods per external provider:
 *   1. api(...)    — direct REST call to the provider's public API
 *   2. mcp(...)    — call via a Claude Code MCP server tool (name-mapped)
 *
 * The dashboard is a static site, so *direct* API calls from the browser
 * will fail CORS or leak secrets in production. Route requests through
 * your own thin backend or a serverless proxy — the fetch shapes below
 * document exactly what to forward.
 *
 * `window.BizIntegrations` is the public entry point; app.js reads it.
 */
(function () {
  "use strict";

  // ---------- Provider registry ----------
  const PROVIDERS = [
    {
      id: "mercury",
      name: "Mercury Bank",
      kind: "Banking",
      docs: "https://docs.mercury.com/",
      mcpServer: "Mercury",
      description: "Business checking, treasury, and cards.",
    },
    {
      id: "dnb",
      name: "My D&B",
      kind: "Credit Bureau",
      docs: "https://www.dnb.com/apis/",
      mcpServer: null,
      description: "Dun & Bradstreet profile, DUNS number, PAYDEX score.",
    },
    {
      id: "nav",
      name: "NAV",
      kind: "Credit Monitoring",
      docs: "https://www.nav.com/api/",
      mcpServer: null,
      description: "Aggregated business credit + financing options.",
    },
  ];

  // ---------- Endpoints ----------
  const ENDPOINTS = {
    mercury: {
      base: "https://api.mercury.com/api/v1",
      accounts: "/accounts",
      account: (id) => "/account/" + encodeURIComponent(id),
      transactions: (id) => "/account/" + encodeURIComponent(id) + "/transactions",
    },
    dnb: {
      base: "https://plus.dnb.com/v1",
      companyByDuns: (duns) => "/data/duns/" + encodeURIComponent(duns),
      match: "/match/cleanseMatch",
    },
    nav: {
      base: "https://api.nav.com/v1",
      me: "/business/me",
      creditScores: "/business/credit-scores",
      applications: "/business/applications",
    },
  };

  // ---------- Local credential store (browser only) ----------
  // NOTE: browser localStorage is NOT a secure place for real production
  // tokens. This is here so a developer can wire up a proxy quickly.
  const CRED_KEY = "biz-integration-creds-v1";
  function loadCreds() {
    try { return JSON.parse(localStorage.getItem(CRED_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveCreds(creds) {
    localStorage.setItem(CRED_KEY, JSON.stringify(creds));
  }
  function getToken(providerId) {
    const creds = loadCreds();
    return (creds[providerId] && creds[providerId].token) || null;
  }
  function setToken(providerId, token) {
    const creds = loadCreds();
    creds[providerId] = Object.assign({}, creds[providerId], { token });
    saveCreds(creds);
  }

  // ---------- Result envelope ----------
  function ok(data, source) { return { ok: true, data, source, at: Date.now() }; }
  function err(message, source, extra) {
    return Object.assign({ ok: false, error: message, source, at: Date.now() }, extra || {});
  }

  // ---------- Mercury Bank ----------
  const mercury = {
    async api(action, params) {
      const token = getToken("mercury");
      if (!token) return err("No Mercury API token configured", "api", { needsCred: true });
      const map = {
        listAccounts: () => ({ path: ENDPOINTS.mercury.accounts, method: "GET" }),
        getAccount: () => ({ path: ENDPOINTS.mercury.account(params.accountId), method: "GET" }),
        listTransactions: () => ({
          path: ENDPOINTS.mercury.transactions(params.accountId) +
            "?limit=" + encodeURIComponent(params.limit || 50),
          method: "GET",
        }),
      };
      const spec = map[action] && map[action]();
      if (!spec) return err("Unknown Mercury action " + action, "api");
      try {
        const res = await fetch(ENDPOINTS.mercury.base + spec.path, {
          method: spec.method,
          headers: {
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
          },
        });
        if (!res.ok) return err("Mercury API " + res.status + " " + res.statusText, "api");
        return ok(await res.json(), "api");
      } catch (e) {
        return err("Mercury API fetch failed (likely CORS — route via backend proxy)", "api",
          { detail: String(e) });
      }
    },
    async mcp(action, params) {
      // Requires the Mercury MCP server to be authorized in Claude settings.
      // From an interactive Claude Code session these tools appear as
      // `mcp__Mercury__*`. Static-page browsers cannot call MCP directly —
      // this method is a shape for backend/agent callers.
      const toolMap = {
        listAccounts:    "mcp__Mercury__list_accounts",
        getAccount:      "mcp__Mercury__get_account",
        listTransactions:"mcp__Mercury__list_transactions",
      };
      const tool = toolMap[action];
      if (!tool) return err("Unknown Mercury MCP action " + action, "mcp");
      if (typeof window.callMcpTool === "function") {
        try {
          const data = await window.callMcpTool(tool, params);
          return ok(data, "mcp");
        } catch (e) {
          return err("Mercury MCP call failed", "mcp", { detail: String(e) });
        }
      }
      return err(
        "Mercury MCP not reachable from the browser. Authorize the Mercury " +
        "connector in Claude settings, then have your backend/agent call " +
        tool + " on behalf of this dashboard.",
        "mcp",
        { needsAuth: true, tool }
      );
    },
  };

  // ---------- My D&B ----------
  const dnb = {
    async api(action, params) {
      const token = getToken("dnb");
      if (!token) return err("No D&B API token configured", "api", { needsCred: true });
      const map = {
        // D&B requires a two-step OAuth (client_credentials → bearer). The
        // saved token here is assumed to be the resulting bearer.
        lookupByDuns: () => ({ path: ENDPOINTS.dnb.companyByDuns(params.duns), method: "GET" }),
        matchCompany: () => ({
          path: ENDPOINTS.dnb.match + "?" + new URLSearchParams({
            countryISOAlpha2Code: params.country || "US",
            name: params.name || "",
            addressLocality: params.city || "",
            addressRegion: params.region || "",
            postalCode: params.postal || "",
          }).toString(),
          method: "GET",
        }),
      };
      const spec = map[action] && map[action]();
      if (!spec) return err("Unknown D&B action " + action, "api");
      try {
        const res = await fetch(ENDPOINTS.dnb.base + spec.path, {
          method: spec.method,
          headers: {
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
          },
        });
        if (!res.ok) return err("D&B API " + res.status + " " + res.statusText, "api");
        return ok(await res.json(), "api");
      } catch (e) {
        return err("D&B API fetch failed (likely CORS — route via backend proxy)", "api",
          { detail: String(e) });
      }
    },
    async mcp(action, params) {
      // D&B does not have a first-party MCP server in this environment yet.
      // Wrap your backend adapter and expose it as an MCP tool named
      // `dnb.lookupByDuns` / `dnb.matchCompany` to hook this in.
      const toolMap = {
        lookupByDuns: "dnb.lookupByDuns",
        matchCompany: "dnb.matchCompany",
      };
      const tool = toolMap[action];
      if (!tool) return err("Unknown D&B MCP action " + action, "mcp");
      if (typeof window.callMcpTool === "function") {
        try {
          return ok(await window.callMcpTool(tool, params), "mcp");
        } catch (e) {
          return err("D&B MCP call failed", "mcp", { detail: String(e) });
        }
      }
      return err(
        "No D&B MCP server registered. Add one that exposes " + tool +
        " and forward requests to D&B's REST API using your API key.",
        "mcp",
        { needsAuth: true, tool }
      );
    },
  };

  // ---------- NAV ----------
  const nav = {
    async api(action, params) {
      const token = getToken("nav");
      if (!token) return err("No NAV API token configured", "api", { needsCred: true });
      const map = {
        signupStatus:   () => ({ path: ENDPOINTS.nav.me, method: "GET" }),
        creditScores:   () => ({ path: ENDPOINTS.nav.creditScores, method: "GET" }),
        applications:   () => ({ path: ENDPOINTS.nav.applications, method: "GET" }),
      };
      const spec = map[action] && map[action]();
      if (!spec) return err("Unknown NAV action " + action, "api");
      try {
        const res = await fetch(ENDPOINTS.nav.base + spec.path, {
          method: spec.method,
          headers: {
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
          },
        });
        if (!res.ok) return err("NAV API " + res.status + " " + res.statusText, "api");
        return ok(await res.json(), "api");
      } catch (e) {
        return err("NAV API fetch failed (likely CORS — route via backend proxy)", "api",
          { detail: String(e) });
      }
    },
    async mcp(action, params) {
      const toolMap = {
        signupStatus: "nav.signupStatus",
        creditScores: "nav.creditScores",
        applications: "nav.applications",
      };
      const tool = toolMap[action];
      if (!tool) return err("Unknown NAV MCP action " + action, "mcp");
      if (typeof window.callMcpTool === "function") {
        try {
          return ok(await window.callMcpTool(tool, params), "mcp");
        } catch (e) {
          return err("NAV MCP call failed", "mcp", { detail: String(e) });
        }
      }
      return err(
        "No NAV MCP server registered. Add one exposing " + tool +
        " backed by NAV's REST API.", "mcp",
        { needsAuth: true, tool }
      );
    },
  };

  // ---------- Unified probe ----------
  // Returns { provider, source, ok, status, message } for status polling.
  async function probeStatus(providerId, integration) {
    const preferred = integration && integration.preferred === "api" ? "api" : "mcp";
    const providers = { mercury, dnb, nav };
    const prov = providers[providerId];
    if (!prov) return err("Unknown provider " + providerId, "none");
    // Try preferred transport first, then fall back to the other.
    const first = preferred;
    const second = first === "api" ? "mcp" : "api";
    const action = ({
      mercury: "listAccounts",
      dnb: integration && integration.accountId ? "lookupByDuns" : null,
      nav: "signupStatus",
    })[providerId];
    if (!action) return err("No probe action for " + providerId, first);
    const params = providerId === "dnb" ? { duns: (integration || {}).accountId } : {};
    let res = await prov[first](action, params);
    if (!res.ok) {
      const alt = await prov[second](action, params);
      if (alt.ok) return alt;
    }
    return res;
  }

  // ---------- Public surface ----------
  window.BizIntegrations = {
    PROVIDERS,
    ENDPOINTS,
    getToken,
    setToken,
    loadCreds,
    saveCreds,
    mercury,
    dnb,
    nav,
    probeStatus,
  };
})();
