(function () {
  'use strict';

  const STORAGE_KEY = 'business-dashboard-v2';
  const ACCESS_SESSION_KEY = 'runner-cloud-access-v1';
  const SYNC_URL = 'https://wjedqgrzuvkhnqctsmnd.supabase.co/functions/v1/runner-sync';
  const nativeSetItem = Storage.prototype.setItem;
  const nativeGetItem = Storage.prototype.getItem;
  let accessKey = '';
  let baselineEntityIds = [];
  let suppressSync = true;
  let saveTimer = null;
  let saving = false;
  let pendingSave = false;

  function loadApp() {
    const script = document.createElement('script');
    script.src = '/app.js';
    script.defer = false;
    script.onload = function () {
      suppressSync = false;
      installCloudBadge();
    };
    script.onerror = function () {
      setBadge('Cloud bootstrap failed', 'error');
    };
    document.body.appendChild(script);
  }

  function setBadge(text, mode) {
    const badge = document.getElementById('runnerCloudBadge');
    if (!badge) return;
    badge.textContent = text;
    badge.dataset.mode = mode || 'ok';
    badge.style.borderColor = mode === 'error' ? '#c63d3d' : mode === 'busy' ? '#b58a24' : '#2f8f62';
  }

  function installCloudBadge() {
    const actions = document.querySelector('.topbar-actions');
    if (!actions || document.getElementById('runnerCloudBadge')) return;
    const badge = document.createElement('span');
    badge.id = 'runnerCloudBadge';
    badge.textContent = accessKey ? 'Cloud synced' : 'Local mode';
    badge.title = accessKey ? 'Runner Dashboard is syncing to Supabase' : 'Cloud sync is not active for this session';
    badge.style.cssText = 'display:inline-flex;align-items:center;border:1px solid #2f8f62;border-radius:999px;padding:6px 10px;font-size:12px;white-space:nowrap;';
    actions.prepend(badge);
  }

  async function cloudRequest(payload) {
    const res = await fetch(SYNC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-runner-key': accessKey,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.error || ('Cloud request failed (' + res.status + ')'));
    return json;
  }

  function groupBy(rows, key) {
    const out = new Map();
    (rows || []).forEach(function (row) {
      const value = row[key];
      if (!out.has(value)) out.set(value, []);
      out.get(value).push(row);
    });
    return out;
  }

  function bureauKey(name) {
    const s = String(name || '').toLowerCase();
    if (s.includes('d&b') || s.includes('paydex')) return 'db';
    if (s.includes('experian')) return 'exp';
    if (s.includes('equifax')) return 'eq';
    if (s.includes('fico') || s.includes('sbss')) return 'fico';
    return s.replace(/[^a-z0-9]+/g, '_');
  }

  function toTimestamp(value) {
    const t = new Date(value || Date.now()).getTime();
    return Number.isFinite(t) ? t : Date.now();
  }

  function normalizeEntity(entity, groups) {
    const checklist = (groups.checklist.get(entity.id) || []).map(function (row) {
      return { id: row.id, label: row.label, done: Boolean(row.done), category: row.category, priority: row.priority };
    });

    const net30 = (groups.vendors.get(entity.id) || []).map(function (row) {
      const reports = Array.isArray(row.reports_to) ? row.reports_to : [];
      return {
        id: row.id,
        vendor: row.vendor_name,
        status: row.status || 'pending',
        limit: row.credit_limit,
        creditLimit: row.credit_limit,
        balance: row.balance,
        opened: row.opened_on,
        reports: {
          db: reports.some(function (x) { return /d&b/i.test(String(x)); }),
          exp: reports.some(function (x) { return /experian/i.test(String(x)); }),
          eq: reports.some(function (x) { return /equifax/i.test(String(x)); }),
        },
      };
    });

    const bank = (groups.banks.get(entity.id) || []).map(function (row) {
      return {
        id: row.id,
        institution: row.institution,
        account: row.nickname || '',
        nickname: row.nickname || '',
        type: row.account_type || 'checking',
        balance: row.balance,
        availableCredit: row.available_credit,
        status: row.status || 'active',
      };
    });

    const credit = { db: null, exp: null, eq: null, fico: null, updatedAt: null, history: [] };
    const scoreRows = (groups.scores.get(entity.id) || []).slice().sort(function (a, b) {
      return String(b.score_date || '').localeCompare(String(a.score_date || ''));
    });
    scoreRows.forEach(function (row) {
      const key = bureauKey(row.bureau);
      credit.history.push({ id: row.id, bureau: key, score: Number(row.score), date: row.score_date });
      if (credit[key] == null) credit[key] = Number(row.score);
      if (!credit.updatedAt || String(row.score_date) > String(credit.updatedAt)) credit.updatedAt = row.score_date;
    });

    const reminders = (groups.reminders.get(entity.id) || []).map(function (row) {
      return {
        id: row.id,
        title: row.title,
        due: row.due_on,
        category: row.category || 'Other',
        notes: row.notes || '',
        done: row.status === 'done',
      };
    });

    const platforms = {
      stripe: { id: '', url: '', status: 'not_setup' },
      yelp: { id: '', url: '', status: 'not_listed' },
      google: { id: '', url: '', status: 'not_listed' },
    };
    (groups.platforms.get(entity.id) || []).forEach(function (row) {
      const key = String(row.platform || '').toLowerCase();
      platforms[key] = { id: row.external_id || '', url: row.url || '', status: row.status || 'not_configured' };
    });

    const verificationDocs = (groups.documents.get(entity.id) || []).map(function (row) {
      return {
        id: row.id,
        category: row.doc_type || 'other',
        name: row.title || row.doc_type || 'Document',
        size: 0,
        mimeType: '',
        uploadedAt: toTimestamp(row.created_at),
        dataUrl: row.url || '#',
        cloud: true,
      };
    });

    const sbaCerts = (groups.codes.get(entity.id) || []).filter(function (row) {
      return row.code_type === 'certification';
    }).map(function (row) {
      return {
        id: row.id,
        type: row.code,
        status: row.status || 'pending',
        certDate: row.effective_on || null,
        expirationDate: row.expires_on || null,
      };
    });

    const apiConfigs = (groups.integrations.get(entity.id) || []).map(function (row) {
      return {
        id: row.id,
        name: row.integration_name,
        service: row.provider,
        apiKey: '',
        environment: row.environment || 'production',
        status: row.status || 'configured',
        notes: row.notes || (row.secret_location ? 'Secret stored in ' + row.secret_location : ''),
      };
    });

    return {
      id: entity.id,
      name: entity.display_name || entity.legal_name,
      type: entity.entity_type || 'Unknown',
      industry: entity.domain || 'General Operations',
      ein: entity.ein || '',
      formed: entity.formed_on || null,
      createdAt: toTimestamp(entity.created_at),
      checklist: checklist,
      net30: net30,
      bank: bank,
      credit: credit,
      reminders: reminders,
      platforms: platforms,
      gov: {
        sam: {
          uei: entity.sam_uei || '',
          cageCode: entity.cage_code || '',
          status: entity.sam_status || 'not_registered',
          expirationDate: entity.sam_expiration || null,
        },
        sbaCerts: sbaCerts,
      },
      verificationDocs: verificationDocs,
      apiConfigs: apiConfigs,
      cloudMeta: {
        verificationLevel: entity.verification_level,
        sourceRef: entity.source_ref,
      },
    };
  }

  function snapshotToState(snapshot) {
    const entities = snapshot.entities || [];
    baselineEntityIds = entities.map(function (e) { return e.id; });
    const groups = {
      checklist: groupBy(snapshot.checklist, 'entity_id'),
      platforms: groupBy(snapshot.platforms, 'entity_id'),
      vendors: groupBy(snapshot.vendors, 'entity_id'),
      banks: groupBy(snapshot.banks, 'entity_id'),
      scores: groupBy(snapshot.scores, 'entity_id'),
      reminders: groupBy(snapshot.reminders, 'entity_id'),
      documents: groupBy(snapshot.documents, 'entity_id'),
      codes: groupBy(snapshot.codes, 'entity_id'),
      integrations: groupBy(snapshot.integrations, 'entity_id'),
    };
    const businesses = entities.map(function (entity) { return normalizeEntity(entity, groups); });
    const previous = JSON.parse(nativeGetItem.call(localStorage, STORAGE_KEY) || 'null');
    const previousActiveId = previous && previous.activeId;
    const activeId = businesses.some(function (b) { return b.id === previousActiveId; })
      ? previousActiveId
      : (businesses[0] ? businesses[0].id : null);
    const activity = (snapshot.activity || []).map(function (row) {
      return {
        id: String(row.id),
        ts: toTimestamp(row.created_at),
        tag: row.action || 'cloud',
        msg: row.detail || row.action || 'Cloud activity',
      };
    });
    return { businesses: businesses, activeId: activeId, activity: activity };
  }

  function queueSave(stateJson) {
    if (!accessKey || suppressSync) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      pushSave(stateJson);
    }, 700);
  }

  async function pushSave(stateJson) {
    if (saving) {
      pendingSave = stateJson;
      return;
    }
    saving = true;
    setBadge('Cloud syncing…', 'busy');
    try {
      const state = JSON.parse(stateJson);
      const result = await cloudRequest({ op: 'save', state: state, baselineEntityIds: baselineEntityIds });
      if (result.entityIdMap) {
        Object.keys(result.entityIdMap).forEach(function (oldId) {
          const newId = result.entityIdMap[oldId];
          if (!baselineEntityIds.includes(newId)) baselineEntityIds.push(newId);
        });
      }
      const warnings = result.warnings || {};
      if (warnings.browserOnlyDocuments || warnings.localApiSecrets) {
        setBadge('Cloud synced*', 'ok');
        const badge = document.getElementById('runnerCloudBadge');
        if (badge) badge.title = 'Cloud synced. Browser-only verification files and raw API keys are intentionally not uploaded.';
      } else {
        setBadge('Cloud synced', 'ok');
      }
    } catch (err) {
      console.error('Runner cloud save failed', err);
      setBadge('Cloud sync error', 'error');
    } finally {
      saving = false;
      if (pendingSave) {
        const next = pendingSave;
        pendingSave = false;
        pushSave(next);
      }
    }
  }

  Storage.prototype.setItem = function (key, value) {
    nativeSetItem.call(this, key, value);
    if (this === localStorage && key === STORAGE_KEY) queueSave(String(value));
  };

  async function boot() {
    accessKey = sessionStorage.getItem(ACCESS_SESSION_KEY) || '';
    if (!accessKey) {
      accessKey = window.prompt('Runner Cloud access key\n\nEnter the private Runner sync key for this session. It will be kept only in sessionStorage.') || '';
      if (accessKey) sessionStorage.setItem(ACCESS_SESSION_KEY, accessKey);
    }

    if (!accessKey) {
      suppressSync = false;
      loadApp();
      return;
    }

    try {
      const snapshot = await cloudRequest({ op: 'load' });
      const state = snapshotToState(snapshot);
      nativeSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(state));
      loadApp();
    } catch (err) {
      console.error('Runner cloud load failed', err);
      sessionStorage.removeItem(ACCESS_SESSION_KEY);
      accessKey = '';
      suppressSync = false;
      loadApp();
      setTimeout(function () {
        installCloudBadge();
        setBadge('Local mode — cloud auth failed', 'error');
      }, 0);
    }
  }

  boot();
})();
