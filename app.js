/* Business Growth Dashboard — live board with per-business folders,
   task checklists, credit tracking, growth monitoring, and activity feed.
   State persists to localStorage and syncs live across open tabs. */

const STORAGE_KEY = "business-dashboard-v1";

const DEFAULT_TASKS = [
  "EIN Number",
  "DUNS Number",
  "Net 30 Accounts Opened",
  "Other Accounts",
];

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* fall through to fresh state */
  }
  return { businesses: [], activities: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function logActivity(message) {
  state.activities.unshift({ message, time: Date.now() });
  state.activities = state.activities.slice(0, 100);
}

/* ---------- Actions ---------- */

function addBusiness(name) {
  const business = {
    id: uid(),
    name,
    collapsed: false,
    creditScore: null,
    monthlyRevenue: null,
    prevRevenue: null,
    tasks: DEFAULT_TASKS.map((label) => ({ id: uid(), label, done: false })),
  };
  state.businesses.push(business);
  logActivity(`Added business "${name}"`);
  saveState();
  render();
}

function removeBusiness(id) {
  const business = state.businesses.find((b) => b.id === id);
  if (!business) return;
  if (!confirm(`Delete "${business.name}" and all its tasks?`)) return;
  state.businesses = state.businesses.filter((b) => b.id !== id);
  logActivity(`Removed business "${business.name}"`);
  saveState();
  render();
}

function toggleTask(businessId, taskId) {
  const business = state.businesses.find((b) => b.id === businessId);
  const task = business && business.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.done = !task.done;
  logActivity(
    `${task.done ? "Completed" : "Reopened"} "${task.label}" for ${business.name}`
  );
  saveState();
  render();
}

function addTask(businessId, label) {
  const business = state.businesses.find((b) => b.id === businessId);
  if (!business || !label.trim()) return;
  business.tasks.push({ id: uid(), label: label.trim(), done: false });
  logActivity(`Added task "${label.trim()}" to ${business.name}`);
  saveState();
  render();
}

function removeTask(businessId, taskId) {
  const business = state.businesses.find((b) => b.id === businessId);
  if (!business) return;
  const task = business.tasks.find((t) => t.id === taskId);
  business.tasks = business.tasks.filter((t) => t.id !== taskId);
  if (task) logActivity(`Removed task "${task.label}" from ${business.name}`);
  saveState();
  render();
}

function updateMetric(businessId, field, value) {
  const business = state.businesses.find((b) => b.id === businessId);
  if (!business) return;
  const num = value === "" ? null : Number(value);
  if (field === "monthlyRevenue" && business.monthlyRevenue !== num) {
    business.prevRevenue = business.monthlyRevenue;
  }
  business[field] = num;
  const labels = {
    creditScore: "credit score",
    monthlyRevenue: "monthly revenue",
  };
  logActivity(`Updated ${labels[field]} for ${business.name}`);
  saveState();
  render();
}

function toggleFolder(businessId) {
  const business = state.businesses.find((b) => b.id === businessId);
  if (!business) return;
  business.collapsed = !business.collapsed;
  saveState();
  render();
}

/* ---------- Rendering ---------- */

function creditColor(score) {
  if (score >= 740) return "var(--green)";
  if (score >= 620) return "var(--amber)";
  return "var(--red)";
}

function formatTime(ts) {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderSummary() {
  const businesses = state.businesses;
  const allTasks = businesses.flatMap((b) => b.tasks);
  const done = allTasks.filter((t) => t.done).length;
  const scores = businesses
    .map((b) => b.creditScore)
    .filter((s) => typeof s === "number");
  const avg = scores.length
    ? Math.round(scores.reduce((a, s) => a + s, 0) / scores.length)
    : 0;

  document.getElementById("stat-businesses").textContent = businesses.length;
  document.getElementById("stat-tasks").textContent = `${done} / ${allTasks.length}`;
  document.getElementById("stat-credit").textContent = avg || "—";
  document.getElementById("stat-activities").textContent = state.activities.length;
}

function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";

  if (!state.businesses.length) {
    const empty = document.createElement("div");
    empty.className = "board-empty";
    empty.textContent = 'No businesses yet. Click "+ Add Business" to create your first folder.';
    board.appendChild(empty);
    return;
  }

  for (const business of state.businesses) {
    board.appendChild(renderFolder(business));
  }
}

function renderFolder(business) {
  const folder = document.createElement("div");
  folder.className = "folder" + (business.collapsed ? " collapsed" : "");

  // Header
  const header = document.createElement("div");
  header.className = "folder-header";
  header.addEventListener("click", () => toggleFolder(business.id));

  const icon = document.createElement("span");
  icon.className = "folder-icon";
  icon.textContent = business.collapsed ? "📁" : "📂";

  const title = document.createElement("h3");
  title.textContent = business.name;

  const doneCount = business.tasks.filter((t) => t.done).length;
  const progress = document.createElement("span");
  progress.className =
    "folder-progress" +
    (business.tasks.length && doneCount === business.tasks.length ? " done" : "");
  progress.textContent = `${doneCount}/${business.tasks.length} ✓`;

  const caret = document.createElement("span");
  caret.className = "caret";
  caret.textContent = "▾";

  header.append(icon, title, progress, caret);

  // Body
  const body = document.createElement("div");
  body.className = "folder-body";

  const taskList = document.createElement("ul");
  taskList.className = "task-list";
  for (const task of business.tasks) {
    taskList.appendChild(renderTask(business, task));
  }

  // Add-task row
  const addRow = document.createElement("div");
  addRow.className = "add-task-row";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Add a task…";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addTask(business.id, input.value);
    }
  });
  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-sm";
  addBtn.textContent = "Add";
  addBtn.addEventListener("click", () => addTask(business.id, input.value));
  addRow.append(input, addBtn);

  // Metrics: credit + growth
  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.append(
    renderCreditMetric(business),
    renderGrowthMetric(business)
  );

  // Footer
  const footer = document.createElement("div");
  footer.className = "folder-footer";
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-sm btn-danger";
  deleteBtn.textContent = "Delete Business";
  deleteBtn.addEventListener("click", () => removeBusiness(business.id));
  footer.appendChild(deleteBtn);

  body.append(taskList, addRow, metrics, footer);
  folder.append(header, body);
  return folder;
}

