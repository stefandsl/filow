/** Append calendar context without changing the cacheable instruction prefix.
 * @param {string} system
 * @param {Date} date
 * @returns {string}
 */
function withLocalDate(system, date) {
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${system}\nToday's local date: ${day} (${weekdays[date.getDay()]}).`;
}

module.exports = { withLocalDate };
