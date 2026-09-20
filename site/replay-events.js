// Version 1 unfiltered replay events -> parser-approved route observations.
// Identification continues to use the ORIGINAL policy's visible_turns.
// Mirrored into filter-app/ui; tests enforce identical implementations.
(function (root) {
  "use strict";
  const normalize = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function projectReplayTurn(turn, parser = {}, turnNumber = 1) {
    if (turn?.event_schema !== 1 || !Array.isArray(turn.player_events) || !Array.isArray(turn.npc_events)) return null;
    const exact = parser.enemy_exact_hp === true || (parser.enemy_exact_hp_turns || []).includes(turnNumber);
    const ranges = new Set((parser.enemy_heal_range_species || []).map(normalize));
    function project(events, player) {
      const result = [];
      for (const event of events) {
        switch (event.kind) {
          case "text": result.push(event.text); break;
          case "move": result.push(event.name); break;
          case "damage_hp": if (!player || exact) result.push(String(event.hp)); break;
          case "heal_range": if (!player || ranges.has(normalize(event.species))) result.push("heal range"); break;
          case "recoil": result.push(player ? `${event.hp} HP after recoil` : parser.enemy_recoil_hp ? `recoil, ${event.hp} HP left` : "recoil"); break;
          case "full": result.push("full"); break;
          default: return null;
        }
      }
      return result;
    }
    const player = project(turn.player_events, true);
    const npc = project(turn.npc_events, false);
    if (!player || !npc) return null;
    const detector = parser.low_roll_detector;
    if (detector && detector.turn === turnNumber &&
        turn.player_events.some(event => event.kind === "move" && normalize(event.name) === normalize(detector.move_name)) &&
        turn.player_events.some(event => event.kind === "damage_hp" && event.hp === detector.max_hp - detector.damage)) player.push("low roll");
    return { player, npc, player_end_hp: turn.player_hp };
  }
  root.projectReplayTurn = projectReplayTurn;
  if (typeof module !== "undefined") module.exports = { projectReplayTurn };
})(globalThis);
