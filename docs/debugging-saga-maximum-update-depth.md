# Debugging Saga: Maximum Update Depth Exceeded

**Date**: December 14, 2024  
**Resolution**: Reverted to commit `fd78bc7`  
**Status**: ✅ Resolved (by reverting all changes)

---

## Executive Summary

This document chronicles a multi-hour debugging session attempting to fix a "Maximum update depth exceeded" React error in Sweet Tea Studio. Despite extensive investigation and multiple fix attempts, **all changes introduced new bugs**. The session concluded with a full revert to the last known stable commit, which paradoxically also fixed the original error that triggered the investigation.

**Key Lesson**: The original error may have been transient or caused by a different root cause than what was investigated. Over-engineering fixes for unclear bugs can cascade into worse problems.

---

## Initial Problem Statement

**Error**: `Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate.`

**Stack Trace**:
```
at setRef (chunk-TJASOVHW.js)
at Array.map
at setRef
→ Infinite loop in <button> component
```

**Component Stack** (pointed to):
- `UndoRedoProvider` at `undoRedo.tsx:5:36`
- `SelectTrigger` → `PopperAnchor` → `Primitive.button`
- Various Radix UI primitives

---

## Investigation Timeline

### Phase 1: Polling Mechanism (Incorrect Hypothesis)

**Initial diagnosis**: Three potential culprits in the polling system:

1. Unconditional `setState(globalState)` calls within `useEffect`
2. Visibility listeners incorrectly added/removed
3. Unstable `refresh` function reference causing `useEffect` loops

**Actions taken**:
- Rewrote `usePolling.ts` with a "known-good" scheduler pattern
- Implemented single scheduling point in `finally` block
- Added hard floor on delay with `clampDelay` (1000ms-20000ms)
- Changed from `setInterval` to `setTimeout` for exponential backoff
- Added `stopped` flag for clean start/stop semantics
- Made `refresh` function stable with `useMemo`

**Commit**: `d518a15` - "fix: rewrite polling with known-good scheduler pattern"

**Result**: ❌ Error persisted. Polling was not the cause.

---

### Phase 2: PromptConstructor Reconciliation (Partial Diagnosis)

**New diagnosis**: Post-polling, the error still occurred. Stack trace analysis revealed:

- `setRef → Array.map → setRef` pattern
- Error occurred specifically when clicking a prompt text box in PromptStudio
- This sets `targetField` which activates PromptConstructor reconciliation

**Discovery**: The reconciliation effect had `library` in its dependency array:
```typescript
}, [currentValues[targetField], targetField, library, isTargetValid]);
```

When snippets failed to load (404 from `/api/v1/snippets`), then fell back to localStorage, library changed → reconciliation re-ran → generated new item IDs → triggered compile effect → loop.

**Fix attempt**: Added `libraryRef` pattern:
```typescript
const libraryRef = useRef(library);
useEffect(() => { libraryRef.current = library; }, [library]);
// Remove library from dependencies, use libraryRef.current inside effect
```

**Commit**: `13810bd` - "fix: use libraryRef to prevent reconciliation cascade on library change"

**Result**: ❌ Error persisted. Not the root cause.

---

### Phase 3: registerStateChange During Render (Correct Identification)

**New error message discovered**:
```
Cannot update a component (`UndoRedoProvider`) while rendering a different component (`PromptConstructor2`).
```

This is explicit: **setState was being called during render**, not in an effect.

**Root cause found**: `registerStateChange` was called **inside a `setFieldItems` updater function**:

```typescript
// BROKEN CODE
setFieldItems(prev => {
    const previousItems = prev[targetField] || [];
    const resolved = ...;
    if (record) {
        registerStateChange(...); // ❌ Triggers setState in UndoRedoProvider!
    }
    return { ... };
});
```

React anti-pattern: You cannot call external setState (from a different component) inside another component's setState updater.

**Fix**: Moved `registerStateChange` outside the updater:
```typescript
// FIXED CODE
const previousItems = fieldItems[targetField] || [];
const resolved = ...;
if (record) {
    registerStateChange(...); // Before state update
}
setFieldItems(prev => ({ ...prev, [targetField]: resolved }));
```

**Commit**: `b448177` - "fix: move registerStateChange outside setState updater to prevent render loop"

**Result**: ❌ Error persisted. Still not the root cause!

---

### Phase 4: registerStateChange Disabled (Isolation Test)

**Test**: Completely disabled `registerStateChange` call to confirm it was the cause.

```typescript
// TEMPORARILY DISABLED
// if (record) {
//     registerStateChange(label, previousItems, resolved, (val) => applyItems(targetField, val));
// }
```

**Commit**: `dac19a2` - "temp: disable registerStateChange to diagnose infinite loop"

**Result**: ❌ Error STILL persisted! This proved undo/redo was NOT the cause.

---

### Phase 5: React 19 + Radix UI Incompatibility (Final Diagnosis)

With registerStateChange disabled, the error still occurred. This confirmed the issue was **internal to Radix UI**.

**Stack trace analysis**:
```
at button
at Primitive.button
at SlotClone (chunk-TJASOVHW.js)
at Slot
at Primitive.div
at PopperAnchor
at SelectTrigger (@radix-ui_react-select.js:174)
```

**The problem**: `@radix-ui/react-compose-refs` (bundled in Vite as `chunk-TJASOVHW.js`) uses internal ref composition that conflicts with React 19's updated ref handling.

**Versions**:
- React: 19.2.0
- @radix-ui/react-select: 2.2.6
- @radix-ui/react-compose-refs: 1.1.2

