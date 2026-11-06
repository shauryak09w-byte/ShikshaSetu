# ShikshaSetu — Responsive layout audit and backend integration report

**Scope:** AI Admin Console, AI Mentor Support Loop, common glass cards, dated academic trends, follow-up workflow, and manual interpretation persistence. Existing workspace sections, the 24-scene nature gallery, theme controls, glass transparency control, and baseline assessment route are retained.

## 1. Findings from the supplied screenshots

### AI Admin Console

- The student registry is a dense, multi-column record table. Its minimum width exceeds the side-by-side panel width, so hiding overflow would conceal columns. It remains intentionally scrollable, but is now a labelled keyboard-focusable region with a visible moss-toned scrollbar.
- The registry heading and the model/data panel heading share horizontal space with record counts and decorative status icons. Long headings need a shrinkable text column and a wrapping metadata column.
- The model/data coverage rows used a single-line flex row. At narrower widths, the label and value can each retain their intrinsic minimum size and compete for the same line.
- Review status pills and model state copy can be long; their width and wrap behavior are now bounded by the parent card.

### AI Mentor Support Loop

- The five-stage process uses five step nodes and four arrow nodes. Keeping all nine grid columns at intermediate widths compresses step labels and subtitles. The arrow glyphs now disappear at the medium-width breakpoint while the five semantic stages remain in order.
- The early-warning cards used a three-column grid with a non-wrapping status tag. Status text could force the card wider than its grid cell. The tag now wraps safely and moves below the description at narrow widths.
- The auto-run panel combines a long explanation, toggle and action button. The text/action columns now have explicit shrink limits; the action stacks at smaller widths.
- Card headings and explanatory copy have stronger line-height and less aggressive negative letter spacing. This addresses the visually crowded headings in the supplied captures without reducing their content.

## 2. Layout repair strategy

The fix uses intrinsic sizing rather than concealing layout errors:

- Apply `min-width: 0` / `min-inline-size: 0` to shrinkable grid and flex children containing long labels.
- Use `minmax(0, 1fr)` for flexible grid tracks so long descendants do not force the whole grid wider.
- Allow flex rows and status chips to wrap; use bounded metadata widths where a label and value share a row.
- Preserve a deliberate horizontal scroll region for the student registry because it is genuinely tabular data with more columns than a narrow card can display comfortably.
- At tablet and phone widths, collapse the AI Admin two-column layout, convert the workflow strip to five stages, and stack status indicators and training controls.
- Add visible focus and scroll affordances rather than applying `overflow: hidden` to the cards and losing text.

This follows current Chrome layout guidance to use flexible intrinsic sizing, `min-inline-size: 0` on flex children with long content, and to fix overflow at its source rather than hiding it. MDN documents that the default flex `nowrap` behavior can overflow a container and that `overflow-wrap` provides safe breaks for otherwise unbreakable text.

## 3. Natural liquid-glass treatment

The existing moss imagery, theme variables and transparency meter are preserved. The updated surfaces add:

- layered outer shadows and inset highlights to create a soft glass lip;
- a low-contrast moss-green perimeter with a subtle inner edge;
- a restrained hover glow rather than a solid neon outline;
- theme-aware border and shadow values for both light and dark modes;
- existing translucent surface fills and local moss textures, so the transparency slider continues to control the glass appearance.

## 4. Backend integration improvements

### Dated academic trend snapshots

A new transactional route is available:

`POST /api/students/{studentId}/academic-trends`

Example request:

```json
{
  "subject": "Mathematics",
  "previousRecordDate": "2026-08-12",
  "latestRecordDate": "2026-10-20",
  "previousMark": 68.5,
  "latestMark": 54.0,
  "previousAttendance": 91.0,
  "consecutiveAbsences": 2,
  "repeatedFailures": 0,
  "reference": "a-valid-pseudonymous-reference"
}
```

The endpoint validates the real dates and values, then writes a previous and latest `AcademicRecord` pair in one transaction. Both become available through the existing academic-record endpoint and are visible to the feature service when the Random Forest is trained. The UI now requires two actual assessment dates and reloads persisted trend pairs from the backend. Demo mode continues to use local demo storage.

### Follow-up outcomes

The Support Loop now keeps the backend feedback record ID and saves the outcome through the existing `PATCH /api/students/{studentId}/feedback/{feedbackId}/outcome` route. A follow-up no longer appears to be completed only in local browser storage when the server is connected.

### Manual AI Admin interpretations

The console now loads and saves manual interpretations using the existing `/api/ai-admin/interpretations` and `/api/ai-admin/students/{studentId}/interpretations` routes. Backend review notes remain separate from the original score and the controller snapshots the linked assessment. Demo mode remains local.

### Model-state consistency

- The `/api/ai-admin/overview` response now reports the actual loaded model state instead of a fixed “model not connected” string.
- The Support Loop notice updates according to the backend state: demo, rule-based baseline with an untrained model, or trained Weka prototype.
- Risk comparisons now compare snapshots from the same scoring engine. A Random Forest probability and a rule-based support-screening score are different quantities and must not be represented as one continuous score trend.

## 5. Verification performed

- JavaScript syntax checks: passed for `app.js`, `login.js`, and `nature-gallery.js`.
- CSS parser: zero top-level parse errors.
- Dashboard HTML: 190 IDs, no duplicate IDs.
- Nature gallery: all 24 expected WebP image files present.
- Backend source structure: new DTO/controller and dynamic AI Admin model-state injection checked by source inspection.
- Archive integrity and asset count are checked after packaging.

**Not verified:** this environment does not have Maven installed, so a full Spring Boot compile/test run could not be performed here. The Java backend must still be built locally with Java 21 and Maven. An automated cross-browser screenshot pass was also not available; the supplied desktop screenshots guided the CSS audit, and the responsive CSS was statically parsed.

## 6. Run and test locally

From the extracted project folder:

```powershell
cd backend
mvn clean test
mvn spring-boot:run "-Dspring-boot.run.profiles=dev"
```

Open `index.html` with VS Code Live Server. Check the AI Admin Console and AI Mentor Support Loop at viewport widths 360, 390, 640, 768, 1024, 1280, 1440 and 1792 CSS pixels. At narrow widths, use the registry's horizontal scroll region to view every data column.

Before using real student data, add authentication and server-side role enforcement, HTTPS, audit logging, retention/backup controls and institution-specific privacy safeguards. This prototype's development endpoints are not authenticated. Do not use synthetic records or a rule-based risk score as training labels. The Random Forest remains a research prototype until it is trained on approved, labelled longitudinal data and externally/temporally validated.

## 7. External technical references

- Chrome for Developers, *CSS Layouts and Responsive Design*: https://developer.chrome.com/docs/modern-web-guidance/guides/css/css-layout
- MDN, *Mastering wrapping of flex items*: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Flexible_box_layout/Wrapping_items
- MDN, *flex-wrap*: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/flex-wrap
- NIST SP 800-228 update (2026), *Guidelines for API Protection for Cloud-Native Systems*: https://doi.org/10.6028/NIST.SP.800-228-upd1
- OWASP, *REST Security Cheat Sheet*: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
