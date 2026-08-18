(function () {
  "use strict";

  const API_PATH = "/api/runner-sync";
  const SAVE_DEBOUNCE_MS = 1200;

  const STATUS = {
    CONNECTING: { key: "connecting", text: "Cloud Connecting..." },
    CONNECTED: { key: "connected", text: "Runner Cloud Connected" },
    OFFLINE: { key: "offline", text: "Cloud Offline - Local Cache Active" },
    SYNCING: { key: "syncing", text: "Syncing..." },
    SAVE_FAILED: { key: "save_failed", text: "Cloud Save Failed" },
  };

  let cloudHydrating = false;
  let cloudReady = false;
  let cloudSaving = false;
  let lastCloudHash = null;
  let saveTimer = null;

  function emitStatus(status) {
    window.dispatchEvent(
      new CustomEvent("runner-cloud-status", {
        detail: { key: status.key, text: status.text },
      }),
    );
  }

  function stableHash(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(Date.now());
    }
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function pick(record, keys, fallback) {
    for (const key of keys) {
      if (record && record[key] != null) return record[key];
    }
    return fallback;
  }

  function normalizeStateShape(state) {
    if (!state || !Array.isArray(state.businesses)) return null;
    return state;
  }

  function transformTablePayload(payload) {
    const entities = asArray(payload?.portfolio_entities || payload?.entities);
    if (!entities.length) return null;

    const checklistItems = asArray(payload?.checklist_items);
    const platformAccounts = asArray(payload?.platform_accounts);
    const vendorAccounts = asArray(payload?.vendor_accounts);
    const bankAccounts = asArray(payload?.bank_accounts);
    const creditScores = asArray(payload?.credit_scores);
    const reminders = asArray(payload?.reminders);
    const documents = asArray(payload?.documents);
    const activityLog = asArray(payload?.activity_log);

    const businesses = entities.map((entity) => {
      const entityId = pick(entity, ["id", "entity_id", "portfolio_entity_id"], null);
      const mapEntity = (rows) => rows.filter((row) => pick(row, ["entity_id", "portfolio_entity_id"], null) === entityId);

      const defaultPlatforms = {
        stripe: { id: "", url: "", status: "not_setup" },
        yelp: { id: "", url: "", status: "not_listed" },
        google: { id: "", url: "", status: "not_listed" },
      };

      mapEntity(platformAccounts).forEach((row) => {
        const name = String(pick(row, ["platform", "platform_name", "service"], "")).toLowerCase();
        if (!defaultPlatforms[name]) return;
        defaultPlatforms[name] = {
          id: String(pick(row, ["platform_id", "external_id", "account_id"], "") || ""),
          url: String(pick(row, ["url", "profile_url"], "") || ""),
          status: String(pick(row, ["status"], defaultPlatforms[name].status) || defaultPlatforms[name].status),
        };
      });

      const scoreByBureau = {};
      const history = [];
      mapEntity(creditScores).forEach((row) => {
        const bureau = String(pick(row, ["bureau", "score_type"], "") || "").toLowerCase();
        const value = Number(pick(row, ["score", "value"], NaN));
        if (!Number.isNaN(value)) scoreByBureau[bureau] = value;
        history.push({
          id: String(pick(row, ["id"], "score-" + Math.random().toString(36).slice(2))),
          bureau: bureau || "unknown",
          score: Number.isNaN(value) ? null : value,
          date: pick(row, ["captured_at", "created_at", "date"], null),
          delta: Number(pick(row, ["delta", "change"], 0)) || 0,
        });
      });

      return {
        id: String(entityId || "entity-" + Math.random().toString(36).slice(2)),
        name: String(pick(entity, ["name", "legal_name", "display_name"], "Untitled Business")),
        type: String(pick(entity, ["entity_type", "type"], "")),
        industry: String(pick(entity, ["industry"], "")),
        ein: String(pick(entity, ["ein"], "")),
        formed: pick(entity, ["formed_at", "formation_date", "created_at"], null),
        createdAt: Number(new Date(pick(entity, ["created_at"], Date.now())).getTime() || Date.now()),
        checklist: mapEntity(checklistItems).map((row) => ({
          id: String(pick(row, ["id"], "chk-" + Math.random().toString(36).slice(2))),
          label: String(pick(row, ["label", "title", "item"], "Checklist Item")),
          done: Boolean(pick(row, ["done", "is_done", "completed"], false)),
        })),
        net30: mapEntity(vendorAccounts).map((row) => ({
          id: String(pick(row, ["id"], "ven-" + Math.random().toString(36).slice(2))),
          vendor: String(pick(row, ["vendor_name", "name"], "")),
          status: String(pick(row, ["status"], "pending")),
          creditLimit: Number(pick(row, ["credit_limit"], 0)) || 0,
          balance: Number(pick(row, ["balance"], 0)) || 0,
          reportsTo: asArray(pick(row, ["reports_to", "bureaus"], [])),
          opened: pick(row, ["opened_on", "opened_at"], null),
        })),
        bank: mapEntity(bankAccounts).map((row) => ({
          id: String(pick(row, ["id"], "bank-" + Math.random().toString(36).slice(2))),
          institution: String(pick(row, ["institution", "bank_name"], "")),
          accountName: String(pick(row, ["account_name", "nickname"], "")),
          type: String(pick(row, ["type"], "checking")),
          balance: Number(pick(row, ["balance"], 0)) || 0,
          availableCredit: Number(pick(row, ["available_credit"], 0)) || 0,
          status: String(pick(row, ["status"], "active")),
        })),
        credit: {
          db: Number(scoreByBureau.db ?? scoreByBureau.paydex ?? null),
          exp: Number(scoreByBureau.experian ?? null),
          eq: Number(scoreByBureau.equifax ?? null),
          fico: Number(scoreByBureau.fico ?? scoreByBureau.sbss ?? null),
          updatedAt: history[0]?.date || null,
          history,
        },
        reminders: mapEntity(reminders).map((row) => ({
          id: String(pick(row, ["id"], "rem-" + Math.random().toString(36).slice(2))),
          title: String(pick(row, ["title", "name"], "Reminder")),
          due: pick(row, ["due_date", "due_at"], null),
          category: String(pick(row, ["category"], "Other")),
          done: Boolean(pick(row, ["done", "is_done"], false)),
        })),
        platforms: defaultPlatforms,
        gov: {
          sam: {
            uei: String(pick(entity, ["uei"], "")),
            cageCode: String(pick(entity, ["cage_code"], "")),
            status: String(pick(entity, ["sam_status"], "not_registered")),
            expirationDate: pick(entity, ["sam_expiration_date"], null),
          },
          sbaCerts: [],
        },
        verificationDocs: mapEntity(documents).map((row) => ({
          id: String(pick(row, ["id"], "doc-" + Math.random().toString(36).slice(2))),
          name: String(pick(row, ["name", "file_name"], "Document")),
          mimeType: String(pick(row, ["mime_type", "content_type"], "application/octet-stream")),
          sourceRef: String(pick(row, ["storage_path", "source_record_id"], "")),
          uploadedAt: pick(row, ["created_at", "uploaded_at"], null),
        })),
        apiConfigs: [],
      };
    });

    return {
      businesses,
      activeId: businesses[0]?.id || null,
      activity: activityLog.map((row) => ({
        id: String(pick(row, ["id"], "act-" + Math.random().toString(36).slice(2))),
        category: String(pick(row, ["category", "type"], "activity")),
        msg: String(pick(row, ["message", "description"], "")),
        ts: Number(new Date(pick(row, ["created_at", "timestamp"], Date.now())).getTime() || Date.now()),
      })),
    };
  }

  function extractState(payload) {
    const direct = normalizeStateShape(payload?.state || payload?.dashboardState || payload?.data?.state || payload?.data?.dashboardState);
    if (direct) return direct;

    const tables = payload?.tables || payload?.data?.tables || payload?.data || payload;
    return transformTablePayload(tables);
  }

  async function post(op, body) {
    const res = await fetch(API_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ op, ...body }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Cloud request failed");
    return json;
  }

  async function hydrate(localState) {
    cloudHydrating = true;
    emitStatus(STATUS.CONNECTING);

    try {
      const payload = await post("load", {});
      const cloudState = extractState(payload);
      if (cloudState && Array.isArray(cloudState.businesses)) {
        lastCloudHash = stableHash(cloudState);
        cloudReady = true;
        emitStatus(STATUS.CONNECTED);
        return { state: cloudState, source: "cloud" };
      }
      cloudReady = true;
      emitStatus(STATUS.OFFLINE);
      return { state: localState, source: "local" };
    } catch {
      cloudReady = false;
      emitStatus(STATUS.OFFLINE);
      return { state: localState, source: "local" };
    } finally {
      cloudHydrating = false;
    }
  }

  async function saveNow(state) {
    if (cloudHydrating || cloudSaving || !cloudReady) return;

    const hash = stableHash(state);
    if (hash === lastCloudHash) return;

    cloudSaving = true;
    emitStatus(STATUS.SYNCING);
    try {
      await post("save", { state });
      lastCloudHash = hash;
      emitStatus(STATUS.CONNECTED);
    } catch {
      emitStatus(STATUS.SAVE_FAILED);
    } finally {
      cloudSaving = false;
    }
  }

  function queueSave(state) {
    if (cloudHydrating || !cloudReady) return;

    if (saveTimer) clearTimeout(saveTimer);
    const snapshot = JSON.parse(JSON.stringify(state));
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow(snapshot);
    }, SAVE_DEBOUNCE_MS);
  }

  window.RunnerCloudSync = {
    hydrate,
    queueSave,
    flags() {
      return {
        cloudHydrating,
        cloudReady,
        cloudSaving,
      };
    },
  };
})();
