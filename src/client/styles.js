/**
 * Settings-card styles.
 *
 * Colors come from DSH theme variables so the card follows light and dark
 * themes. The stylesheet is injected once and tagged for the Client HMR
 * runtime, which removes plugin-owned styles before reinstalling a bundle.
 */
const CSS = [
  '.notix-card{box-sizing:border-box;max-width:640px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:24px;font-size:13px;line-height:1.5;display:flex}',
  '.notix-card *{box-sizing:border-box}',
  '.notix-summary{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}',
  '.notix-section{flex-direction:column;gap:10px;display:flex}',
  '.notix-section-title{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:600;line-height:22px}',
  '.notix-group{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xl,12px);background:var(--dsw-alias-settings-card-fill,transparent);padding:0 14px}',
  '.notix-trigger{padding:12px 0}',
  '.notix-trigger+.notix-trigger{border-top:.5px solid var(--dsw-alias-border-l2)}',
  '.notix-trigger-head{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}',
  '.notix-trigger-text{flex:1;min-width:0}',
  '.notix-trigger-title{font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}',
  '.notix-trigger-hint{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
  '.notix-fields{flex-direction:column;display:flex}',
  '.notix-trigger .notix-fields{margin-top:4px}',
  '.notix-group>.notix-fields{padding:6px 0}',
  '.notix-fields-disabled{opacity:.55}',
  '.notix-field{flex-direction:column;gap:2px;padding:4px 0;display:flex}',
  '.notix-field-row{justify-content:space-between;align-items:center;gap:16px;min-height:32px;padding:4px 0;display:flex}',
  '.notix-field-label{flex:1;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
  '.notix-field-message{margin:0;font-size:12px;line-height:18px}',
  '.notix-field-error{color:var(--dsw-alias-state-error-primary,#d03050)}',
  '.notix-field-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
  '.notix-input{height:28px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-layer-3,transparent);padding:0 10px;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);outline:none}',
  '.notix-input::placeholder{color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary))}',
  '.notix-input:focus-visible{border-color:var(--dsw-alias-state-business-primary,#3b6ef6)}',
  '.notix-input:disabled{opacity:.6;cursor:default}',
  '.notix-input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary,#d03050)}',
  '.notix-input-num{flex:none;width:88px;text-align:right;font-variant-numeric:tabular-nums}',
  '.notix-input-time{flex:none;width:120px;font-variant-numeric:tabular-nums}',
  '.notix-input-select{flex:none;min-width:120px}',
  '.notix-input-text{flex:1;min-width:0;max-width:360px}',
  '.notix-status{flex-wrap:wrap;align-items:baseline;gap:4px 12px;min-height:18px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px;font-size:12px;line-height:18px;display:flex}',
  '.notix-status-error{color:var(--dsw-alias-state-error-primary,#d03050)}',
  '.notix-status-saved{color:var(--dsw-alias-state-success-primary,#2ba471)}',
  '.notix-status-note{margin-left:auto;color:var(--dsw-alias-label-tertiary)}',
].join(' ')

const CSS_TAG = 'notix-dsh/card.css'

/** Install the card stylesheet once for the current document. */
export function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'notix-dsh'
  tag.dataset.pluginCss = CSS_TAG
  tag.textContent = CSS
  document.head.appendChild(tag)
}
