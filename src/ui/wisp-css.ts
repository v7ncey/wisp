export const WISP_CSS = `
:host { all: initial; }
.wisp {
  --bg: #ffffff; --fg: #1d2333; --muted: #5d6680; --line: #e3e7f0; --chip: #eef4ff; --chip-fg: #1f4fbf;
  --ai: #7a3cc2; --shadow: 0 12px 32px rgba(22, 32, 64, .18);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--fg);
  z-index: 2147483000;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  pointer-events: none;
}
@media (prefers-color-scheme: dark) {
  .wisp { --bg: #1b2030; --fg: #e8ecf5; --muted: #a3acc2; --line: #2f3750; --chip: #23304f; --chip-fg: #a9c6ff; --ai: #c9a2ff; --shadow: 0 12px 32px rgba(0,0,0,.5); }
}
.wisp.fixed { position: fixed; right: 18px; bottom: 96px; }
.wisp.contained { position: absolute; right: 12px; bottom: 76px; }
.orb-btn {
  pointer-events: auto; border: 0; background: none; padding: 0; cursor: pointer;
  width: 52px; height: 52px; border-radius: 50%;
  transition: transform .5s cubic-bezier(.3,1.4,.5,1), opacity .4s;
  opacity: .55; transform: translateX(22px) scale(.8);
}
.orb-btn:focus-visible { outline: 2px solid #6aa8ff; outline-offset: 3px; }
.orb { width: 100%; height: 100%; filter: drop-shadow(0 0 10px rgba(130, 190, 255, .7)); animation: bob 3.2s ease-in-out infinite; }
.eyes { transition: transform .4s; }
.glancing .eyes { transform: translate(-3px, 2px); }
@keyframes bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
.wisp:hover .orb-btn, .wisp[data-state="peek"] .orb-btn, .wisp[data-state="open"] .orb-btn { opacity: 1; transform: none; }
.wisp[data-state="peek"] .eyes { transform: translate(-4px, 3px); }
.bubble {
  pointer-events: auto;
  width: min(340px, calc(100vw - 32px)); box-sizing: border-box;
  background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
  padding: 12px 14px; transform-origin: bottom right;
  opacity: 0; transform: translateY(8px) scale(.92); visibility: hidden;
  transition: opacity .25s, transform .3s cubic-bezier(.3,1.4,.5,1), visibility .3s;
  max-height: min(70vh, 520px); overflow: auto;
}
.wisp[data-state="open"] .bubble { opacity: 1; transform: none; visibility: visible; }
@media (prefers-reduced-motion: reduce) { .orb, .bubble, .orb-btn { animation: none; transition: none; } }
header { display: flex; justify-content: space-between; align-items: start; gap: 8px; margin-bottom: 4px; }
header strong { font-size: 15px; }
p { margin: 6px 0; }
.seen { color: var(--ai); font-style: italic; font-size: 13px; }
.why { color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
.chip {
  font: inherit; font-size: 13px; border: 1px solid transparent; background: var(--chip); color: var(--chip-fg);
  padding: 5px 10px; border-radius: 999px; cursor: pointer; text-align: left;
}
.chip:hover:not(:disabled) { border-color: var(--chip-fg); }
.chip:disabled { opacity: .6; cursor: default; }
.chip.ai { color: var(--ai); }
.chip small { font-size: 10px; opacity: .8; margin-left: 4px; }
.features { margin: 8px 0 4px; padding-left: 18px; font-size: 13px; }
.features li { margin: 4px 0; }
a { color: var(--chip-fg); }
.fine { color: var(--muted); font-size: 12px; }
footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.src { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; }
.src.ai { color: var(--ai); border-color: var(--ai); }
.src.loading { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .4 } }
.actions { display: flex; gap: 10px; align-items: center; }
button.x { font: inherit; border: 0; background: none; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
button.link { font: inherit; font-size: 12px; border: 0; background: none; color: var(--muted); text-decoration: underline; cursor: pointer; padding: 0; }
button.got { font: inherit; font-size: 13px; border: 0; background: #2f6bea; color: #fff; padding: 5px 12px; border-radius: 8px; cursor: pointer; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
.stats div { background: var(--chip); border-radius: 8px; padding: 6px 8px; }
.stats dt { font-size: 11px; color: var(--muted); }
.stats dd { margin: 0; font-size: 18px; font-weight: 600; }
.toggle { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.toast { margin: 0; }
`;
