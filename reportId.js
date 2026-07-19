const pool = require('../db/pool');

// Atomically increments the shared sequence so concurrent submissions never collide.
// Returns both the full Report ID and the raw sequence number, since the reporter
// alias (e.g. "SUMAT-014") is derived from the same sequence.
async function nextReportSequence() {
  const result = await pool.query(
    `UPDATE report_sequence SET current_value = current_value + 1 WHERE sequence_key = 1 RETURNING current_value`
  );
  const sequence = Number(result.rows[0].current_value);
  const year = new Date().getFullYear();
  return {
    sequence,
    reportId: `SUMAT-${year}-${String(sequence).padStart(6, '0')}`,
    reporterAlias: `SUMAT-${String(sequence).padStart(3, '0')}`
  };
}

module.exports = { nextReportSequence };
