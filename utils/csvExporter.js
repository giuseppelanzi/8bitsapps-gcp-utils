const fs = require("fs/promises");
//
/**
 * Escapes and formats a single CSV row.
 * @param {Array<string>} fields - Row values.
 * @returns {string} CSV-formatted row with newline.
 */
function formatCsvRow(fields) {
  return fields.map(f => {
    const val = String(f ?? "");
    const escaped = val.replace(/"/g, '""');
    return `"${escaped}"`;
  }).join(",") + "\n";
}
//
/**
 * Writes headers and rows to a CSV file.
 * @param {string} filePath - Destination file path.
 * @param {Array<string>} headers - Column headers.
 * @param {Array<Array<string>>} rows - Data rows.
 * @returns {Promise<{path: string, rowCount: number}>} Written path and row count.
 */
async function exportToCsv(filePath, headers, rows) {
  let content = formatCsvRow(headers);
  for (const row of rows) {
    content += formatCsvRow(row);
  }
  //
  await fs.writeFile(filePath, content, "utf8");
  //
  return { path: filePath, rowCount: rows.length };
}
//
module.exports = { formatCsvRow, exportToCsv };
