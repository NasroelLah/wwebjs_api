/**
 * @fileoverview LID-migration runtime patch for whatsapp-web.js (upstream issue #3834).
 *
 * WhatsApp Web is migrating 1:1 chats from phone-number identities (@c.us) to
 * LID identities (@lid). On affected clients (isLidMigrated = true, common on
 * WhatsApp Business accounts) the page-internal conversion throws
 * "Error: No LID for user" for numbers that have no LID mapping yet, which
 * makes Client.sendMessage and getChatById fail inside
 * WAWebFindChatAction.findOrCreateLatestChat. Retrying cannot succeed.
 *
 * This patch injects guarded wrappers into the page:
 *   - Lid1X1MigrationUtils.isLidMigrated: original logic runs; falls back to
 *     false only if it throws (fixed-value overrides can cause logouts).
 *   - WAWebLidMigrationUtils.toUserLid / toUserLidOrThrow: fall back to the
 *     original phone-number WID instead of throwing, restoring the legacy
 *     addressing path for numbers without an LID.
 *
 * Injection happens on every new document through the documented Client
 * option `evalOnNewDoc` (whatsapp-web.js >= 1.34), before WhatsApp Web
 * finishes loading, and is idempotent per document.
 */

/** Page error strings that indicate a deterministic LID-resolution failure. */
const LID_ERROR_PATTERNS = [
  "No LID for user",
  "Lid is missing in chat table",
  "does not have an accountLid",
];

/**
 * Checks whether an error is a deterministic LID-resolution failure
 * (wwebjs/whatsapp-web.js#3834). Such errors must not be retried.
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
  const TAG = '__wwebjsLidPatchApplied';
  if (window[TAG]) return;
  const inject = () => {
    if (window[TAG]) return true;
    if (typeof window.WWebJS === 'undefined' || !window.WWebJS.injectToFunction) return false;
    const required = ['WAWebLid1X1MigrationGating', 'WAWebLidMigrationUtils', 'WAWebWidFactory'];
    const ready = required.every((m) => {
      try { return !!window.require(m); } catch { return false; }
    });
    if (!ready) return false;
    window[TAG] = true;
    const guarded = (target, callback) => {
      try { window.WWebJS.injectToFunction(target, callback); } catch { /* module renamed in a newer web version */ }
    };
    guarded(
      { module: 'WAWebLid1X1MigrationGating', function: 'Lid1X1MigrationUtils.isLidMigrated' },
      (module, func, ...args) => {
        try { return func(...args); } catch { return false; }
      }
    );
    const lidFallback = (module, func, wid) => {
      try { return func(wid); } catch { return wid; }
    };
    guarded({ module: 'WAWebLidMigrationUtils', function: 'toUserLid' }, lidFallback);
    guarded({ module: 'WAWebLidMigrationUtils', function: 'toUserLidOrThrow' }, lidFallback);
    return true;
  };
  if (inject()) return;
  let tries = 0;
  const timer = setInterval(() => {
    if (inject() || ++tries > 240) clearInterval(timer);
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
