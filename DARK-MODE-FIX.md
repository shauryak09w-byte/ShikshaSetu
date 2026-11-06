# ShikshaSetu — Dark Mode Fix

The login page and workspace now use the same `theme-controller.js` instead of relying on separate toggle implementations.

## What is fixed
- Both pages read the same `shikshasetu-theme` preference before the page is painted.
- The login theme button, workspace theme button, and Appearance dialog all switch the same setting.
- The active theme is reflected by `data-theme`, `color-scheme`, the browser theme-color meta tag, button labels, and `aria-pressed` state.
- A theme change in another open ShikshaSetu tab is synchronized through the browser `storage` event.
- The original reference styling remains paired: light mode uses luminous botanical/Aero glass surfaces with dark green text; dark mode uses deep emerald glass, bright moss rims, pale text, dark inputs, and dark table rows.
- The 24-scene background gallery remains enabled and keeps the appropriate light/dark contrast veil.
- Invalid theme values in local storage are ignored instead of being applied to the document.

## Quick test
1. Open `index.html`, switch to light mode, and reload. Light mode should remain selected.
2. Open the workspace, switch to dark mode, and reload. Dark mode should remain selected.
3. Open login and workspace in separate tabs. Changing the theme in one tab should update the other tab.
4. Open Appearance in the workspace and use its theme button. It should behave exactly like the topbar button.

The theme controller was tested for both directions, preference persistence, browser theme-color updates, accessible control labels, and cross-tab storage synchronization. CSS parsing, JavaScript syntax, duplicate-ID checks, 24-image asset count, and ZIP integrity were also checked. A complete visual browser screenshot test was not available in this environment.


## Premium translucent dark glass refinement

The dark theme now has a dedicated material pass based on the supplied natural moss-card reference. Cards and KPI panels use a lower-opacity emerald glass gradient, blurred forest imagery, the transparent moss-panel frame as a natural edge, and restrained inset highlights. Tables use translucent row bands, a soft green header, fine separators and matching moss framing. Nested panels use a quieter tint than their parent cards.

Headings and page titles use warm white text with a restrained dark separation shadow so they remain legible over the photographic forest background and translucent surfaces. Subtitles and captions use a lighter sage-white. Text-entry controls retain a stronger background for readability; card transparency does not reduce input legibility. The light theme rules are not changed by this refinement.
