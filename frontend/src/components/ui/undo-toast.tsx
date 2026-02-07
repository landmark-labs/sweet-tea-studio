import React from "react";
import { X, Undo2 } from "lucide-react";

interface UndoToastItem {
    id: string;
    message: string;
    imageIds: number[];
    expiresAt: number;
    durationMs: number;
}

interface UndoToastContextValue {
    showUndoToast: (message: string, imageIds: number[], onUndo: (ids: number[]) => Promise<void>) => void;
}

const UndoToastContext = React.createContext<UndoToastContextValue | null>(null);

export function useUndoToast() {
    const context = React.useContext(UndoToastContext);
    if (!context) {
        throw new Error("useUndoToast must be used within an UndoToastProvider");
    }
    return context;
}

interface UndoToastProviderProps {
    children: React.ReactNode;
    duration?: number; // Default 5000ms
}

export function UndoToastProvider({ children, duration = 5000 }: UndoToastProviderProps) {
    const [toasts, setToasts] = React.useState<UndoToastItem[]>([]);
    const undoHandlersRef = React.useRef<Map<string, (ids: number[]) => Promise<void>>>(new Map());

    const showUndoToast = React.useCallback(
        (message: string, imageIds: number[], onUndo: (ids: number[]) => Promise<void>) => {
            const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const expiresAt = Date.now() + duration;

            undoHandlersRef.current.set(id, onUndo);

            setToasts((prev) => [...prev, { id, message, imageIds, expiresAt, durationMs: duration }]);

            // Auto-dismiss after duration
            setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
                undoHandlersRef.current.delete(id);
            }, duration);
        },
        [duration]
    );

    const handleUndo = React.useCallback(async (toast: UndoToastItem) => {
        const handler = undoHandlersRef.current.get(toast.id);
        if (handler) {
            try {
                await handler(toast.imageIds);
            } catch (err) {
                console.error("Undo failed:", err);
            }
        }
        // Remove toast after undo
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
        undoHandlersRef.current.delete(toast.id);
    }, []);

    const handleDismiss = React.useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        undoHandlersRef.current.delete(id);
    }, []);

    return (
        <UndoToastContext.Provider value={{ showUndoToast }}>
            {children}
            {/* Toast Container */}
            {toasts.length > 0 && (
                <div className="fixed top-20 right-4 z-[200] flex flex-col items-end gap-2 pointer-events-none">
                    {toasts.map((toast) => (
                        <UndoToastItem
                            key={toast.id}
                            toast={toast}
                            onUndo={() => handleUndo(toast)}
                            onDismiss={() => handleDismiss(toast.id)}
                        />
                    ))}
                </div>
            )}
        </UndoToastContext.Provider>
    );
}

interface UndoToastItemProps {
    toast: UndoToastItem;
    onUndo: () => void;
    onDismiss: () => void;
}

function UndoToastItem({ toast, onUndo, onDismiss }: UndoToastItemProps) {
    return (
        <div className="pointer-events-auto border border-border bg-surface text-foreground px-4 py-3 rounded-[var(--radius)] shadow-md flex items-center gap-3 min-w-[280px] max-w-[400px] relative overflow-hidden">
            {/* Progress bar - uses CSS animation instead of JS interval */}
            <div
                className="absolute bottom-0 left-0 h-1 bg-primary"
                style={{
                    width: '100%',
                    animation: `undo-toast-shrink ${toast.durationMs}ms linear forwards`,
                }}
            />
            {/* CSS keyframes for the animation */}
            <style>{`
                @keyframes undo-toast-shrink {
                    from { width: 100%; }
                    to { width: 0%; }
                }
            `}</style>

            <span className="text-sm flex-1">{toast.message}</span>

            <button
                type="button"
                onClick={onUndo}
                className="flex items-center gap-1.5 text-primary hover:text-primary/80 font-medium text-sm transition-colors"
            >
                <Undo2 className="w-4 h-4" />
                Undo
            </button>

            <button
                type="button"
                onClick={onDismiss}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
