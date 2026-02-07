# UI Overhaul Plan (ChatGPT-Style Refresh)

## Scope + constraints
- Goal: restyle Sweet Tea Studio to align with ChatGPT web UI visual language, using `ref*.png` screenshots as ground truth.
- Hard constraint preserved: Sweet Tea Studio logo assets in top-left were kept unchanged (same files, no recolor/redraw/distortion).
- Modes implemented: light + dark.
- Typography switched to Segoe-first stack across app.
- Functional behavior preserved; changes focused on visual system, component styling, layout rhythm, and interaction states.

## Reference audit (`ref*.png`)
- `ref1.png`: conversational canvas with low-noise neutrals, thin borders, soft sidebar contrast, compact controls.
- `ref2.png`: settings modal language (flat surfaces, subtle separators, restrained controls, high legibility).
- `ref3.png`: dark mode depth model (near-black base, charcoal surfaces, restrained blue accent, quiet outlines).

## Screenshot mapping table (`Screenshot*.png`)
| Screenshot file | View / route | Key regions/components updated |
|---|---|---|
| `Screenshot 2026-02-06 210807.png` | Generation workspace (`/`) with context menu + quick prompt library + floating feed + HUD | App shell, top controls, prompt constructor cards, configurator panels, gallery rail, context menu, floating panel chrome, HUD card treatment |
| `Screenshot 2026-02-06 210951.png` | Projects (`/projects`) + Manage Folders modal | Modal shell, list rows, destructive/icon actions, text fields, backdrop, card spacing/borders |
| `Screenshot 2026-02-06 211003.png` | Pipes library (`/pipes`) | Pipe cards, chip/badge styles, toolbar buttons, grid rhythm, sidebar/nav consistency |
| `Screenshot 2026-02-06 211053.png` | Projects (`/projects`) | Project cards, metadata rows, heading hierarchy, page spacing, action button styling |
| `Screenshot 2026-02-06 211302.png` | Pipe editor (`/pipes` editor state) | Left editor pane, dynamic form fields, node groups, table-like rows, inline actions, selected/expanded states |
| `Screenshot 2026-02-06 211645.png` | Pipe editor (`/pipes`) + Manage Nodes modal | Modal list cards, visibility/bypass toggles, active row emphasis, close actions |
| `Screenshot 2026-02-06 211841.png` | Gallery (`/gallery`) with selected cards and metadata flyout | Gallery grid cards, sidebar tree, bulk-action toolbar, selected outlines, metadata panel styling |
| `Screenshot 2026-02-06 211946.png` | Models (`/models`) | Split panels, folder browser, download form, queue panel, installed-models table, search/filter controls |
| `Screenshot 2026-02-06 212017.png` | Gallery image viewer/lightbox | Overlay/backdrop, image stage, bottom action bar, navigation affordances, destructive emphasis |
| `Screenshot 2026-02-06 212032.png` | Prompt Library (`/library`) + metadata details modal | Large preview modal, text sections, copy actions, card spacing, overlay consistency |
| `Screenshot 2026-02-06 212132.png` | Generation (`/`) dark + media metadata modal | Dark overlay modal tokens, readable text contrasts, input/textarea dark states |
| `Screenshot 2026-02-06 212412.png` | Generation (`/`) dark base with floating tools | Dark app shell, prompt/config cards, floating palette/prompt library/feed visuals, tray/cards |
| `Screenshot 2026-02-06 212553.png` | Settings (`/settings`) dark | Form sections, labels/help text contrast, input fields, primary/secondary button states |

## Design tokens implemented
Implemented as CSS variables in `frontend/src/index.css` and mirrored in built-in theme templates in `frontend/src/lib/ThemeContext.tsx`.

### Light
- `background`: `#f7f7f8`
- `surface`: `#ffffff`
- `surface-raised`: `#f2f3f5`
- `surface-overlay`: `#ffffff`
- `border`: `#dfe3e8`
- `text`: `#202123`
- `muted text`: `#6b7280`
- `accent / primary`: `#3f7cff`
- `danger`: `#dc2626`
- `success`: `#059669`

### Dark
- `background`: `#212121`
- `surface`: `#171717`
- `surface-raised`: `#262626`
- `surface-overlay`: `#2d2d2d`
- `border`: `#3f3f46`
- `text`: `#ececf1`
- `muted text`: `#a1a1aa`
- `accent / primary`: `#5a8dff`
- `danger`: `#ef4444`
- `success`: `#10b981`

### Typography
- Primary stack: `"Segoe UI", "Segoe UI Variable", "Helvetica Neue", Arial, system-ui, sans-serif`
- Body: `14px`, `400`, line-height `1.45`
- Labels/microcopy: `11-12px`, `500-600` depending on context
- Section headings: `16-20px`, `600`, slight negative tracking

### Spacing scale
- Base rhythm variables: `4, 8, 12, 16, 20, 24, 32` px equivalents (`--space-1` ... `--space-8`)
- Applied to page gutters, card padding, modal internals, toolbar grouping, list row density

