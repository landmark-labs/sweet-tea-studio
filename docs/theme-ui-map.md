# Theme + UI Color Map

This document maps where Sweet Tea Studio’s UI colors come from (tokens + files), with a focus on the Generation page (“Prompt Studio”).

## Theme Sources (the “truth”)

- **CSS tokens (light + dark)**: `frontend/src/index.css`
  - Light tokens live in `:root`
  - Dark tokens live in `:root.dark`
  - Tokens are exposed to Tailwind via `@theme` so utilities like `bg-background`, `bg-card`, `text-muted-foreground`, `border-border` resolve to CSS variables.
- **Theme mode + custom theme application**: `frontend/src/lib/ThemeContext.tsx`
  - Sets `<html>` classes: `light`, `dark`, or `custom` (plus an `appearance` class of `dark`/`light` for custom themes so Tailwind `dark:` utilities behave correctly).
  - Applies custom theme colors by writing CSS variables to `<html style="--color-…">`.

## Core Tokens Used By The UI

These are the main “structural” tokens you’ll see throughout the app:

- **Surfaces**: `background`, `surface`, `surfaceRaised`, `surfaceOverlay`, `card`, `popover`
- **Text**: `foreground`, `mutedForeground`
- **Brand/State**: `primary`, `secondary`, `accent`, `destructive`
- **Chrome**: `border`, `input`, `ring`
- **Interaction**: `hover`, `active`

If dark mode still looks “too light”, start by tuning the dark values in `frontend/src/index.css`.

## Generation Page (Prompt Studio) — UI → File Map

### App shell (header + nav)

- **Top header / global chrome**: `frontend/src/components/Layout.tsx`
  - Uses tokenized surfaces (`bg-surface`, `bg-card`, `bg-muted`) and token borders/text.
- **Engine status / indicators**: `frontend/src/components/ConnectionIndicator.tsx`, `frontend/src/components/ComfyUIControl.tsx`

### Left column: Prompt Builder (Prompt Constructor)

- **Prompt Builder panel & editor**: `frontend/src/components/PromptConstructor.tsx`
  - Structural colors should be token-based (`bg-card`, `bg-surface-raised`, `border-border`, `text-muted-foreground`).
  - “Snippet chip” colors are intentionally tinted for visual grouping.
- **Quick prompt library panel (floating)**: `frontend/src/components/PromptLibraryQuickPanel.tsx`

### Left column: Configurator (node params + generate)

- **Configurator container + orchestration**: `frontend/src/pages/PromptStudio.tsx`
- **Dynamic node form rendering**: `frontend/src/components/DynamicForm.tsx`
- **Inputs/controls styling (shared)**:
  - `frontend/src/components/ui/input.tsx`
  - `frontend/src/components/ui/textarea.tsx`
  - `frontend/src/components/ui/select.tsx`
  - `frontend/src/components/ui/alert.tsx`
  - `frontend/src/components/ui/progress.tsx`

### Center: Preview / Image Viewer

- **Image preview + metadata panels + context menus**: `frontend/src/components/ImageViewer.tsx`
  - Viewer background uses a darker “canvas” treatment; metadata/panels use token surfaces.

### Right: Gallery / Library panels

- **Project gallery panel**: `frontend/src/components/ProjectGallery.tsx`
- **Media tray (drag/drop selections)**: `frontend/src/components/MediaTray.tsx`
- **Generation status card (live preview)**: `frontend/src/components/GenerationFeed.tsx`

## Extending Dark Mode To Other Pages

Most pages should rely on the same structural tokens (`bg-background`, `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`) so:

1. Built-in **Dark** mode stays consistent.
2. **Custom themes** can override the CSS variables and still affect all pages.

If you find a page still “stuck in light colors”, search for hardcoded Tailwind grays (e.g. `bg-white`, `bg-slate-*`, `text-slate-*`) and replace with token utilities.

