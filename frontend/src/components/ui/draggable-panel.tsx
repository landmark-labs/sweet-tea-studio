import React, { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DraggablePanelProps {
    children: React.ReactNode;
    className?: string;
    defaultPosition?: { x: number; y: number };
    persistenceKey?: string;
}

export function DraggablePanel({ children, className, defaultPosition = { x: 0, y: 0 }, persistenceKey }: DraggablePanelProps) {
    const [position, setPosition] = useState(() => {
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

    // Keep track of latest position for event handlers
    const posRef = useRef(position);
    useEffect(() => { posRef.current = position; }, [position]);

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
            const newX = e.clientX - dragStart.x;
            const newY = e.clientY - dragStart.y;
            setPosition({ x: newX, y: newY });
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
    }, [isDragging, dragStart, persistenceKey]);

    return (
        <div
            ref={nodeRef}
            className={cn("fixed z-50", className)}
            style={{
                left: position.x,
                top: position.y,
                userSelect: "none"
            }}
        >
            {/* Drag Handle - Only visible header area is draggable */}
            <div
                className="cursor-move"
                onMouseDown={handleMouseDown}
            >
                {children}
            </div>
        </div>
    );
}
