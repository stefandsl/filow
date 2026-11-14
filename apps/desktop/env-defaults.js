// Model ids an older .env.example wrote into the profile's .env on first start. They were Filow's
// defaults then, not the user's choice: read as unset, so Filow's current default applies. The file
// itself is never changed, and any other value (the user's own choice) is kept as it is.
const RETIRED_DEFAULTS = {
  OPENROUTER_DECISION_MODEL: "google/gemini-2.5-flash-lite",
  OPENROUTER_VISION_MODEL: "google/gemini-2.5-flash",
  OPENROUTER_GENERATE_VISION_MODEL: "google/gemini-2.5-flash",
};

/** True when this .env line is only an old seeded default. */
function retiredDefault(key, value) {
  return Object.prototype.hasOwnProperty.call(RETIRED_DEFAULTS, key) && RETIRED_DEFAULTS[key] === value;
}

module.exports = { RETIRED_DEFAULTS, retiredDefault };
