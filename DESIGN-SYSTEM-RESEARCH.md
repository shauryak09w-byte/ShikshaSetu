# ShikshaSetu — Frutiger Aero Light / Emerald Liquid Glass Dark

## Design brief implemented

This release follows the two explicit reference directions supplied by the product owner:

- **Light mode — Frutiger Aero:** botanical green glass, pale aqua/mint illumination, soft moss texture, simulated glossy reflections, rounded high-shine surfaces, and dark readable typography.
- **Dark mode — Emerald Liquid Glass:** deep emerald translucent surfaces, brighter moss/grass edge lighting, layered luminous reflections, and clean high-contrast white typography.

The same design tokens are applied across all principal workspace cards, metrics, AI panels, support panels, modals, nested information boxes, data tables, table headers, rows, and account forms. The existing scene gallery and transparency slider remain in place; surface alpha is derived from `--glass-alpha`, so the setting still affects the material.

## Research basis and design interpretation

1. **Frutiger Aero visual vocabulary.** The Consumer Aesthetics Research Institute describes the retrospective style through glossy interfaces, glass/transparency, macro grass, bokeh, and nature imagery. The University of Waterloo's Computer Museum also documents its combination of glossy/glass-like textures, nature, rounded edges, and 3D styling. This release translates those motifs into a controlled aqua/leaf palette rather than using noisy gradients or literal skeuomorphic widgets.
   - https://cari.institute/aesthetics/frutiger-aero
   - https://uwaterloo.ca/computer-museum/exhibits/frutiger-aero-future-2000s
2. **Liquid Glass material hierarchy.** Apple's Human Interface Guidelines explain that material creates depth and separation; regular materials are more appropriate where text-heavy content must remain legible, while clear materials are best over visually rich media. They also caution against overusing Liquid Glass across the content layer. Accordingly, ShikshaSetu uses a more opaque, frosted shared material for information cards and tables, while the vivid gloss and luminous rim are concentrated on surfaces and interactive controls.
   - https://developer.apple.com/design/human-interface-guidelines/materials
   - https://developer.apple.com/documentation/technologyoverviews/liquid-glass
3. **Backdrop compositing.** MDN notes that `backdrop-filter` only reveals the area behind an element when the element background is transparent or partially transparent. Both themes therefore use alpha-driven gradient layers, blur, and saturation rather than opaque fills that would hide the nature scene.
   - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter
4. **Accessible contrast and focus.** WCAG 2.2 guidance calls for sufficient text contrast and visible focus appearance. The light palette uses deep green ink on pale glass; dark mode uses near-white copy on deep emerald. Focus outlines remain explicit in both themes.
   - https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
   - https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
5. **Reduced motion.** The release respects `prefers-reduced-motion` for the visual transitions.
   - https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using_for_accessibility

## Shared surface map

- **Primary surfaces:** dashboard panels, KPI/stat cards, support cards, AI Admin panels, mentor support panels, feedback/fairness panels, modals, and hero sections.
- **Secondary inset surfaces:** model state, signals, data caveats, empty states, quick actions, training status, metric cells, appearance rows, privacy notes, and mentor-name fields.
- **Tables:** the outer scroll frame, header band, body rows, alternating rows, hover state, dividers, and scrollbar all have matched light/dark treatments. Horizontal scrolling remains available for wide registry data.
- **Account surfaces:** login card, topbar, benefit cards, mentor-name card, email/name/password inputs, password reveal control, tabs, and submit button share the same two-mode material system.

## Files changed

- `styles.css`: app-wide Aero/emerald token definitions and unified card/table/control system.
- `login.css`: matching login and signup material system.
- `assets/moss-surface-aero-light.jpg`: low-contrast light botanical texture derived from the existing moss artwork to avoid dark texture overpowering light mode.

No backend endpoints, persistence logic, model training, academic records, or support-loop decisions were changed in this visual update.

## Validation notes

Source-level CSS parsing, JavaScript syntax, HTML duplicate-ID, gallery asset-count, and ZIP integrity checks are performed for the output package. Actual rendered contrast measurements and full cross-browser screenshot testing require running the frontend in a browser; no such result is claimed here.
