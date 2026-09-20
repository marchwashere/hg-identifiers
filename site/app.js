const invoke = window.__TAURI__?.core?.invoke || ((command, args) => window.FilterWeb.invoke(command, args));
const App = { views: {} };

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function field(label, inner, style = "") {
  const controlId = inner.match(/\bid="([^"]+)"/)?.[1];
  return `<div class="field" style="${style}"><label${controlId ? ` for="${esc(controlId)}"` : ""}>${esc(label)}</label>${inner}</div>`;
}

function statTiles(stats) {
  return `<div class="stats">` + stats.map(([label, value, color]) =>
    `<div class="stat"><div class="value"${color ? ` style="color:${color}"` : ""}>${esc(value)}</div><div class="label">${esc(label)}</div></div>`
  ).join("") + `</div>`;
}

// Both filter overlays share native dialog focus isolation and Escape behavior.
function mountFilterDialog(id, className, title, content, close, subtitle, closeId, closeLabel) {
  const dialog = document.createElement("dialog");
  dialog.id = id;
  dialog.className = "modal-backdrop filter-dialog";
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  dialog.innerHTML = `<div class="modal ${className}">
    <div class="filter-identifier-heading"><div><h3 id="${id}-title">${esc(title)}</h3>${subtitle}</div>
      <button id="${closeId}" autofocus>${esc(closeLabel)}</button></div>
    <div class="modal-body">${content}</div></div>`;
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
      .filter(el => el.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  dialog.querySelector(`#${closeId}`).addEventListener("click", close);
  document.getElementById("modal-root").appendChild(dialog);
  dialog.showModal();
  return dialog;
}

function filterDialogFocus() {
  const active = document.activeElement;
  return {
    dialog: active?.closest("dialog")?.id,
    id: active?.id,
    cueType: active?.dataset.cueType,
    cueValue: active?.dataset.cueValue,
    scroll: [...document.querySelectorAll("dialog .modal-body, dialog .table-scroll, dialog .cue-options")]
      .map(el => [el.closest("dialog").id, el.className, el.dataset.eventOptions, el.scrollTop, el.scrollLeft]),
  };
}

function restoreFilterDialogFocus(previous) {
  const top = [...document.querySelectorAll("dialog[open]")].at(-1);
  if (!top || top.id !== previous.dialog) return;
  for (const [id, className, type, y, x] of previous.scroll) {
    const el = [...(document.getElementById(id)?.querySelectorAll(".modal-body, .table-scroll, .cue-options") || [])]
      .find(el => el.className === className && el.dataset.eventOptions === type);
    if (el) { el.scrollTop = y; el.scrollLeft = x; }
  }
  const target = previous.id ? document.getElementById(previous.id) :
    [...top.querySelectorAll("[data-cue-type]")].find(el => el.dataset.cueType === previous.cueType && el.dataset.cueValue === previous.cueValue);
  if (target && top.contains(target) && !target.disabled && !target.classList.contains("hidden")) target.focus({ preventScroll: true });
}

function gardeniaVisibility() {
  return {
    enemy_exact_hp: false,
    enemy_exact_hp_turns: [],
    enemy_heal_range_species: ["Cherrim"],
    enemy_recoil_hp: false,
    low_roll_detector: {
      move_name: "Pluck",
      species_name: "Turtwig",
      max_hp: 53,
      damage: 28,
      turn: 1,
    },
  };
}

function falknerVisibility() {
  return {
    enemy_exact_hp: false,
    enemy_exact_hp_turns: [1],
    enemy_heal_range_species: [],
    enemy_recoil_hp: false,
    low_roll_detector: null,
  };
}

function genericVisibility() {
  return {
    enemy_exact_hp: false,
    enemy_exact_hp_turns: [],
    enemy_heal_range_species: [],
    enemy_recoil_hp: false,
    low_roll_detector: null,
  };
}

function visibilityPresetName(vis) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (same(vis, gardeniaVisibility())) return "Gardenia route";
  if (same(vis, falknerVisibility())) return "Falkner route";
  if (same(vis, genericVisibility())) return "Generic";
  return "Custom";
}

async function startFilter() {
  const view = App.views.filter;
  const status = document.getElementById("bridge");
  view.choosingDirectory = true;
  view.notice = "Opening seed filter…";
  view.render();
  try {
    const directory = await invoke("initial_filter_directory");
    if (directory) await view.acceptDirectory(directory);
    else view.notice = "Choose the directory containing your Scenario folders to compare cluster win rates.";
    status.textContent = "Ready";
  } catch (error) {
    view.notice = window.FilterWeb
      ? `Could not load hosted datasets: ${String(error)}. Refresh the page to retry.`
      : `Could not open the initial directory: ${String(error)}. Choose a directory to continue.`;
    status.textContent = window.FilterWeb ? "Dataset load failed" : "Choose a directory";
  } finally {
    view.choosingDirectory = false;
    view.render();
  }
}

window.addEventListener("DOMContentLoaded", () => { App.ready = startFilter(); });
window.addEventListener("error", (event) => {
  document.getElementById("bridge").textContent = `Unable to update the filter: ${event.message}`;
});
window.addEventListener("unhandledrejection", (event) => {
  document.getElementById("bridge").textContent = `Unable to complete the action: ${event.reason?.message || event.reason}`;
});
