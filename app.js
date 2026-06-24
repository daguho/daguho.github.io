const app = document.querySelector("#app");
const dateFormatter = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });
const state = {
  user: JSON.parse(localStorage.getItem("td_user") || "null"),
  data: null,
  tab: "today",
  childTab: "today",
  selectedChildId: "",
  childCalendarMonth: todayKey().slice(0, 7),
  editingTask: null,
  message: ""
};

const weekdays = [
  ["Domingo", 0],
  ["Lunes", 1],
  ["Martes", 2],
  ["Miercoles", 3],
  ["Jueves", 4],
  ["Viernes", 5],
  ["Sabado", 6]
];

function todayKey() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function tomorrowKey() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se ha podido completar la accion.");
  return payload;
}

async function loadState() {
  state.data = await api("/api/state");
}

function childUsers() {
  return (state.data?.users || []).filter((user) => user.role === "child");
}

function parentUsers() {
  return (state.data?.users || []).filter((user) => user.role === "parent");
}

function userName(id) {
  return (state.data?.users || []).find((user) => user.id === id)?.name || "Usuario";
}

function submissionFor(taskId, childId, date = todayKey()) {
  return (state.data?.submissions || []).find((submission) => submission.taskId === taskId && submission.childId === childId && submission.date === date);
}

function isTaskDue(task, dateKey = todayKey()) {
  if (!task.active) return false;
  const date = new Date(`${dateKey}T12:00:00`);
  const weekday = date.getDay();
  if (task.frequency === "once") return task.dueDate === dateKey;
  const configuredWeekdays = task.weekdays || [];
  if (configuredWeekdays.length > 0) return configuredWeekdays.includes(weekday);
  if (task.frequency === "weekly") return false;
  return true;
}

function statusLabel(submission) {
  if (!submission) return ["Pendiente", ""];
  if (submission.status === "approved") return ["Aprobada", "approved"];
  if (submission.status === "rejected") return ["Rechazada", "rejected"];
  return ["Enviada", "sent"];
}

function frequencyLabel(task) {
  if (task.frequency === "once") return `Puntual ${task.dueDate || ""}`;
  if (task.frequency === "weekly" || (task.weekdays || []).length > 0) {
    const names = weekdays.filter(([, value]) => (task.weekdays || []).includes(value)).map(([name]) => name.slice(0, 3));
    if (names.length === 7) return "Diaria";
    return names.length ? names.join(", ") : "Semanal";
  }
  return "Diaria";
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(date);
}

function shiftMonth(monthKey, delta) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 7);
}

function pointLevels() {
  const levels = state.data?.settings?.pointLevels || [
    { min: 0, color: "#edf2f4" },
    { min: 1, color: "#bde0fe" },
    { min: 3, color: "#e9c46a" },
    { min: 5, color: "#95d5b2" }
  ];
  return [...levels].sort((a, b) => Number(a.min) - Number(b.min));
}

function colorForPoints(points) {
  let selected = pointLevels()[0] || { color: "#edf2f4" };
  for (const level of pointLevels()) {
    if (points >= Number(level.min || 0)) selected = level;
  }
  return selected.color;
}

function render() {
  if (!state.user) return renderLogin();
  if (!state.data) {
    app.innerHTML = `<main class="login-layout"><section class="login-panel"><div class="brand-mark">TD</div><h1>Cargando...</h1></section></main>`;
    return;
  }
  return state.user.role === "parent" ? renderParent() : renderChild();
}

function renderLogin() {
  const users = state.data?.users || [];
  app.innerHTML = `
    <main class="login-layout">
      <section class="login-panel">
        <div class="brand-mark">TD</div>
        <h1>Tareas domesticas</h1>
        <p class="muted">Acceso familiar desde la red de casa.</p>
        <form class="form" id="loginForm">
          <label>Usuario
            <select name="name" autocomplete="username" required>
              ${users.map((user) => `<option value="${escapeHtml(user.name)}">${escapeHtml(user.name)}</option>`).join("")}
            </select>
          </label>
          <label>PIN
            <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required />
          </label>
          <button class="primary" type="submit">Entrar</button>
          <p class="error hidden" id="loginError"></p>
        </form>
      </section>
    </main>
  `;
  document.querySelector("#loginForm").addEventListener("submit", onLogin);
}

