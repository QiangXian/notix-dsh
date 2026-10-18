/**
 * Host half of notix-dsh-ui: intentionally a no-op.
 *
 * All behaviour lives in the browser bundle (`lib/client.js`), which the
 * loader serves through the `dsh.client` manifest entry. The Host half only
 * exists so the package is a valid Cordis plugin on both sides.
 */
export function apply() {}