**Web search confirmed**: This is a known React 19 + Radix UI compatibility issue. The `composeRefs` function internally triggers `setState` during ref attachment, which React 19 handles differently than React 18.

---

### Phase 6: Attempted Workarounds

#### Attempt 1: Remove `asChild` from SelectPrimitive.Icon

**Hypothesis**: The `asChild` prop uses SlotClone → composeRefs internally.

**Change**:
```diff
- <SelectPrimitive.Icon asChild>
+ <SelectPrimitive.Icon className="ml-2">
```

**Commit**: `b470fcc` - "fix: remove asChild from SelectPrimitive.Icon to avoid React 19 setRef loop"

**Result**: ❌ Error persisted. The internal SelectTrigger also uses PopperAnchor with asChild.

#### Attempt 2: Replace Radix Select with Native HTML Select

**Hypothesis**: Avoid Radix entirely for Select components.

**Implementation**: Created a native HTML select wrapper that parses Radix-style JSX syntax and renders native `<select>` + `<option>` elements.

**Commit**: `dae5bb5` - "fix: replace Radix Select with native HTML select to fix React 19 setRef loop"

**Result**: ❌ Broke the entire UI:
- ImageViewer started producing errors
- All form fields got emptied
- Prompt boxes rapidly flashed (text pasting/deleting loop)
- The native select wrapper didn't correctly extract options from deeply nested JSX

---

## Final Resolution

**Action**: Reverted all changes back to commit `fd78bc7` (last stable commit before the debugging session).

```bash
git reset --hard fd78bc7c7b5ac9093e296f20fb69a2bd256991aa
git push --force
```

**Result**: ✅ ALL issues resolved:
1. ✅ Maximum update depth exceeded - GONE
2. ✅ Snippet editing - WORKING
3. ✅ Image metadata display - WORKING
4. ✅ Form fields - WORKING

---

## Root Cause Analysis (Post-Mortem)

### What We Thought Was Happening

1. Polling mechanism causing infinite re-renders
2. PromptConstructor reconciliation effect triggering cascades
3. registerStateChange being called during render
4. React 19 + Radix UI internal setRef loop

### What Actually Happened

**Unknown**. The original error may have been:
- A transient React StrictMode artifact
- A hot-reload state corruption issue
- A browser cache/Vite cache issue
- Something in a previous debugging session's commits

The error **resolved itself** when we reverted to the stable commit - meaning either:
1. One of the pre-existing commits (not from this session) had introduced the bug
2. The browser/Vite cache was corrupted and the revert + refresh cleared it
3. The error was a race condition that disappeared with the revert

---

## Technical Concepts Encountered

### React Anti-Patterns That Cause Infinite Loops

1. **setState inside setState updater that affects another component**:
   ```typescript
   setStateA(prev => {
       otherComponentSetState(); // ❌ NEVER DO THIS
       return newValue;
   });
   ```

2. **setState inside ref callbacks**:
   ```typescript
   const [ref, setRef] = useState(null); // ❌ Refs should use useRef
   <div ref={setRef} /> // Causes loop
   ```

3. **Unstable dependencies in useEffect**:
   ```typescript
   useEffect(() => {
       setState(something);
   }, [objectThatChangesEveryRender]); // ❌ Infinite loop
   ```

### Radix UI + React 19

- Radix UI uses `@radix-ui/react-compose-refs` for merging multiple refs
- React 19 changed how ref callbacks are invoked during commit phase
- Some Radix components (especially those using `asChild` + `PopperAnchor`) may trigger loops
- **Solution**: Either downgrade to React 18, or wait for Radix to release fully React 19-compatible versions

### Debugging Lessons

1. **Isolate before fixing**: Disable/comment out suspected code before rewriting it
2. **Git bisect is your friend**: When bugs appear mysteriously, bisect to find the offending commit
3. **Don't trust stack traces blindly**: `undoRedo.tsx:5:36` was just because UndoRedoProvider wrapped the app, not because it was the cause
4. **Sometimes the best fix is no fix**: Over-engineering solutions to unclear problems creates more problems

---

## Commits Made (All Reverted)

| Commit | Message | Status |
|--------|---------|--------|
| `d518a15` | fix: rewrite polling with known-good scheduler pattern | ❌ Reverted |
| `13810bd` | fix: use libraryRef to prevent reconciliation cascade | ❌ Reverted |
| `b448177` | fix: move registerStateChange outside setState updater | ❌ Reverted |
| `65ca2f8` | fix: add deep equality check in setItems | ❌ Reverted |
| `dac19a2` | temp: disable registerStateChange to diagnose loop | ❌ Reverted |
| `b470fcc` | fix: remove asChild from SelectPrimitive.Icon | ❌ Reverted |
| `dae5bb5` | fix: replace Radix Select with native HTML select | ❌ Reverted |

**Final state**: Reverted to `fd78bc7` - "fix: skip re-upload when dropped image is already in /input/ directory"

---

## Recommendations

1. **Monitor for recurrence**: If the error returns, use `git bisect` to find the actual offending commit
2. **Consider React 18**: If React 19 + Radix issues persist, downgrading is a reliable fix
3. **Track Radix releases**: Watch for `@radix-ui/react-select` updates that mention React 19 fixes
4. **Test in production build**: Some issues only appear in dev mode due to StrictMode double-rendering

---

## Files That Were Modified (Then Reverted)

- `frontend/src/lib/usePolling.ts` - Rewritten, then reverted
- `frontend/src/components/PromptConstructor.tsx` - Multiple edits, then reverted  
- `frontend/src/components/ui/select.tsx` - Replaced with native, then reverted

All files are now back to their state at commit `fd78bc7`.
