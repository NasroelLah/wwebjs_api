/**
 * @fileoverview LID-migration runtime patch for whatsapp-web.js (upstream issue #3834).
 *
 * Some WhatsApp Web versions can fail to resolve phone-number identities to
 * LIDs and report "No LID for user". This patch attempts a guarded fallback
 * for known errors; success depends on the current WhatsApp Web internals.
 *
 * This is an experimental compatibility patch for private WhatsApp Web modules,
 * not a documented upstream API or a guarantee that LID resolution will work.
 * Only known LID errors are intercepted. Installation status is exposed for
 * diagnostics; a renamed or absent required target is reported as unavailable,
 * while an absent optional target is listed in `missing` and does not block it.
 *
 * Injection uses the documented `evalOnNewDoc` Client option and is idempotent
 * per document.
 */

/** Page error strings that indicate an LID-resolution failure. */
const LID_ERROR_PATTERNS = [
  "No LID for user",
  "Lid is missing in chat table",
  "does not have an accountLid",
];

/**
 * Checks whether an error indicates an LID-resolution failure
 * (wwebjs/whatsapp-web.js#3834). Avoid automatically retrying the send.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isLidResolutionError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return LID_ERROR_PATTERNS.some((p) => message.includes(p.toLowerCase()));
}

/**
 * Source of the page-side patch as a self-contained function expression.
 * Puppeteer stringifies it and runs it in the WhatsApp Web page context;
 * closures from this module are not available there.
 * @returns {string} function source
 */
export function getLidPatchSource() {
  return `function () {
  const STATUS = '__wwebjsLidPatchStatus';
  if (window[STATUS]) return;
  const status = window[STATUS] = { state: 'waiting', hooks: [], missing: [] };
  let installed = [];
  const targets = [
    { module: 'WAWebLid1X1MigrationGating', function: 'Lid1X1MigrationUtils.isLidMigrated', fallback: 'boolean', optional: true },
    { module: 'WAWebLidMigrationUtils', function: 'toUserLid', fallback: 'wid' },
    { module: 'WAWebLidMigrationUtils', function: 'toUserLidOrThrow', fallback: 'wid' },
  ];
  const keyOf = (target) => target.module + '.' + target.function;
  const isInstalled = (target) => installed.some((hook) => hook.key === keyOf(target));
  const requiredReady = () => targets.every((target) => target.optional || isInstalled(target));
  const isLidError = (error) => /no lid for user|lid is missing in chat table|does not have an accountlid/i.test(String(error?.message ?? error ?? ''));
  const inject = () => {
    if (!window.WWebJS?.injectToFunction || typeof window.require !== 'function') return false;
    for (const target of targets) {
      const key = keyOf(target);
      if (isInstalled(target) || status.missing.includes(key)) continue;
      try {
        const path = target.function.split('.');
        const name = path.pop();
        let owner = window.require(target.module);
        for (const part of path) owner = owner?.[part];
        if (!owner) continue;
        if (typeof owner[name] !== 'function') {
          // An optional hook is missing once its module has loaded without it; required hooks keep retrying.
          if (target.optional) status.missing.push(key);
          continue;
        }
        const original = owner[name];
        const onError = (error, args) => {
          if (isLidError(error)) return target.fallback === 'boolean' ? false : args[0];
          throw error;
        };
        owner[name] = function (...args) {
          try {
            const result = original.apply(owner, args);
            return result && typeof result.then === 'function'
              ? Promise.resolve(result).catch((error) => onError(error, args))
              : result;
          } catch (error) { return onError(error, args); }
        };
        if (owner[name] !== original) installed.push({ key, owner, name, wrapped: owner[name] });
      } catch { /* Retry while WhatsApp Web loads or report an unavailable hook. */ }
    }
    installed = installed.filter((hook) => hook.owner[hook.name] === hook.wrapped);
    status.hooks = installed.map((hook) => hook.key);
    if (!targets.every((target) => isInstalled(target) || status.missing.includes(keyOf(target)))) return false;
    status.state = 'applied';
    return true;
  };
  if (inject()) return;
  let tries = 0;
  const timer = setInterval(() => {
    if (inject()) clearInterval(timer);
    else if (++tries >= 240) { status.state = requiredReady() ? 'applied' : 'unavailable'; clearInterval(timer); }
  }, 250);
}`;
}

/**
 * Ready-to-use function for the Client `evalOnNewDoc` option.
 * @type {function}
 */
export const lidMigrationPatch = new Function(
  `return (${getLidPatchSource()})`
)();