### Radius + shadow
- Global radius token: `0.9rem`
- Shadows:
  - `--shadow-xs`: hairline elevation
  - `--shadow-sm`: default panel/card elevation
  - `--shadow-md`: modal/elevated/floating surfaces

### Focus/hover/active
- Focus ring:
  - Light: `0 0 0 3px rgb(63 124 255 / 0.28)`
  - Dark: `0 0 0 3px rgb(90 141 255 / 0.35)`
- Hover/active tokens:
  - Light: `#eef1f4` / `#e4e8ee`
  - Dark: `#303036` / `#383841`

## Component overhaul checklist
- [x] Buttons (primary/secondary/ghost/icon/destructive)
- [x] Inputs / textareas / search fields
- [x] Selects and dropdown surfaces
- [x] Context menus
- [x] Tabs/segmented toggle group styling in top shell
- [x] Cards / panels / elevated containers
- [x] Modals / dialogs / overlays
- [x] Lists and tables
- [x] Tooltips
- [x] Toasts / undo toast
- [x] Switches / progress / badges / labels
- [x] Draggable floating panel chrome

## Implementation coverage (code)
- Theme/token foundation:
  - `frontend/src/index.css`
  - `frontend/src/lib/ThemeContext.tsx`
- Shell/navigation:
  - `frontend/src/components/Layout.tsx`
  - `frontend/src/components/StatusBar.tsx`
  - `frontend/src/components/ConnectionIndicator.tsx`
  - `frontend/src/components/ComfyUIControl.tsx`
  - `frontend/src/components/UndoRedoBar.tsx`
- UI primitives:
  - `frontend/src/components/ui/*.tsx` (button/input/textarea/select/dialog/context-menu/card/table/tooltip/alert/badge/popover/switch/progress/label/hover-card/undo-toast/draggable-panel)
- Page-level passes:
  - `frontend/src/features/prompt-studio/PromptStudioPage.tsx`
  - `frontend/src/features/gallery/GalleryPage.tsx`
  - `frontend/src/features/gallery/components/GalleryCardContent.tsx`
  - `frontend/src/features/settings/SettingsPage.tsx`
  - `frontend/src/pages/Projects.tsx`
  - `frontend/src/pages/WorkflowLibrary.tsx`
  - `frontend/src/pages/PromptLibrary.tsx`
  - `frontend/src/pages/Models.tsx`
- Supporting feature components:
  - `frontend/src/components/PromptConstructor.tsx`
  - `frontend/src/components/PromptAutocompleteTextarea.tsx`
  - `frontend/src/components/DynamicForm.tsx`
  - `frontend/src/components/dynamic-form/FieldRenderer.tsx`
  - `frontend/src/components/dynamic-form/NodeGroups.tsx`
  - `frontend/src/components/ProjectSidebar.tsx`
  - `frontend/src/components/ProjectGallery.tsx`
  - `frontend/src/components/MediaTray.tsx`
  - `frontend/src/components/ImageViewer.tsx`
  - `frontend/src/components/MediaMetadataDialog.tsx`
  - `frontend/src/components/MoveImagesDialog.tsx`
  - `frontend/src/components/PromptLibraryQuickPanel.tsx`
  - `frontend/src/components/GenerationFeed.tsx`
  - `frontend/src/components/PerformanceHUD.tsx`
  - `frontend/src/components/ImageUpload.tsx`
  - `frontend/src/components/InpaintEditor.tsx`
  - `frontend/src/components/InstallStatusDialog.tsx`
  - `frontend/src/components/WorkflowGraphViewer.tsx`

## Verification + evidence

### Automated checks run
- `npm run lint` in `frontend`:
  - Result: pass (0 errors, existing warnings remain)
- `npm run test` in `frontend`:
  - Result: pass (9 files, 25 tests)
- `npm run build` in `frontend`:
  - Result: pass

### After-state screenshots
Generated route screenshots (light + dark) in:
- `ui-overhaul-after/after-light-generation.png`
- `ui-overhaul-after/after-light-projects.png`
- `ui-overhaul-after/after-light-pipes.png`
- `ui-overhaul-after/after-light-gallery.png`
- `ui-overhaul-after/after-light-library.png`
- `ui-overhaul-after/after-light-models.png`
- `ui-overhaul-after/after-dark-generation.png`
- `ui-overhaul-after/after-dark-gallery.png`
- `ui-overhaul-after/after-dark-settings.png`
- `ui-overhaul-after/after-dark-models.png`

### Repro checklist
1. Start app dev server:
   - `cd frontend`
   - `npm run dev -- --host 127.0.0.1 --port 4173`
2. Capture screenshots:
   - `node scripts/capture_ui_overhaul.mjs`
3. Review outputs in `ui-overhaul-after/`.

## Tradeoffs / assumptions
- Backend connectivity is environment-dependent; captures may show disconnected engine state but still validate styling/layout consistency.
- Some dense workflow screens intentionally keep existing information architecture to avoid functional regressions while re-skinning nearly all visible UI.
- Existing ESLint warnings were not broadly refactored in this pass to keep scope on UI overhaul and avoid behavior changes.
