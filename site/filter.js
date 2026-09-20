/* Interactive seed-data filter. Imported exports already contain observations
   projected through their embedded parser; never filter verbose battle text. */

(function () {
  const cueKey = (values) => JSON.stringify(Array.isArray(values) ? values : []);
  const cueValues = (key) => {
    try { return JSON.parse(key); } catch (_) { return []; }
  };
  const friendlyEventText = (text) => String(text ?? "").replace(/\b(\d+)\s+HP (?:left|after attack)\b/gi, "$1");
  const visibleEventText = (values) => Array.isArray(values) && values.length
    ? values.map(friendlyEventText).join(", ") : "—";
  const cueLabel = (key) => {
    const values = cueValues(key);
    return values.length ? values.map((value) => friendlyEventText(value)).join(", ") : "No additional visible cue";
  };
  const isWin = (fight) => fight?.status === "WIN" || Boolean(fight?.bruteforce);
  const winRateLabel = (wins, total) => `${total ? (wins / total * 100).toFixed(1) : "0.0"}%`;
  const eventLabelMatches = (label, query) =>
    label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

  function clusterLabel(filename) {
    const stem = filename.replace(/\.json$/i, "");
    const match = stem.match(/(?:^|_)(\d+)_(\d+)$/);
    if (!match) return { label: stem, minute: null, second: null };
    const minute = Number(match[1]);
    const second = Number(match[2]);
    return { label: `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`, minute, second };
  }

  function validateDataset(data, name) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`${name}: top level must be an export object.`);
    }
    if (!data.parser || typeof data.parser !== "object") {
      throw new Error(`${name}: no embedded identification parser.`);
    }
    if (!Array.isArray(data.fights)) throw new Error(`${name}: no fights array.`);
    if (data.fights.some((fight) => !Array.isArray(fight?.visible_turns))) {
      throw new Error(`${name}: this export predates parser-approved visible_turns; regenerate it with the current engine.`);
    }
    const maxTurns = data.fights.reduce((max, fight) => Math.max(max, fight.visible_turns.length), 0);
    const cluster = clusterLabel(name);
    return {
      name,
      label: cluster.label,
      minute: cluster.minute,
      second: cluster.second,
      parser: data.parser,
      fights: data.fights,
      maxTurns,
      wins: data.fights.filter(isWin).length,
    };
  }

  function cueAt(fight, turn) {
    const cue = fight.visible_turns?.[turn];
    if (!cue) return null;
    return {
      player: cueKey(cue.player),
      npc: cueKey(cue.npc),
      hp: String(cue.player_end_hp),
    };
  }

  function matchesTurn(fight, turn, filters) {
    if (!filters || !Object.keys(filters).length) return true;
    const cue = cueAt(fight, turn);
    if (!cue) return false;
    return Object.entries(filters).every(([type, value]) => cue[type] === value);
  }

  function filterFights(fights, filters, ignoredTurn = -1) {
    return fights.filter((fight) => filters.every((turnFilters, turn) =>
      turn === ignoredTurn || matchesTurn(fight, turn, turnFilters)
    ));
  }

  function optionsFor(fights, turn) {
    const options = { player: new Set(), npc: new Set(), hp: new Set() };
    for (const fight of fights) {
      const cue = cueAt(fight, turn);
      if (!cue) continue;
      options.player.add(cue.player);
      options.npc.add(cue.npc);
      options.hp.add(cue.hp);
    }
    return options;
  }

  function plannedAction(fight, turn) {
    const normal = Array.isArray(fight.normal_policy_actions) ? fight.normal_policy_actions : [];
    if (turn < normal.length) return normal[turn];
    const route = Array.isArray(fight.bruteforce?.actions) ? fight.bruteforce.actions : [];
    return route[turn - normal.length] ?? null;
  }

  function mostCommonAction(fights, turn) {
    const counts = new Map();
    for (const fight of fights) {
      const action = plannedAction(fight, turn);
      if (action) counts.set(action, (counts.get(action) || 0) + 1);
    }
    let best = null;
    let count = 0;
    for (const [action, occurrences] of counts) {
      if (occurrences > count) { best = action; count = occurrences; }
    }
    return best;
  }

  function sortedOptionValues(type, available, valid) {
    return [...available].sort((a, b) => {
      const validityOrder = Number(valid.has(b)) - Number(valid.has(a));
      if (validityOrder) return validityOrder;
      if (type === "hp") return Number(a) - Number(b);
      return cueLabel(a).localeCompare(cueLabel(b));
    });
  }

  function optionButtons(type, available, valid, selected) {
    const values = sortedOptionValues(type, available, valid);
    if (!values.length) return '<span class="notice">No observations available.</span>';
    return values.map((value) => {
      const label = type === "hp" ? `${value} HP` : cueLabel(value);
      const chosen = selected === value;
      return `<button class="cue-option${chosen ? " selected" : ""}" aria-pressed="${chosen}" data-cue-type="${type}" data-cue-value="${esc(value)}" data-event-label="${esc(label.toLocaleLowerCase())}" ${valid.has(value) ? "" : "disabled"}>${esc(label)}</button>`;
    }).join("");
  }

  const filterView = {
    scenarios: [],
    selectedScenario: -1,
    datasets: [],
    selected: -1,
    filters: [],
    turn: 0,
    eventSearch: { player: "", npc: "", hp: "" },
    directoryPath: "",
    choosingDirectory: false,
    loadingDataset: null,
    loadedDataset: null,
    loadGeneration: 0,
    identificationOpen: false,
    dismissedResultSeed: null,
    candidatesOpen: false,
    candidatePage: 0,
    notice: "Load one or more JSON exports to begin.",

    dataset() { return this.loadedDataset; },

    clearDataset() {
      this.loadGeneration++;
      this.loadingDataset = null;
      this.loadedDataset = null;
      this.selected = -1;
      this.filters = [];
      this.turn = 0;
      this.identificationOpen = false;
      this.dismissedResultSeed = null;
      this.candidatesOpen = false;
      this.candidatePage = 0;
      this.clearEventSearch();
    },

    async parseFiles(files, scenarioForFile) {
      const grouped = new Map();
      const errors = [];
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith(".json")) continue;
        try {
          const scenario = scenarioForFile(file);
          if (!scenario) {
            errors.push(`${file.name}: JSON files directly in the selected root are ignored; place them in a Scenario folder.`);
            continue;
          }
          // Keep only counts and file references in the catalogue. Full battle
          // logs must never travel through the bridge as one directory payload.
          const cluster = clusterLabel(file.name);
          const dataset = {
            name: file.name,
            ...cluster,
            relativePath: file.webkitRelativePath || file.name,
            loadText: () => file.text(),
            wins: file.summary?.wins,
            fightCount: file.summary?.fight_count,
            summaryError: file.summary_error,
          };
          if (!grouped.has(scenario)) grouped.set(scenario, []);
          grouped.get(scenario).push(dataset);
        } catch (error) {
          errors.push(String(error.message || error));
        }
      }
      const sortDatasets = (a, b) => {
        if (a.minute !== null && b.minute !== null) return a.minute - b.minute || a.second - b.second;
        if (a.minute !== null) return -1;
        if (b.minute !== null) return 1;
        return a.label.localeCompare(b.label);
      };
      this.scenarios = [...grouped.entries()]
        .map(([name, datasets]) => ({ name, datasets: datasets.sort(sortDatasets) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this.selectedScenario = -1;
      this.datasets = [];
      this.clearDataset();
      this.notice = errors.length
        ? `${this.scenarios.length} scenario(s) loaded. ${errors.join(" ")}`
        : `${this.scenarios.length} scenario(s) loaded.`;
      if (this.scenarios.length === 1) this.selectScenario(0, false);
      this.render();
    },

    async acceptDirectory(result) {
      this.directoryPath = result.path;
      const entries = result.files || [];
      const files = entries.map((entry) => ({
        name: entry.name,
        webkitRelativePath: entry.relative_path,
        text: () => invoke("read_filter_dataset", { root: result.path, relativePath: entry.relative_path }),
        scenario: entry.scenario,
        summary: entry.summary,
        summary_error: entry.summary_error,
      }));
      await this.parseFiles(files, (file) => file.scenario);
      if (!entries.length) {
        this.notice = "No JSON exports were found below Scenario folders in that directory.";
        this.render();
      }
    },

    async chooseDirectory() {
      if (this.choosingDirectory) return;
      this.choosingDirectory = true;
      const previousNotice = this.notice;
      this.notice = globalThis.FilterWeb ? "Reloading hosted dataset catalogue…" : "Choose a directory. Reading all cluster win rates may take a moment.";
      this.render();
      try {
        const result = await invoke("choose_filter_directory");
        if (!result) {
          this.notice = previousNotice;
          return;
        }
        await this.acceptDirectory(result);
        if (globalThis.FilterWeb) document.getElementById("bridge").textContent = "Ready";
      } catch (error) {
        this.notice = globalThis.FilterWeb
          ? `Could not load hosted datasets: ${String(error)}. Use Reload datasets to retry.`
          : `Could not read directory: ${String(error)}. Choose the directory again to retry.`;
      } finally {
        this.choosingDirectory = false;
        this.render();
      }
    },

    async loadFiles(files) {
      if (this.choosingDirectory || !files.length) return;
      this.choosingDirectory = true;
      this.notice = "Reading cluster win rates…";
      this.render();
      try {
        const catalog = [];
        for (const file of files) {
          const entry = { name: file.name, text: () => file.text() };
          try {
            const dataset = validateDataset(JSON.parse(await file.text()), file.name);
            entry.summary = { wins: dataset.wins, fight_count: dataset.fights.length };
          } catch (error) {
            entry.summary_error = String(error.message || error);
          }
          catalog.push(entry);
        }
        this.directoryPath = "";
        await this.parseFiles(catalog, () => "Selected files");
      } finally {
        this.choosingDirectory = false;
        this.render();
      }
    },

    selectScenario(index, rerender = true) {
      if (this.choosingDirectory && rerender) return;
      this.selectedScenario = index;
      this.datasets = this.scenarios[index]?.datasets || [];
      this.clearDataset();
      this.notice = this.scenarios[index]
        ? `Choose a cluster from ${this.scenarios[index].name}.`
        : this.notice;
      if (rerender) this.render();
    },

    async selectDataset(index) {
      if (this.choosingDirectory || this.loadingDataset === index) return;
      const entry = this.datasets[index];
      if (!entry) return;
      if (this.selected === index && this.loadedDataset) {
        this.identificationOpen = true;
        this.render();
        return;
      }
      this.clearDataset();
      this.selected = index;
      this.loadingDataset = index;
      const generation = this.loadGeneration;
      this.notice = `Loading ${entry.name}…`;
      this.render();
      try {
        const text = await entry.loadText();
        if (generation !== this.loadGeneration) return;
        const dataset = validateDataset(JSON.parse(text), entry.name);
        dataset.relativePath = entry.relativePath;
        this.loadedDataset = dataset;
        // Cache only the tiny summary. Switching away releases the full fight
        // data instead of gradually accumulating every cluster in memory.
        entry.wins = dataset.wins;
        entry.fightCount = dataset.fights.length;
        this.filters = Array.from({ length: dataset.maxTurns }, () => ({}));
        this.clearEventSearch();
        this.identificationOpen = true;
        this.notice = `Filtering ${dataset.name} with its embedded parser.`;
      } catch (error) {
        if (generation !== this.loadGeneration) return;
        this.notice = `Could not load ${entry.name}: ${String(error.message || error)} Select the cluster again to retry.`;
      } finally {
        if (generation === this.loadGeneration) {
          this.loadingDataset = null;
          this.render();
        }
      }
    },

    filtered() {
      const dataset = this.dataset();
      return dataset ? filterFights(dataset.fights, this.filters) : [];
    },

    clearEventSearch() { this.eventSearch = { player: "", npc: "", hp: "" }; },

    changeTurn(turn) {
      this.turn = Math.max(0, Math.min(turn, Math.max(0, (this.dataset()?.maxTurns || 1) - 1)));
      this.clearEventSearch();
      this.render();
    },

    observationsChanged(autoAdvance = false) {
      this.candidatePage = 0;
      if (autoAdvance) {
        const remaining = this.filtered();
        // Advance only a completed observation step, never on load, back,
        // clearing, or a newly visited future turn. Do not infer/store HP.
        const options = optionsFor(remaining, this.turn);
        const exhausted = remaining.length > 1
          && remaining.every(fight => cueAt(fight, this.turn) && cueAt(fight, this.turn + 1))
          && ["player", "npc", "hp"].every(type => options[type].size === 1);
        if (exhausted && this.turn + 1 < this.dataset().maxTurns) {
          this.changeTurn(this.turn + 1);
          document.getElementById("filter-turn-position")?.focus();
          return;
        }
      }
      this.render();
    },

    observedTurns() {
      let observed = -1;
      this.filters.forEach((filter, turn) => { if (Object.keys(filter).length) observed = turn; });
      return observed + 1;
    },

    candidatesButton(id, remaining) {
      return `<button id="${id}" class="${remaining.length === 1 ? "primary" : ""}">${remaining.length === 1 ? "View fight" : `View candidates (${remaining.length})`}</button>`;
    },

    openCandidates() {
      this.candidatesOpen = true;
      this.render();
    },

    cueColumn(type, title, available, valid, selected) {
      const label = type === "hp" ? "Filter HP" : `Filter ${type === "player" ? "player" : "enemy"} events`;
      return `<section><h3>${title}</h3>
        <div class="filter-column-search">
          <label class="sr-only" for="filter-search-${type}">${label}</label>
          <input type="search" id="filter-search-${type}" data-event-search="${type}" value="${esc(this.eventSearch[type])}" placeholder="${label}…" autocomplete="off" />
          <button class="search-clear${this.eventSearch[type] ? "" : " hidden"}" data-search-clear="${type}" aria-label="Clear ${label.toLowerCase()}">×</button>
        </div>
        <div class="cue-options" data-event-options="${type}">${optionButtons(type, available, valid, selected)}<span class="notice hidden" data-event-empty role="status">${type === "hp" ? "No matching HP values." : "No matching events."}</span></div>
      </section>`;
    },

    parserText(parser) {
      const preset = visibilityPresetName(parser);
      const details = [];
      if (parser.enemy_exact_hp) details.push("exact enemy HP enabled");
      if (parser.enemy_exact_hp_turns?.length) details.push(`exact enemy HP on turn(s) ${parser.enemy_exact_hp_turns.join(", ")}`);
      if (parser.enemy_heal_range_species?.length) details.push(`heal-range reads: ${parser.enemy_heal_range_species.join(", ")}`);
      if (parser.enemy_recoil_hp) details.push("exact enemy recoil HP");
      if (parser.low_roll_detector) details.push(`distinctive ${parser.low_roll_detector.move_name} roll on turn ${parser.low_roll_detector.turn}`);
      return `${preset}${details.length ? ` · ${details.join(" · ")}` : ""}`;
    },

    solutionHtml(fight) {
      if (!fight) return "";
      const actions = [
        ...(fight.normal_policy_actions || []),
        ...(fight.bruteforce?.actions || []),
      ];
      const start = Math.min(this.observedTurns(), actions.length);
      const canFollow = isWin(fight) && actions.length > 0;
      const parser = this.dataset()?.parser || {};
      let missingReplay = false;
      const rows = Array.from({ length: Math.max(actions.length, fight.battle_log?.length || 0) }, (_, index) => {
        const projected = projectReplayTurn(fight.battle_log?.[index], parser, index + 1);
        if (!projected) missingReplay = true;
        const turn = projected || {};
        const action = actions[index] || "—";
        const separator = canFollow && index === start
          ? '<tr class="route-start"><td colspan="4"><div class="route-start-note">' + (start ? 'Seed identified — start reading here' : 'Start reading here') + '</div></td></tr>'
          : '';
        return separator + `<tr data-route-turn="${index}"><td>${index + 1}</td><td class="route-input">${esc(action)}</td><td class="event-cell">${esc(visibleEventText(turn.player))}</td><td class="event-cell">${esc(visibleEventText(turn.npc))}</td></tr>`;
      }).join("");
      return `<div class="filter-result-content">
        <h2>Identified seed: <span class="mono">${esc(fight.seed)}</span></h2>
        ${missingReplay ? '<p class="notice">Replay events unavailable in this older or unsupported export. Update the file to view route events.</p>' : ''}
        <p class="subtitle">${isWin(fight) ? "Winning route" : "No winning bruteforce route was exported"}</p>
        <div class="table-scroll"><table class="data route-table"><thead><tr><th>Turn</th><th>Player Input</th><th>Player events</th><th>Enemy events</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No route or event log was exported.</td></tr>'}</tbody></table></div>
      </div>`;
    },

    candidatesHtml(remaining) {
      const pageSize = 100;
      this.candidatePage = Math.min(this.candidatePage, Math.max(0, Math.ceil(remaining.length / pageSize) - 1));
      const start = this.candidatePage * pageSize;
      return `<p class="subtitle">${remaining.length ? "Keep selecting observed events to identify one seed and view its fight." : "No seeds match these observations. Return to filters and clear or change a selected cue."}</p>
        <div class="table-scroll candidate-table"><table class="data"><thead><tr><th>Candidate seed</th><th>Route</th><th>Player Input · Turn ${this.turn + 1}</th></tr></thead><tbody>${remaining.slice(start, start + pageSize).map(fight => `<tr><td class="mono">${esc(fight.seed)}</td><td>${isWin(fight) ? "Win" : "No winning route"}</td><td>${esc(plannedAction(fight, this.turn) || "—")}</td></tr>`).join("") || '<tr><td colspan="3">No matching seeds.</td></tr>'}</tbody></table></div>
        <div class="candidate-pagination"><span role="status">${remaining.length ? `${start + 1}–${Math.min(start + pageSize, remaining.length)} of ${remaining.length} candidates` : "0 candidates"}</span><button id="filter-candidates-prev" ${start ? "" : "disabled"}>Previous page</button><button id="filter-candidates-next" ${start + pageSize < remaining.length ? "" : "disabled"}>Next page</button></div>`;
    },

    render() {
      const focus = filterDialogFocus();
      const root = document.getElementById("view-filter");
      const dataset = this.dataset();
      const remaining = this.filtered();
      const wins = remaining.filter(isWin).length;
      const winRate = winRateLabel(wins, remaining.length);
      const currentFilters = this.filters[this.turn] || {};

      let analyzer = "";
      if (dataset) {
        const withoutCurrent = filterFights(dataset.fights, this.filters, this.turn);
        const available = optionsFor(withoutCurrent, this.turn);
        const valid = {};
        for (const type of ["player", "npc", "hp"]) {
          const otherFilters = Object.fromEntries(Object.entries(currentFilters).filter(([key]) => key !== type));
          valid[type] = optionsFor(withoutCurrent.filter((fight) => matchesTurn(fight, this.turn, otherFilters)), this.turn)[type];
        }
        const recommended = mostCommonAction(remaining, this.turn);
        const sameInput = remaining.filter(fight => plannedAction(fight, this.turn) === recommended).length;
        analyzer = `
          <div>
            <div class="filter-turn-navigation" aria-label="Battle turn navigation">
              <button id="filter-prev" ${this.turn === 0 ? "disabled" : ""}><span aria-hidden="true">◀</span> Previous turn</button>
              <strong id="filter-turn-position" tabindex="-1" role="status" aria-live="polite">${dataset.maxTurns ? `Turn ${this.turn + 1} of ${dataset.maxTurns}` : "No turns available"}</strong>
              <button id="filter-next" ${this.turn + 1 >= dataset.maxTurns ? "disabled" : ""}>Next turn <span aria-hidden="true">▶</span></button>
            </div>
            <p class="filter-turn-help">Advances automatically when no choices remain for this turn.</p>
            <div class="row filter-identifier-toolbar">
              <button id="filter-clear-turn" ${Object.keys(currentFilters).length ? "" : "disabled"}>Clear this turn</button>
              <button id="filter-clear-all" ${this.filters.some((entry) => Object.keys(entry).length) ? "" : "disabled"}>Clear all</button>
              ${this.candidatesButton("filter-view-candidates", remaining)}
            </div>
            ${statTiles([
              ["Candidates", String(remaining.length)],
              ["Winning routes", String(wins)],
              ["Win rate", winRate],
            ])}
            <div class="filter-player-input" role="status"><span>Player Input · Turn ${this.turn + 1}</span><strong>${esc(recommended || "No input available")}</strong>${recommended && sameInput < remaining.length ? `<small>${sameInput} of ${remaining.length} candidates use this input; inputs differ.</small>` : ""}</div>
            <div class="cue-grid">
              ${this.cueColumn("player", "Player events", available.player, valid.player, currentFilters.player)}
              ${this.cueColumn("npc", "Enemy events", available.npc, valid.npc, currentFilters.npc)}
              ${this.cueColumn("hp", "Player end-of-turn HP", available.hp, valid.hp, currentFilters.hp)}
            </div>
          </div>`;
      }

      const finalFight = remaining.length === 1 ? remaining[0] : null;
      if (!finalFight) this.dismissedResultSeed = null;

      root.innerHTML = `
        <div class="card">
          <h2>Run data filter</h2>
          <p class="subtitle">${globalThis.FilterWeb ? "Choose Falkner or Whitney below, then select your cluster to identify a seed." : "Choose the directory containing your Scenario folders, compare cluster win rates, then select a cluster to identify a seed from the events you can see in battle."}</p>
          ${globalThis.FilterWeb ? "" : `<div class="row">
            ${field(globalThis.FilterWeb ? "Hosted datasets" : "Scenario data directory", `<div class="directory-picker"><button type="button" id="filter-directory" ${globalThis.FilterWeb ? 'aria-label="Reload datasets"' : ""} ${this.choosingDirectory ? 'disabled aria-busy="true"' : ""}>${globalThis.FilterWeb ? "Reload datasets" : "Choose directory…"}</button><span class="mono">${esc(this.directoryPath || (globalThis.FilterWeb ? "Loading catalogue…" : "No directory selected"))}</span></div>`)}
            ${field("Or individual JSON files", `<input type="file" id="filter-files" accept=".json,application/json" multiple ${this.choosingDirectory ? "disabled" : ""} />`)}
          </div>`}
          <div class="notice" role="status" aria-live="polite">${esc(this.notice)}</div>
        </div>
        ${this.scenarios.length ? `<div class="card"><h2>Scenarios</h2><div class="dataset-grid">${this.scenarios.map((entry, index) => `
          <button class="dataset-option${index === this.selectedScenario ? " selected" : ""}" data-scenario="${index}" ${this.choosingDirectory ? "disabled" : ""}>
            <strong>${esc(entry.name)}</strong><span>${entry.datasets.length} cluster dataset(s)</span>
          </button>`).join("")}</div></div>` : ""}
        ${this.datasets.length ? `<div class="card"><h2>Clusters in ${esc(this.scenarios[this.selectedScenario]?.name || "selected files")}</h2><div class="dataset-grid">${this.datasets.map((entry, index) => `
          <button class="dataset-option${index === this.selected ? " selected" : ""}" data-dataset="${index}" ${this.choosingDirectory || this.loadingDataset === index ? "disabled" : ""} ${this.loadingDataset === index ? 'aria-busy="true"' : ""}>
            <span>Cluster: <strong>${esc(entry.label)}</strong></span><span title="${esc(entry.summaryError || "")}">${entry.fightCount === undefined ? "Win rate unavailable" : `Win rate: <strong>${winRateLabel(entry.wins, entry.fightCount)}</strong>`}${this.loadingDataset === index ? " · Loading…" : ""}</span>
          </button>`).join("")}</div></div>` : ""}
        ${dataset ? `<div class="card filter-open-card"><span>Identifier: <strong>${esc(dataset.label)}</strong> · ${remaining.length} candidate${remaining.length === 1 ? "" : "s"}</span><div class="row"><button class="primary" id="filter-open-identifier">Open identification</button>${this.candidatesButton("filter-open-candidates", remaining)}</div></div>` : ""}`;
      this.wire(root);
      this.renderIdentifierModal(analyzer);
      this.renderResultModal(finalFight, remaining);
      restoreFilterDialogFocus(focus);
    },

    wire(root) {
      root.querySelector("#filter-directory")?.addEventListener("click", () => this.chooseDirectory());
      root.querySelector("#filter-files")?.addEventListener("change", (event) => this.loadFiles([...event.target.files]));
      root.querySelectorAll("[data-scenario]").forEach((button) =>
        button.addEventListener("click", () => this.selectScenario(Number(button.dataset.scenario)))
      );
      root.querySelectorAll("[data-dataset]").forEach((button) =>
        button.addEventListener("click", () => this.selectDataset(Number(button.dataset.dataset)))
      );
      root.querySelector("#filter-open-identifier")?.addEventListener("click", () => {
        this.identificationOpen = true;
        this.render();
      });
      root.querySelector("#filter-open-candidates")?.addEventListener("click", () => this.openCandidates());
    },

    renderIdentifierModal(analyzer) {
      document.getElementById("filter-identifier-modal")?.remove();
      if (!this.identificationOpen || !analyzer || !this.dataset()) return;
      const close = () => {
        this.identificationOpen = false;
        this.render();
        document.getElementById("filter-open-identifier")?.focus();
      };
      const dialog = mountFilterDialog("filter-identifier-modal", "filter-identifier-modal", "Identify seed", analyzer, close,
        '<div class="subtitle">' + esc(this.dataset().label) + ' · ' + esc(this.dataset().name) + '</div>', "filter-close-identifier", "Close");
      this.wireIdentifier(dialog);
    },

    renderResultModal(fight, remaining) {
      document.getElementById("filter-result-modal")?.remove();
      const autoOpen = this.identificationOpen && fight && String(fight.seed) !== this.dismissedResultSeed;
      if (!this.dataset() || (!this.candidatesOpen && !autoOpen)) return;
      const close = () => {
        if (fight) this.dismissedResultSeed = String(fight.seed);
        this.candidatesOpen = false;
        this.render();
        document.getElementById(this.identificationOpen ? "filter-view-candidates" : "filter-open-candidates")?.focus();
      };
      const dialog = mountFilterDialog("filter-result-modal", "filter-result-modal", fight ? "Final seed identified" : "Candidate seeds",
        fight ? this.solutionHtml(fight) : this.candidatesHtml(remaining), close, "", "filter-close-result", this.identificationOpen ? "Back to filters" : "Close");
      dialog.querySelector("#filter-candidates-prev")?.addEventListener("click", () => { this.candidatePage--; this.render(); });
      dialog.querySelector("#filter-candidates-next")?.addEventListener("click", () => { this.candidatePage++; this.render(); });
    },

    applyEventSearch(root) {
      root.querySelectorAll("[data-event-options]").forEach((group) => {
        const type = group.dataset.eventOptions;
        const buttons = [...group.querySelectorAll("[data-event-label]")];
        buttons.forEach((button) => {
          button.classList.toggle("hidden", !eventLabelMatches(button.dataset.eventLabel, this.eventSearch[type]));
        });
        root.querySelector('[data-search-clear="' + type + '"]')?.classList.toggle("hidden", !this.eventSearch[type]);
        const empty = group.querySelector("[data-event-empty]");
        empty?.classList.toggle("hidden", !buttons.length || buttons.some((button) => !button.classList.contains("hidden")));
      });
    },

    wireIdentifier(root) {
      const previous = root.querySelector("#filter-prev");
      if (!previous) return;
      previous.addEventListener("click", () => this.changeTurn(this.turn - 1));
      root.querySelector("#filter-next").addEventListener("click", () => this.changeTurn(this.turn + 1));
      root.querySelector("#filter-clear-turn").addEventListener("click", () => {
        this.filters[this.turn] = {}; this.observationsChanged();
      });
      root.querySelector("#filter-clear-all").addEventListener("click", () => {
        this.filters = this.filters.map(() => ({}));
        this.observationsChanged();
      });
      root.querySelector("#filter-view-candidates").addEventListener("click", () => this.openCandidates());
      root.querySelectorAll("[data-event-search]").forEach(input => {
        const update = () => {
          this.eventSearch[input.dataset.eventSearch] = input.value;
          this.applyEventSearch(root);
        };
        input.addEventListener("input", event => { if (!event.isComposing) update(); });
        input.addEventListener("compositionend", update);
      });
      root.querySelectorAll("[data-search-clear]").forEach(button => button.addEventListener("click", () => {
        const type = button.dataset.searchClear;
        const input = root.querySelector('[data-event-search="' + type + '"]');
        input.value = this.eventSearch[type] = "";
        this.applyEventSearch(root);
        input.focus();
      }));
      this.applyEventSearch(root);
      root.querySelectorAll("[data-cue-type]").forEach((button) => button.addEventListener("click", () => {
        const type = button.dataset.cueType;
        const value = button.dataset.cueValue;
        const current = this.filters[this.turn] ||= {};
        const selected = current[type] !== value;
        if (!selected) delete current[type];
        else current[type] = value;
        this.observationsChanged(selected);
      }));
    },
  };

  // Pure regression hook used by the app's headless command self-test.
  App.filterSelfTest = () => {
    const fights = [
      { visible_turns: [{ player: ["Pluck"], npc: ["Reflect"], player_end_hp: 65 }] },
      { visible_turns: [{ player: ["Pluck", "crit"], npc: ["Razor Leaf"], player_end_hp: 39 }] },
    ];
    const filters = [{ player: cueKey(["Pluck"]), hp: "65" }];
    const pluck = cueKey(["Pluck"]);
    const critical = cueKey(["Pluck", "crit"]);
    const result = filterView.solutionHtml({
      seed: "0x1",
      status: "WIN",
      normal_policy_actions: [],
      bruteforce: { actions: ["Pluck"] },
      visible_turns: [{ player: ["Pluck", "crit"], npc: ["Double Slap", "crit"], player_end_hp: 42 }],
      battle_log: [{ event_schema: 1,
        player_events: [{ kind: "move", name: "Pluck" }, { kind: "damage_hp", hp: 25 }, { kind: "text", text: "crit" }],
        npc_events: [{ kind: "move", name: "Double Slap" }, { kind: "text", text: "crit" }],
        player_actions: "Pluck, 25 HP left, crit", npc_actions: "Double Slap, 49 HP after attack, crit, 42 HP after attack" }],
    });
    return filterFights(fights, filters).length === 1
      && optionsFor(fights, 0).player.size === 2
      && clusterLabel("cluster_51_46.json").label === "51:46"
      && winRateLabel(1, 2) === "50.0%"
      && sortedOptionValues("player", new Set([pluck, critical]), new Set([critical]))[0] === critical
      && eventLabelMatches("Critical hit", "critical")
      && result.includes("Player events")
      && !result.includes("Move slot 1")
      && result.includes("crit")
      && !result.includes("HP left")
      && !result.includes("after attack")
      && !result.includes("25")
      && !result.includes("49")
      && !result.includes("frames");
  };

  App.views.filter = filterView;
})();
