const querystring = require('querystring');

function encodeFilename(name) {
  if (name == null) return '';
  // preserve existing safe filenames, otherwise URL-encode
  return encodeURIComponent(String(name));
}

function applyTemplate(template, filename) {
  if (!template) return null;
  // Support both {filename} and {{file}} placeholders (legacy)
  let out = String(template).replace(/\{\{\s*file\s*\}\}/g, filename);
  out = out.replace(/\{filename\}/g, filename);
  return out;
}

function buildFileUrl(item) {
  if (!item) return null;
  const template = process.env.POS_FILE_URL_TEMPLATE;
  const explicitField = process.env.POS_FILE_URL_FIELD;
  const baseUrl = process.env.POS_FILE_BASE_URL || 'https://biggsph.com/biggsinc_loyalty/controller/';

  // Normalize to value (string) if item is object or primitive
  let value = null;
  if (typeof item === 'string') value = item;
  else if (explicitField && item && item[explicitField]) value = item[explicitField];
  else if (item && typeof item === 'object') value = item.url || item.fileUrl || item.path || item.filename || item.file || item.name;

  if (!value) return null;

  // If value already looks like a full URL, return it as-is
  if (/^https?:\/\//i.test(value)) return value;

  // Apply template if present, else join with baseUrl
  const encoded = encodeFilename(value);
  if (template) {
    return applyTemplate(template, encoded);
  }
  // fallback: simple concatenation
  return `${baseUrl}${encoded}`;
}

module.exports = { buildFileUrl };