function shell(content) {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="avatar" style="background:${escapeHtml(state.user.color)}">${escapeHtml(state.user.name.slice(0, 1).toUpperCase())}</div>
          <div>
            <h1>Tareas domesticas</h1>
            <p>${escapeHtml(state.user.name)} · ${dateFormatter.format(new Date())}</p>
          </div>
        </div>
        <div class="top-actions">
          <button class="ghost" id="refreshButton" type="button">Actualizar</button>
          <button class="secondary" id="logoutButton" type="button">Salir</button>
        </div>
      </header>
      <main class="container">${content}</main>
    </div>
  `;
  document.querySelector("#logoutButton").addEventListener("click", logout);
  document.querySelector("#refreshButton").addEventListener("click", refresh);
}

function renderChild() {
  const tasks = (state.data.tasks || []).filter((task) => task.assignedTo.includes(state.user.id) && isTaskDue(task));
  const tomorrowTasks = (state.data.tasks || []).filter((task) => task.assignedTo.includes(state.user.id) && isTaskDue(task, tomorrowKey()));
  const approved = tasks.filter((task) => submissionFor(task.id, state.user.id)?.status === "approved").length;
  const points = tasks.reduce((sum, task) => {
    const submission = submissionFor(task.id, state.user.id);
    return submission?.status === "approved" ? sum + Number(task.points || 0) : sum;
  }, 0);
  const tabs = [
    ["today", "Hoy"],
    ["tomorrow", "Mañana"],
    ["points", "Puntos"]
  ];

  shell(`
    <nav class="tabs">
      ${tabs.map(([id, label]) => `<button class="tab ${state.childTab === id ? "active" : ""}" data-child-tab="${id}" type="button">${label}</button>`).join("")}
    </nav>
    ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ""}
    ${
      state.childTab === "points"
        ? renderChildCalendar()
        : state.childTab === "tomorrow"
          ? renderTomorrowTasks(tomorrowTasks)
        : `
    <section class="page-title">
      <h2>Hoy tienes ${tasks.length} tarea${tasks.length === 1 ? "" : "s"}</h2>
      <p>${approved} aprobada${approved === 1 ? "" : "s"} · ${points} punto${points === 1 ? "" : "s"}</p>
    </section>
    <section class="grid" style="margin-top:18px">
      ${tasks.length ? tasks.map(renderChildTask).join("") : `<div class="empty">No tienes tareas asignadas para hoy.</div>`}
    </section>
        `
    }
  `);

  document.querySelectorAll("[data-child-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.childTab = button.dataset.childTab;
      state.message = "";
      render();
    });
  });
  document.querySelectorAll("[data-submit-task]").forEach((form) => form.addEventListener("submit", onSubmitTask));
  document.querySelectorAll("[data-child-calendar]").forEach((button) => {
    button.addEventListener("click", () => {
      state.childCalendarMonth = shiftMonth(state.childCalendarMonth, Number(button.dataset.childCalendar));
      render();
    });
  });
}

function renderTomorrowTasks(tasks) {
  const tomorrow = new Date(`${tomorrowKey()}T12:00:00`);
  return `
    <section class="page-title">
      <h2>Mañana tienes ${tasks.length} tarea${tasks.length === 1 ? "" : "s"}</h2>
      <p>${dateFormatter.format(tomorrow)}</p>
    </section>
    <section class="grid" style="margin-top:18px">
      ${tasks.length ? tasks.map(renderTomorrowTask).join("") : `<div class="empty">No tienes tareas asignadas para mañana.</div>`}
    </section>
  `;
}

function renderTomorrowTask(task) {
  return `
    <article class="card task-card">
      <div class="task-head">
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <p class="muted">${escapeHtml(task.description || "Sin descripcion")}</p>
        </div>
        <span class="badge">Mañana</span>
      </div>
      <div class="button-row">
        <span class="badge">${Number(task.points || 0)} puntos</span>
        ${task.requiresPhoto ? `<span class="badge">Foto</span>` : ""}
        <span class="badge">${frequencyLabel(task)}</span>
      </div>
    </article>
  `;
}

function pointsByDayForChild(childId, monthKey) {
  const taskById = new Map((state.data.tasks || []).map((task) => [task.id, task]));
  const totals = {};
  for (const submission of state.data.submissions || []) {
    if (submission.childId !== childId || submission.status !== "approved" || !submission.date.startsWith(monthKey)) continue;
    const task = taskById.get(submission.taskId);
    totals[submission.date] = (totals[submission.date] || 0) + Number(task?.points || 0);
  }
  return totals;
}

function renderChildCalendar() {
  const monthKey = state.childCalendarMonth;
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingBlanks = (firstDay.getDay() + 6) % 7;
  const pointsByDay = pointsByDayForChild(state.user.id, monthKey);
  const cells = [];

  for (let index = 0; index < leadingBlanks; index += 1) {
    cells.push(`<div class="calendar-cell empty-cell"></div>`);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    const points = pointsByDay[dateKey] || 0;
    const isToday = dateKey === todayKey();
    cells.push(`
      <div class="calendar-cell ${isToday ? "today" : ""}" style="background:${escapeHtml(colorForPoints(points))}">
        <span class="calendar-day">${day}</span>
        <strong>${points}</strong>
        <small>punto${points === 1 ? "" : "s"}</small>
      </div>
    `);
  }

  return `
    <section class="calendar-section">
      <div class="calendar-head">
        <div class="page-title">
          <h2>Mis puntos</h2>
          <p>${escapeHtml(monthLabel(monthKey))}</p>
        </div>
        <div class="button-row">
          <button class="ghost calendar-nav" data-child-calendar="-1" type="button" title="Mes anterior">&lsaquo;</button>
          <button class="ghost calendar-nav" data-child-calendar="1" type="button" title="Mes siguiente">&rsaquo;</button>
        </div>
      </div>
      <div class="calendar-weekdays">
        <span>Lun</span><span>Mar</span><span>Mie</span><span>Jue</span><span>Vie</span><span>Sab</span><span>Dom</span>
      </div>
      <div class="calendar-grid">${cells.join("")}</div>
    </section>
  `;
}

function renderChildTask(task) {
  const submission = submissionFor(task.id, state.user.id);
  const [label, className] = statusLabel(submission);
  const disabled = submission?.status === "approved" ? "disabled" : "";
  return `
    <article class="card task-card">
      <div class="task-head">
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <p class="muted">${escapeHtml(task.description || "Sin descripcion")}</p>
        </div>
        <span class="badge ${className}">${label}</span>
      </div>
      <div class="button-row">
        <span class="badge">${Number(task.points || 0)} puntos</span>
        ${task.requiresPhoto ? `<span class="badge">Foto</span>` : ""}
      </div>
      ${
        submission?.photoPath
          ? `<img class="photo-preview" src="${escapeHtml(submission.photoPath)}" alt="Foto enviada" />`
          : submission?.photoExpired
            ? `<div class="empty">La foto ya se borro por antiguedad.</div>`
            : ""
      }
      ${submission?.comment ? `<p class="notice">${escapeHtml(submission.comment)}</p>` : ""}
      <form class="form" data-submit-task="${escapeHtml(task.id)}">
        ${task.requiresPhoto ? `<label>Foto justificativa<input name="photo" type="file" accept="image/*" capture="environment" ${disabled} /></label>` : ""}
        <button class="primary" type="submit" ${disabled}>${submission ? "Volver a enviar" : "Marcar como hecha"}</button>
      </form>
    </article>
  `;
}

function renderParent() {
  const tabs = [
    ["today", "Hoy"],
    ["tasks", "Tareas"],
    ["users", "Usuarios"],
    ["colors", "Colores"]
  ];
  const panel =
    state.tab === "tasks" ? renderTasksAdmin() : state.tab === "users" ? renderUsersAdmin() : state.tab === "colors" ? renderColorsAdmin() : renderTodayAdmin();
  shell(`
    <nav class="tabs">
      ${tabs.map(([id, label]) => `<button class="tab ${state.tab === id ? "active" : ""}" data-tab="${id}" type="button">${label}</button>`).join("")}
    </nav>
    ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ""}
    ${panel}
  `);
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      state.editingTask = null;
      state.message = "";
      render();
    });
  });
  bindParentActions();
}

function renderTodayAdmin() {
  const todaysTasks = (state.data.tasks || []).filter((task) => isTaskDue(task));
  const children = childUsers();
  if (!state.selectedChildId || !children.some((child) => child.id === state.selectedChildId)) {
    state.selectedChildId = children[0]?.id || "";
  }
  const summaries = children.map((child) => {
    const childTasks = todaysTasks.filter((task) => task.assignedTo.includes(child.id));
    const counts = { pending: 0, sent: 0, rejected: 0, approved: 0 };
    for (const task of childTasks) {
      const submission = submissionFor(task.id, child.id);
      if (!submission) counts.pending += 1;
      else if (submission.status === "approved") counts.approved += 1;
      else if (submission.status === "rejected") counts.rejected += 1;
      else counts.sent += 1;
    }
    return { child, counts, total: childTasks.length };
  });
  const selectedChild = children.find((child) => child.id === state.selectedChildId);
  const rows = selectedChild
    ? todaysTasks
        .filter((task) => task.assignedTo.includes(selectedChild.id))
        .map((task) => ({ task, childId: selectedChild.id, submission: submissionFor(task.id, selectedChild.id) }))
    : [];

  return `
    <section class="page-title">
      <h2>Revision de hoy</h2>
      <p>Resumen por niño y revision filtrada.</p>
    </section>
    <section class="summary-grid" style="margin-top:18px">
      ${
        summaries.length
          ? summaries.map(renderChildSummary).join("")
          : `<div class="empty">No hay usuarios de niños configurados.</div>`
      }
    </section>
    ${
      selectedChild
        ? `<section class="page-title child-filter-title">
            <h2>${escapeHtml(selectedChild.name)}</h2>
            <p>${rows.length} tarea${rows.length === 1 ? "" : "s"} prevista${rows.length === 1 ? "" : "s"} para hoy.</p>
          </section>`
        : ""
    }
    <section class="grid" style="margin-top:18px">
      ${rows.length ? rows.map(renderReviewCard).join("") : `<div class="empty">No hay tareas para este niño hoy.</div>`}
    </section>
  `;
}

function renderChildSummary(summary) {
  const active = summary.child.id === state.selectedChildId ? "active" : "";
  return `
    <button class="summary-card ${active}" data-select-child="${escapeHtml(summary.child.id)}" type="button">
      <span class="summary-person">
        <span class="avatar" style="background:${escapeHtml(summary.child.color)}">${escapeHtml(summary.child.name.slice(0, 1).toUpperCase())}</span>
        <span>
          <strong>${escapeHtml(summary.child.name)}</strong>
          <small>${summary.total} tarea${summary.total === 1 ? "" : "s"}</small>
        </span>
      </span>
      <span class="summary-counts">
        <span><strong>${summary.counts.pending}</strong><small>Sin hacer</small></span>
        <span><strong>${summary.counts.sent}</strong><small>Revision</small></span>
        <span><strong>${summary.counts.rejected}</strong><small>Rechazadas</small></span>
        <span><strong>${summary.counts.approved}</strong><small>Aprobadas</small></span>
      </span>
    </button>
  `;
}

function renderReviewCard(row) {
  const [label, className] = statusLabel(row.submission);
  return `
    <article class="card task-card">
      <div class="task-head">
        <div>
          <h3>${escapeHtml(row.task.title)}</h3>
          <p class="muted">${escapeHtml(userName(row.childId))} · ${frequencyLabel(row.task)}</p>
        </div>
        <span class="badge ${className}">${label}</span>
      </div>
      ${row.submission?.photoPath ? `<img class="photo-preview" src="${escapeHtml(row.submission.photoPath)}" alt="Foto de la tarea" />` : ""}
      ${row.submission?.photoExpired ? `<div class="empty">Foto borrada automaticamente tras 2 dias.</div>` : ""}
      ${
        row.submission
          ? `<form class="form" data-review="${escapeHtml(row.submission.id)}">
              <label>Comentario
                <textarea name="comment" placeholder="Opcional">${escapeHtml(row.submission.comment || "")}</textarea>
              </label>
              <div class="review-actions">
                <button class="primary" name="status" value="approved" type="submit">Aprobar</button>
                <button class="danger" name="status" value="rejected" type="submit">Rechazar</button>
              </div>
            </form>`
          : `<p class="muted">Todavia no enviada.</p>`
      }
    </article>
  `;
}

function renderTasksAdmin() {
  return `
    <section class="two-col">
      <div>
        <div class="page-title">
          <h2>Tareas</h2>
          <p>Crea tareas diarias, semanales o puntuales para cada niño.</p>
        </div>
        <div class="mini-list" style="margin-top:18px">
          ${(state.data.tasks || []).map(renderTaskRow).join("") || `<div class="empty">Aun no hay tareas.</div>`}
        </div>
      </div>
      ${renderTaskForm()}
    </section>
  `;
}

function renderTaskRow(task) {
  const names = task.assignedTo.map(userName).join(", ") || "Sin asignar";
  return `
    <article class="card">
      <div class="task-head">
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <p class="muted">${escapeHtml(names)} · ${frequencyLabel(task)} · ${Number(task.points || 0)} puntos</p>
        </div>
        <span class="badge">${task.active ? "Activa" : "Pausada"}</span>
      </div>
      <p>${escapeHtml(task.description || "")}</p>
      <div class="task-actions">
        <button class="secondary" data-edit-task="${escapeHtml(task.id)}" type="button">Editar</button>
        <button class="ghost" data-duplicate-task="${escapeHtml(task.id)}" type="button">Duplicar</button>
        <button class="danger" data-delete-task="${escapeHtml(task.id)}" type="button">Borrar</button>
      </div>
    </article>
  `;
}

function renderTaskForm() {
  const task = state.editingTask || {
    title: "",
    description: "",
    frequency: "daily",
    dueDate: todayKey(),
    weekdays: weekdays.map(([, value]) => value),
    assignedTo: childUsers().map((user) => user.id),
    points: 1,
    requiresPhoto: false,
    active: true
  };
  return `
    <aside class="card">
      <h3>${state.editingTask ? "Editar tarea" : "Nueva tarea"}</h3>
      <form class="form" id="taskForm">
        <input name="id" type="hidden" value="${escapeHtml(task.id || "")}" />
        <label>Titulo<input name="title" value="${escapeHtml(task.title)}" required /></label>
        <label>Descripcion<textarea name="description">${escapeHtml(task.description)}</textarea></label>
        <label>Frecuencia
          <select name="frequency">
            <option value="daily" ${task.frequency === "daily" ? "selected" : ""}>Diaria</option>
            <option value="weekly" ${task.frequency === "weekly" ? "selected" : ""}>Semanal</option>
            <option value="once" ${task.frequency === "once" ? "selected" : ""}>Puntual</option>
          </select>
        </label>
        <label>Fecha puntual<input name="dueDate" type="date" value="${escapeHtml(task.dueDate || todayKey())}" /></label>
        <div>
          <p class="muted"><strong>Dias de la semana</strong></p>
          <div class="checkbox-grid">
            ${weekdays
              .map(
                ([label, value]) => `
                <label class="check"><input type="checkbox" name="weekdays" value="${value}" ${(task.weekdays || []).includes(value) ? "checked" : ""} />${label}</label>
              `
              )
              .join("")}
          </div>
        </div>
        <div>
          <p class="muted"><strong>Asignar a</strong></p>
          <div class="checkbox-grid">
            ${childUsers()
              .map(
                (child) => `
                <label class="check"><input type="checkbox" name="assignedTo" value="${escapeHtml(child.id)}" ${(task.assignedTo || []).includes(child.id) ? "checked" : ""} />${escapeHtml(child.name)}</label>
              `
              )
              .join("")}
          </div>
        </div>
        <label>Puntos<input name="points" type="number" min="0" step="1" value="${Number(task.points || 0)}" /></label>
        <label class="check"><input name="requiresPhoto" type="checkbox" ${task.requiresPhoto ? "checked" : ""} />Necesita foto</label>
        <label class="check"><input name="active" type="checkbox" ${task.active !== false ? "checked" : ""} />Activa</label>
        <div class="button-row">
          <button class="primary" type="submit">Guardar</button>
          ${state.editingTask ? `<button class="ghost" id="cancelEdit" type="button">Cancelar</button>` : ""}
        </div>
      </form>
    </aside>
  `;
}

function renderUsersAdmin() {
  return `
    <section class="two-col">
      <div>
        <div class="page-title">
          <h2>Usuarios</h2>
          <p>${childUsers().length} niño${childUsers().length === 1 ? "" : "s"} · ${parentUsers().length} adulto${parentUsers().length === 1 ? "" : "s"}</p>
        </div>
        <div class="mini-list" style="margin-top:18px">
          ${(state.data.users || [])
            .map(
              (user) => `
              <article class="card row">
                <div class="brand">
                  <div class="avatar" style="background:${escapeHtml(user.color)}">${escapeHtml(user.name.slice(0, 1).toUpperCase())}</div>
                  <div>
                    <h3>${escapeHtml(user.name)}</h3>
                    <p class="muted">${user.role === "parent" ? "Padre/madre" : "Nino"}</p>
                  </div>
                </div>
                <button class="danger" data-delete-user="${escapeHtml(user.id)}" type="button">Borrar</button>
              </article>
            `
            )
            .join("")}
        </div>
      </div>
      <aside class="card">
        <h3>Nuevo usuario</h3>
        <form class="form" id="userForm">
          <label>Nombre<input name="name" required /></label>
          <label>PIN<input name="pin" inputmode="numeric" required /></label>
          <label>Tipo
            <select name="role">
              <option value="child">Nino</option>
              <option value="parent">Padre/madre</option>
            </select>
          </label>
          <label>Color<input name="color" type="color" value="#2a9d8f" /></label>
          <button class="primary" type="submit">Crear usuario</button>
        </form>
      </aside>
    </section>
  `;
}

function renderColorsAdmin() {
  return `
    <section class="two-col">
      <div>
        <div class="page-title">
          <h2>Colores</h2>
          <p>Estos niveles colorean cada dia del calendario de puntos.</p>
        </div>
        <div class="level-preview" style="margin-top:18px">
          ${pointLevels()
            .map(
              (level) => `
              <div class="level-chip" style="background:${escapeHtml(level.color)}">
                <strong>${Number(level.min || 0)}+</strong>
                <span>puntos</span>
              </div>
            `
            )
            .join("")}
        </div>
      </div>
      <aside class="card">
        <h3>Niveles de puntos</h3>
        <form class="form" id="colorsForm">
          <div class="mini-list" id="levelRows">
            ${pointLevels().map(renderLevelRow).join("")}
          </div>
          <div class="button-row">
            <button class="ghost" id="addLevel" type="button">Anadir nivel</button>
            <button class="primary" type="submit">Guardar</button>
          </div>
        </form>
      </aside>
    </section>
  `;
}

function renderLevelRow(level) {
  return `
    <div class="level-row">
      <label>Desde
        <input name="levelMin" type="number" min="0" step="1" value="${Number(level.min || 0)}" />
      </label>
      <label>Color
        <input name="levelColor" type="color" value="${escapeHtml(level.color || "#edf2f4")}" />
      </label>
      <button class="danger" data-remove-level type="button">Borrar</button>
    </div>
  `;
}

function bindParentActions() {
  document.querySelector("#taskForm")?.addEventListener("submit", onSaveTask);
  document.querySelector("#userForm")?.addEventListener("submit", onSaveUser);
  document.querySelector("#colorsForm")?.addEventListener("submit", onSaveColors);
  document.querySelector("#addLevel")?.addEventListener("click", onAddLevel);
  document.querySelectorAll("[data-remove-level]").forEach((button) => button.addEventListener("click", onRemoveLevel));
  document.querySelector("#cancelEdit")?.addEventListener("click", () => {
    state.editingTask = null;
    render();
  });
  document.querySelectorAll("[data-select-child]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedChildId = button.dataset.selectChild;
      state.message = "";
      render();
    });
  });
  document.querySelectorAll("[data-edit-task]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingTask = state.data.tasks.find((task) => task.id === button.dataset.editTask);
      render();
    });
  });
  document.querySelectorAll("[data-duplicate-task]").forEach((button) => button.addEventListener("click", onDuplicateTask));
  document.querySelectorAll("[data-delete-task]").forEach((button) => button.addEventListener("click", onDeleteTask));
  document.querySelectorAll("[data-delete-user]").forEach((button) => button.addEventListener("click", onDeleteUser));
  document.querySelectorAll("[data-review]").forEach((form) => form.addEventListener("submit", onReview));
}

async function onLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const error = document.querySelector("#loginError");
  try {
    const { user } = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), pin: form.get("pin") })
    });
    state.user = user;
    localStorage.setItem("td_user", JSON.stringify(user));
    await loadState();
    render();
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove("hidden");
  }
}

async function onSubmitTask(event) {
  event.preventDefault();
  const taskId = event.currentTarget.dataset.submitTask;
  const file = event.currentTarget.elements.photo?.files?.[0];
  const photoData = file ? await resizeImage(file) : "";
  try {
    await api("/api/submissions", {
      method: "POST",
      body: JSON.stringify({ userId: state.user.id, taskId, date: todayKey(), photoData })
    });
    state.message = "Tarea enviada para revision.";
    await refresh(false);
  } catch (err) {
    state.message = err.message;
    render();
  }
}

async function onSaveTask(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const task = {
    id: form.get("id") || undefined,
    title: form.get("title"),
    description: form.get("description"),
    frequency: form.get("frequency"),
    dueDate: form.get("dueDate"),
    weekdays: form.getAll("weekdays").map(Number),
    assignedTo: form.getAll("assignedTo"),
    points: Number(form.get("points") || 0),
    requiresPhoto: form.get("requiresPhoto") === "on",
    active: form.get("active") === "on",
    userId: state.user.id
  };
  await api("/api/tasks", { method: "POST", body: JSON.stringify(task) });
  state.editingTask = null;
  state.message = "Tarea guardada.";
  await refresh(false);
}

async function onDeleteTask(event) {
  const taskId = event.currentTarget.dataset.deleteTask;
  if (!confirm("Borrar esta tarea y sus registros?")) return;
  await api(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    body: JSON.stringify({ userId: state.user.id })
  });
  state.message = "Tarea borrada.";
  await refresh(false);
}

async function onDuplicateTask(event) {
  const taskId = event.currentTarget.dataset.duplicateTask;
  const task = state.data.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const copy = {
    ...task,
    id: undefined,
    userId: state.user.id,
    title: `${task.title} copia`,
    assignedTo: [...(task.assignedTo || [])],
    weekdays: [...(task.weekdays || [])],
    createdAt: undefined
  };
  const result = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify(copy)
  });
  state.tab = "tasks";
  state.message = "Tarea duplicada. Puedes editar la copia.";
  await loadState();
  state.editingTask = state.data.tasks.find((item) => item.id === result.task.id) || result.task;
  render();
}

async function onDeleteUser(event) {
  const userId = event.currentTarget.dataset.deleteUser;
  const user = state.data.users.find((item) => item.id === userId);
  if (!user) return;
  if (!confirm(`Borrar el usuario ${user.name}?`)) return;
  try {
    await api(`/api/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      body: JSON.stringify({ userId: state.user.id })
    });
    if (state.user.id === userId) {
      logout();
      return;
    }
    state.message = "Usuario borrado.";
    await refresh(false);
  } catch (err) {
    state.message = err.message;
    render();
  }
}

