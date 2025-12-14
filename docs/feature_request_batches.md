# Sweet Tea Studio - Feature Requests & Issues: Batched Implementation Plan

This document organizes 22 feature requests and bug reports into logical batches of 3-5 tasks for sequential implementation. Each batch is designed to minimize code interference and regressions.

---

## Batch 1: Critical Performance & Stability
**Priority: HIGH** | **Risk: Medium-High** | **Dependencies: None**

These issues directly impact app usability and must be addressed first to provide a stable foundation.

| # | Issue | Summary |
|---|-------|---------|
| 2 | Memory Leak | App gets slower over time then crashes. Need to profile, identify leaks (likely event listeners, stale refs, or unbatched re-renders), and fix. |
| 20 | General Performance | Slow page navigation, prompt typing with semi-freezes then bursts. Audit React renders, debounce inputs, optimize heavy components. |
| 17 | Slow JPG Output | Image writing takes 5-7 seconds, pressing generate again seems to interrupt. Investigate async file writing, potentially use a queue or background worker. |

**Approach:**
1. Use React DevTools Profiler and Chrome Memory tools to identify leaks
2. Implement proper cleanup in `useEffect` hooks
3. Consider `React.memo`, `useMemo`, `useCallback` for expensive components
4. Move file writing to a separate async queue that doesn't block generation

---

## Batch 2: Generator Button & Progress System
**Priority: HIGH** | **Risk: Medium** | **Dependencies: Batch 1 (performance fixes may reveal hidden issues)**

Complete overhaul of the generation progress and status tracking system.

| # | Issue | Summary |
|---|-------|---------|
| 15 | Generator Button Architecture | Button is overall buggy, especially with cancelled jobs. Needs architectural rethink: `Generate → Queued → Percentage/Time → Complete → Generate` |
| 5 | Estimated Time Off | Shows thousands of seconds that rapidly decrease. Fix time estimation algorithm. |
| 4 | Generation Statistics | Bring back `it/s`, `s/it`, elapsed, est. duration on generation feed. |

**Approach:**
1. Create a proper state machine for generation states
2. Fix progress callback to provide accurate timing data from ComfyUI
3. Ensure frontend accurately reflects backend state at all times
4. Handle edge cases: cancellation, errors, disconnects gracefully

---

## Batch 3: Prompt & Text Input UX
**Priority: Medium-High** | **Risk: Low-Medium** | **Dependencies: None**

Focus on the prompt input experience - cursor behavior, autocomplete, and snippet rendering.

| # | Issue | Summary |
|---|-------|---------|
| 9 | Cursor Jumping with Snippets | Writing next to snippets randomly moves cursor; clicking in/out of textbox moves cursor. Fix contenteditable/textarea interaction with inline elements. |
| 18 | Autocomplete Issues | 3rd party tags not working; prompt library suggestions too aggressive. Fix tag loading and tune suggestion triggering logic. |
| 19 | Snippet Brick Text Cutoff | Bricks only use 60-70% of width. Adjust CSS/max-width calculations. |
| 7 | Segregated Undo | Inside textbox: undo text. Outside textbox: undo last non-text action. Implement separate undo stacks. |

**Approach:**
1. Debug cursor position logic in `PromptAutocompleteTextarea`
2. Fix 3rd party tag file loading and indexing
3. Add debounce/threshold for prompt library suggestions
4. Implement focus-aware undo system (complex, may need global state)

---

## Batch 4: Image & Prompt Data Model
**Priority: Medium** | **Risk: Medium** | **Dependencies: Batch 3 (prompt handling should be stable first)**

Improvements to how images and prompts are identified, linked, and used.

| # | Issue | Summary |
|---|-------|---------|
| 0 | Prompt Identification | Reliably identify and manage positive/negative prompts, especially with multiple in a workflow. May need workflow metadata or node annotation. |
| 1 | Use in Pipe | Should put image as input AND set positive/negative prompts. Requires prompt identification (issue 0). |
| 8 | Nested Generation Info | For img2img chains, nest original image's gen info inside output's gen info. Recursive metadata structure. |
| 10 | Drag-Drop Timing Issues | Hard to drag new image onto existing image input. Fix drop zone detection and event handling. |

