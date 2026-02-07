import React, { useRef, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface DraggablePanelProps {
    children: React.ReactNode;
    className?: string;
    defaultPosition?: { x: number; y: number };
    persistenceKey?: string;
}

export function DraggablePanel({ children, className, defaultPosition = { x: 0, y: 0 }, persistenceKey }: DraggablePanelProps) {
    const [position, setPosition] = useState<{ x: number; y: number }>(() => {
        if (persistenceKey) {
            try {
                const saved = localStorage.getItem(persistenceKey);
                if (saved) return JSON.parse(saved);
            } catch (e) {
                console.error("Failed to load panel position", e);
            }
        }
        return defaultPosition;
    });

    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const nodeRef = useRef<HTMLDivElement>(null);
    const clampRafRef = useRef<number | null>(null);

    // Keep track of latest position for event handlers
    const posRef = useRef(position);
    useEffect(() => { posRef.current = position; }, [position]);

    const clampToViewport = useCallback((candidate: { x: number; y: number }) => {
        const node = nodeRef.current;
        if (!node) return candidate;

        const rect = node.getBoundingClientRect();
        const panelWidth = rect.width || node.offsetWidth || 0;
        const panelHeight = rect.height || node.offsetHeight || 0;

        const maxX = Math.max(0, window.innerWidth - panelWidth);
        const maxY = Math.max(0, window.innerHeight - panelHeight);

        return {
            x: Math.max(0, Math.min(candidate.x, maxX)),
            y: Math.max(0, Math.min(candidate.y, maxY)),
        };
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
        // Only allow dragging from direct children or specific handles if needed
        // For now, allow dragging from anywhere in the container that isn't an interactive element
        const target = e.target as HTMLElement;
        if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('button') || target.closest('input')) {
            return;
        }

        setIsDragging(true);
        setDragStart({
            x: e.clientX - position.x,
            y: e.clientY - position.y
        });
        e.stopPropagation();
        e.preventDefault();
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            // Calculate new position
            const newX = e.clientX - dragStart.x;
            const newY = e.clientY - dragStart.y;

            setPosition(clampToViewport({ x: newX, y: newY }));
        };

        const handleMouseUp = () => {
            if (isDragging) {
                if (persistenceKey) {
                    localStorage.setItem(persistenceKey, JSON.stringify(posRef.current));
                }
                setIsDragging(false);
            }
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [clampToViewport, isDragging, dragStart, persistenceKey]);

    useEffect(() => {
        const scheduleClamp = () => {
            if (clampRafRef.current !== null) {
                cancelAnimationFrame(clampRafRef.current);
            }
            clampRafRef.current = requestAnimationFrame(() => {
                clampRafRef.current = null;
                setPosition((prev) => {
                    const next = clampToViewport(prev);
                    if (next.x === prev.x && next.y === prev.y) return prev;
                    if (persistenceKey) {
                        localStorage.setItem(persistenceKey, JSON.stringify(next));
                    }
                    return next;
                });
            });
        };

        scheduleClamp();
        window.addEventListener("resize", scheduleClamp, { passive: true });

        const node = nodeRef.current;
        const resizeObserver = (typeof ResizeObserver !== "undefined" && node)
            ? new ResizeObserver(() => scheduleClamp())
            : null;
        if (resizeObserver && node) {
            resizeObserver.observe(node);
        }

        return () => {
            window.removeEventListener("resize", scheduleClamp);
            resizeObserver?.disconnect();
            if (clampRafRef.current !== null) {
                cancelAnimationFrame(clampRafRef.current);
                clampRafRef.current = null;
            }
        };
    }, [clampToViewport, persistenceKey]);

    return (
        <div
            ref={nodeRef}
            className={cn("fixed z-50", className)}
            style={{
                left: position.x,
                top: position.y,
                userSelect: isDragging ? "none" : "auto"
            }}
            onMouseDown={(e) => {
                // Only allow dragging from elements that have data-drag-handle or have cursor-move class
                const target = e.target as HTMLElement;
                const isDragHandle = target.closest('[data-drag-handle]') || target.classList.contains('cursor-move') || target.closest('.cursor-move');
                if (!isDragHandle) return;

                // Don't drag if clicking buttons or inputs
                if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('button') || target.closest('input')) {
                    return;
                }
                handleMouseDown(e);
            }}
        >
            {children}
        </div>
    );
}