async function onReview(event) {
  event.preventDefault();
  const submitter = event.submitter;
  const form = new FormData(event.currentTarget);
  await api(`/api/submissions/${encodeURIComponent(event.currentTarget.dataset.review)}`, {
    method: "POST",
    body: JSON.stringify({
      userId: state.user.id,
      status: submitter.value,
      comment: form.get("comment")
    })
  });
  state.message = submitter.value === "approved" ? "Tarea aprobada." : "Tarea rechazada.";
  await refresh(false);
}

async function onSaveUser(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/users", {
    method: "POST",
    body: JSON.stringify({
      userId: state.user.id,
      name: form.get("name"),
      pin: form.get("pin"),
      role: form.get("role"),
      color: form.get("color")
    })
  });
  state.message = "Usuario creado.";
  await refresh(false);
}

function onAddLevel() {
  const rows = document.querySelector("#levelRows");
  rows.insertAdjacentHTML("beforeend", renderLevelRow({ min: 0, color: "#edf2f4" }));
  rows.querySelectorAll("[data-remove-level]").forEach((button) => {
    button.removeEventListener("click", onRemoveLevel);
    button.addEventListener("click", onRemoveLevel);
  });
}

function onRemoveLevel(event) {
  const rows = [...document.querySelectorAll(".level-row")];
  if (rows.length <= 1) {
    state.message = "Debe quedar al menos un nivel.";
    render();
    return;
  }
  event.currentTarget.closest(".level-row").remove();
}

async function onSaveColors(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const mins = form.getAll("levelMin");
  const colors = form.getAll("levelColor");
  const pointLevels = mins.map((min, index) => ({ min: Number(min || 0), color: colors[index] || "#edf2f4" }));
  await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ userId: state.user.id, pointLevels })
  });
  state.message = "Colores guardados.";
  await refresh(false);
}

async function resizeImage(file) {
  const bitmap = await createImageBitmap(file);
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function refresh(clearMessage = true) {
  if (clearMessage) state.message = "";
  await loadState();
  render();
}

function logout() {
  localStorage.removeItem("td_user");
  state.user = null;
  state.data = null;
  state.message = "";
  render();
}

(async function init() {
  try {
    await loadState();
  } catch {
    if (state.user) {
      state.user = null;
      localStorage.removeItem("td_user");
    }
  }
  render();
})();
