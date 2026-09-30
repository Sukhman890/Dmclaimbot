const stamp = () => new Date().toISOString();
const fmt = (tag, msg, fields) =>
  `${stamp()} [${tag}] ${msg}` +
  (fields ? '\n' + Object.entries(fields).map(([k, v]) => `${k}=${v}`).join('\n') : '');

module.exports = {
  info: (tag, msg, fields) => console.log(fmt(tag, msg, fields)),
  error: (tag, msg, err) => console.error(fmt(tag, msg) + (err ? ` :: ${err.stack || err}` : '')),
  // Never log full reward codes.
  maskCode: (code) => (code.length <= 4 ? '****' : '*'.repeat(code.length - 4) + code.slice(-4)),
};