function renderTask(business, task) {
  const li = document.createElement("li");
  li.className = "task" + (task.done ? " done" : "");
  li.addEventListener("click", () => toggleTask(business.id, task.id));

  const check = document.createElement("span");
  check.className = "check";
  check.textContent = "✓";

  const label = document.createElement("span");
  label.className = "task-label";
  label.textContent = task.label;

  const remove = document.createElement("button");
  remove.className = "task-remove";
  remove.title = "Remove task";
  remove.textContent = "✕";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    removeTask(business.id, task.id);
  });

  li.append(check, label, remove);
  return li;
}

function renderCreditMetric(business) {
  const metric = document.createElement("div");
  metric.className = "metric";

  const label = document.createElement("label");
  label.textContent = "Credit Score";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "300";
  input.max = "850";
  input.placeholder = "300–850";
  input.value = business.creditScore ?? "";
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("change", () =>
    updateMetric(business.id, "creditScore", input.value)
  );

  const bar = document.createElement("div");
  bar.className = "credit-bar";
  const fill = document.createElement("div");
  fill.className = "credit-bar-fill";
  if (typeof business.creditScore === "number") {
    const pct = Math.max(
      0,
      Math.min(100, ((business.creditScore - 300) / 550) * 100)
    );
    fill.style.width = pct + "%";
    fill.style.background = creditColor(business.creditScore);
  }
  bar.appendChild(fill);

  metric.append(label, input, bar);
  return metric;
}

function renderGrowthMetric(business) {
  const metric = document.createElement("div");
  metric.className = "metric";

  const label = document.createElement("label");
  label.textContent = "Monthly Revenue ($)";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.placeholder = "0";
  input.value = business.monthlyRevenue ?? "";
  input.addEventListener("change", () =>
    updateMetric(business.id, "monthlyRevenue", input.value)
  );

  const indicator = document.createElement("div");
  indicator.className = "growth-indicator";
  const cur = business.monthlyRevenue;
  const prev = business.prevRevenue;
  if (typeof cur === "number" && typeof prev === "number" && prev !== 0) {
    const pct = (((cur - prev) / Math.abs(prev)) * 100).toFixed(1);
    if (cur > prev) {
      indicator.className += " growth-up";
      indicator.textContent = `▲ ${pct}% growth`;
    } else if (cur < prev) {
      indicator.className += " growth-down";
      indicator.textContent = `▼ ${pct}%`;
    } else {
      indicator.className += " growth-flat";
      indicator.textContent = "— no change";
    }
  } else {
    indicator.className += " growth-flat";
    indicator.textContent = "— tracking";
  }

  metric.append(label, input, indicator);
  return metric;
}

function renderActivities() {
  const feed = document.getElementById("activity-feed");
  feed.innerHTML = "";

  if (!state.activities.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No activity yet.";
    feed.appendChild(li);
    return;
  }

  for (const activity of state.activities) {
    const li = document.createElement("li");
    const msg = document.createElement("span");
    msg.textContent = activity.message;
    const time = document.createElement("span");
    time.className = "activity-time";
    time.textContent = formatTime(activity.time);
    li.append(msg, time);
    feed.appendChild(li);
  }
}

function render() {
  renderSummary();
  renderBoard();
  renderActivities();
}

/* ---------- Modal wiring ---------- */

const modal = document.getElementById("business-modal");
const nameInput = document.getElementById("business-name-input");

document.getElementById("add-business-btn").addEventListener("click", () => {
  modal.classList.remove("hidden");
  nameInput.value = "";
  nameInput.focus();
});

document.getElementById("cancel-business-btn").addEventListener("click", () => {
  modal.classList.add("hidden");
});

function submitBusiness() {
  const name = nameInput.value.trim();
  if (!name) return;
  addBusiness(name);
  modal.classList.add("hidden");
}

document.getElementById("save-business-btn").addEventListener("click", submitBusiness);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitBusiness();
});
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.add("hidden");
});

/* ---------- Live sync across tabs ---------- */

window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) {
    state = loadState();
    render();
  }
});

render();
