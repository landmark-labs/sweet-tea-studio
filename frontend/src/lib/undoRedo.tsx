import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type UndoRedoAction = {
  label: string;
  undo: () => void;
  redo: () => void;
  guardable?: boolean;
};

type UndoRedoContextValue = {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  recordChange: (action: UndoRedoAction) => void;
  registerStateChange: <T>(label: string, previous: T, next: T, apply: (value: T) => void, guardable?: boolean) => void;
  historyLabels: string[];
};

const UndoRedoContext = createContext<UndoRedoContextValue | undefined>(undefined);
const MAX_HISTORY = 50;

export function UndoRedoProvider({ children }: { children: ReactNode }) {
  const [undoStack, setUndoStack] = useState<UndoRedoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoRedoAction[]>([]);
  const restoringRef = useRef(false);

  const recordChange = useCallback((action: UndoRedoAction) => {
    if (restoringRef.current) return;
    setUndoStack((prev) => {
      const next = [...prev, action];
      // Prevent unbounded growth when users edit large prompt payloads
      if (next.length > MAX_HISTORY) {
        return next.slice(next.length - MAX_HISTORY);
      }
      return next;
    });
    setRedoStack([]);
  }, []);

  const registerStateChange = useCallback(<T,>(label: string, previous: T, next: T, apply: (value: T) => void, guardable?: boolean) => {
    if (previous === next) return;
    recordChange({
      label,
      guardable,
      undo: () => {
        restoringRef.current = true;
        apply(previous);
        restoringRef.current = false;
      },
      redo: () => {
        restoringRef.current = true;
        apply(next);
        restoringRef.current = false;
      },
    });
  }, [recordChange]);

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (!prev.length) return prev;
      const action = prev[prev.length - 1];
      if (action.guardable && !confirm("Undo this action? This may not be fully reversible.")) {
        return prev;
      }
      action.undo();
      setRedoStack((redoPrev) => [...redoPrev, action]);
      return prev.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (!prev.length) return prev;
      const action = prev[prev.length - 1];
      action.redo();
      setUndoStack((undoPrev) => [...undoPrev, action]);
      return prev.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
      const isRedo = (event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"));
      if (isUndo) {
        event.preventDefault();
        undo();
      }
      if (isRedo) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const historyLabels = useMemo(() => undoStack.map(a => a.label).reverse(), [undoStack]);

  const value = useMemo(() => ({
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undo,
    redo,
    recordChange,
    registerStateChange,
    historyLabels,
  }), [undoStack.length, redoStack.length, undo, redo, recordChange, registerStateChange, historyLabels]);

  return <UndoRedoContext.Provider value={value}>{children}</UndoRedoContext.Provider>;
}

export function useUndoRedo() {
  const ctx = useContext(UndoRedoContext);
  if (!ctx) {
    throw new Error("useUndoRedo must be used within an UndoRedoProvider");
  }
  return ctx;
}
