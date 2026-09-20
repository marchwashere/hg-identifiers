// Static-host transport for the existing filter. No engine, upload, or Tauri needed.
(function () {
  "use strict";
  const base = new URL(".", document.currentScript.src);
  let entries = new Map();
  let datasetRequest = null;

  async function catalogue() {
    if (location.protocol === "file:") throw new Error("Serve this folder over HTTP(S); do not open index.html directly");
    const response = await fetch(new URL("catalog.json", base), {cache: "no-cache"});
    if (!response.ok) throw new Error(`Catalogue request failed (HTTP ${response.status})`);
    const data = await response.json();
    if (data.schema_version !== 1 || !Array.isArray(data.files)) throw new Error("Unsupported dataset catalogue");
    const next = new Map();
    for (const file of data.files) {
      if (typeof file.name !== "string" || typeof file.scenario !== "string" ||
          typeof file.relative_path !== "string" || next.has(file.relative_path) ||
          !/^data\/[a-f0-9]{64}\.json$/.test(file.asset) ||
          !Number.isInteger(file.summary?.wins) || !Number.isInteger(file.summary?.fight_count) ||
          file.summary.wins < 0 || file.summary.wins > file.summary.fight_count) {
        throw new Error("Invalid dataset catalogue entry");
      }
      next.set(file.relative_path, file.asset);
    }
    entries = next;
    datasetRequest?.abort();
    datasetRequest = null;
    return {path: `Bundled datasets · ${data.files.length} clusters`, files: data.files};
  }

  window.FilterWeb = Object.freeze({
    async invoke(command, args = {}) {
      if (command === "initial_filter_directory" || command === "choose_filter_directory") return catalogue();
      if (command !== "read_filter_dataset") throw new Error(`Unsupported web action: ${command}`);
      const asset = entries.get(args.relativePath);
      if (!asset) throw new Error("Cluster is not in the loaded catalogue; reload datasets");
      datasetRequest?.abort();
      const controller = new AbortController();
      datasetRequest = controller;
      try {
        const response = await fetch(new URL(asset, base), {signal: controller.signal});
        if (!response.ok) throw new Error(`Cluster request failed (HTTP ${response.status})`);
        return await response.text();
      } finally {
        if (datasetRequest === controller) datasetRequest = null;
      }
    },
  });
})();
