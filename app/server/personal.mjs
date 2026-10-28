/**
 * Personal preset.
 *
 * MAX ships pre-connected for its owner so it is useful on first launch. Anyone else
 * who runs MAX gets an empty config and fills their own handles in Settings — the
 * preset is only written once, on the very first run, and never re-applied after that.
 *
 * Set MAX_SKIP_PRESET=1 in the environment to ignore this file entirely.
 */
export const PERSONAL_PRESET = {
  owner: "ssambit635-svg",
  github: { username: "ssambit635-svg" },
  leetcode: { username: "sambitswain25" },
};

export const presetEnabled = () => process.env.MAX_SKIP_PRESET !== "1";