**Approach:**
1. Define a reliable strategy for prompt node identification (naming convention, node type, or explicit annotation)
2. Store prompt IDs in generation metadata
3. Enhance "use in pipe" to pull prompts from metadata
4. Create nested metadata schema for img2img chains

---

## Batch 5: Workflow Import & Configurator
**Priority: Medium** | **Risk: Medium-High** | **Dependencies: None**

Issues with workflow parsing, node handling, and configuration persistence.

| # | Issue | Summary |
|---|-------|---------|
| 12 | Nodes Excluded on Import | Trivial nodes being excluded during pipe setup. Is this intentional logic or a bug? Document or fix. |
| 21 | Parameter Swapping | Consecutive nodes of same type get parameters randomly swapped during import. Fix node identification/ordering logic. |
| 11 | Default Values Failing | Defaults sometimes don't populate in configurator; values forgotten on navigation. Particularly scheduler selector. |
| 6 | ComfyUI Settings Not Saving | Folder path and launch arguments don't persist. Fix settings storage/retrieval. |

**Approach:**
1. Audit workflow import logic for node filtering rules
2. Ensure stable node ordering during import (use node IDs, not positions)
3. Debug configurator state persistence (localStorage, React state, or backend)
4. Fix ComfyUI settings API endpoints and state sync

---

## Batch 6: Gallery Features & UX
**Priority: Medium** | **Risk: Low** | **Dependencies: Batch 1 (stability), Batch 4 (metadata)**

Enhancements to the project gallery for better image management.

| # | Issue | Summary |
|---|-------|---------|
| 3 | Right-Click Context Menu | Add copy, move, use in pipe options for gallery images. |
| 13 | Sticky Selection Buttons | In multi-select mode, delete/clear/exit buttons should follow scroll (sticky positioning). |
| 14 | Subfolder View | Allow viewing specific subfolders for a project in gallery. |

**Approach:**
1. Implement context menu component with image-aware actions
2. Add `position: sticky` or floating action bar for multi-select
3. Add folder navigation/filter to gallery API and UI

---

## Batch 7: Error Handling & Messaging
**Priority: Medium** | **Risk: Low** | **Dependencies: Batches 2 & 5**

Ensure errors surface properly to the user.

| # | Issue | Summary |
|---|-------|---------|
| 16 | Configurator Error Messages | Missing parameter errors not surfacing; only see connection errors. Fix error propagation from backend to frontend. |

**Approach:**
1. Audit backend error responses for configurator validation
2. Ensure frontend displays all error types, not just connection errors
3. Add toast/notification system if not already present

---

## Recommended Execution Order

```
Batch 1 (Performance) 
    ↓
Batch 2 (Generator Button) ← Most user-visible improvement after stability
    ↓
Batch 5 (Workflow/Configurator) ← Foundation for proper data handling
    ↓
Batch 4 (Image/Prompt Model) ← Depends on stable config & metadata
    ↓
Batch 3 (Prompt Input UX) ← Can be parallelized after Batch 1
    ↓
Batch 6 (Gallery) ← Lower priority, easier after data model is solid
    ↓
Batch 7 (Errors) ← Final polish after other systems are stable
```

---

## Quick Reference: Issue to Batch Mapping

| Issue # | Description | Batch |
|---------|-------------|-------|
| 0 | Prompt identification | 4 |
| 1 | Use in pipe | 4 |
| 2 | Memory leak | 1 |
| 3 | Gallery right-click menu | 6 |
| 4 | Generation statistics | 2 |
| 5 | Estimated time off | 2 |
| 6 | ComfyUI settings not saving | 5 |
| 7 | Segregated undo | 3 |
| 8 | Nested generation info | 4 |
| 9 | Cursor jumping with snippets | 3 |
| 10 | Drag-drop timing | 4 |
| 11 | Default values failing | 5 |
| 12 | Nodes excluded on import | 5 |
| 13 | Sticky selection buttons | 6 |
| 14 | Subfolder view | 6 |
| 15 | Generator button architecture | 2 |
| 16 | Configurator error messages | 7 |
| 17 | Slow JPG output | 1 |
| 18 | Autocomplete issues | 3 |
| 19 | Snippet brick text cutoff | 3 |
| 20 | General performance | 1 |
| 21 | Parameter swapping on import | 5 |
