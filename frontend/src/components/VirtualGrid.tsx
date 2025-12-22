import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type RowHeight = number | ((columnWidth: number) => number);

interface VirtualGridProps<T> {
    items: T[];
    columnCount: number;
    rowHeight: RowHeight;
    gap?: number;
    overscan?: number;
    padding?: number;
    className?: string;
    virtualize?: boolean;
    renderItem: (item: T, index: number) => React.ReactNode;
    getKey?: (item: T, index: number) => React.Key;
    emptyState?: React.ReactNode;
}

export function VirtualGrid<T>({
    items,
    columnCount,
    rowHeight,
    gap = 0,
    overscan = 2,
    padding = 0,
    className,
    virtualize = true,
    renderItem,
    getKey,
    emptyState,
}: VirtualGridProps<T>) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [scrollTop, setScrollTop] = useState(0);
    const rafRef = useRef<number | null>(null);

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;

        const updateSize = () => {
            setViewport({
                width: el.clientWidth,
                height: el.clientHeight,
            });
        };

        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, []);

    const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
        const next = event.currentTarget.scrollTop;
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = requestAnimationFrame(() => {
            setScrollTop((prev) => (prev === next ? prev : next));
        });
    };

    const layout = useMemo(() => {
        const safeColumns = Math.max(1, columnCount);
        const usableWidth = Math.max(0, viewport.width - padding * 2);
        const columnWidth = safeColumns > 0
            ? Math.max(0, (usableWidth - gap * (safeColumns - 1)) / safeColumns)
            : 0;
        const resolvedRowHeight = typeof rowHeight === "function" ? rowHeight(columnWidth) : rowHeight;
        const rowStride = resolvedRowHeight + gap;
        const totalRows = safeColumns > 0 ? Math.ceil(items.length / safeColumns) : 0;
        const totalHeight = totalRows > 0 ? totalRows * rowStride - gap + padding * 2 : padding * 2;

        const hasStride = rowStride > 0 && viewport.height > 0;
        const startRow = virtualize && hasStride
            ? Math.max(0, Math.floor(scrollTop / rowStride) - overscan)
            : 0;
        const endRow = virtualize && hasStride
            ? Math.min(totalRows - 1, Math.ceil((scrollTop + viewport.height) / rowStride) + overscan)
            : Math.max(0, totalRows - 1);

        const startIndex = startRow * safeColumns;
        const endIndex = Math.min(items.length - 1, (endRow + 1) * safeColumns - 1);

        return {
            safeColumns,
            columnWidth,
            resolvedRowHeight,
            rowStride,
            totalRows,
            totalHeight,
            startRow,
            endRow,
            startIndex,
            endIndex,
        };
    }, [columnCount, gap, items.length, overscan, padding, rowHeight, scrollTop, viewport.height, viewport.width, virtualize]);

    if (items.length === 0) {
        return (
            <div ref={containerRef} className={cn("relative overflow-auto", className)}>
                {emptyState}
            </div>
        );
    }

    const visibleItems = items.slice(layout.startIndex, layout.endIndex + 1);
    const offsetTop = padding + layout.startRow * layout.rowStride;
    const offsetLeft = padding;

    return (
        <div ref={containerRef} className={cn("relative overflow-auto", className)} onScroll={handleScroll}>
            <div style={{ height: layout.totalHeight, position: "relative" }}>
                <div
                    style={{
                        position: "absolute",
                        top: offsetTop,
                        left: offsetLeft,
                        right: offsetLeft,
                        height: (layout.endRow - layout.startRow + 1) * layout.rowStride - gap,
                    }}
                >
                    {visibleItems.map((item, offset) => {
                        const index = layout.startIndex + offset;
                        const rowIndex = Math.floor(index / layout.safeColumns);
                        const colIndex = index % layout.safeColumns;
                        const top = (rowIndex - layout.startRow) * layout.rowStride;
                        const left = colIndex * (layout.columnWidth + gap);
                        const key = getKey ? getKey(item, index) : index;

                        return (
                            <div
                                key={key}
                                style={{
                                    position: "absolute",
                                    top,
                                    left,
                                    width: layout.columnWidth,
                                    height: layout.resolvedRowHeight,
                                }}
                            >
                                {renderItem(item, index)}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
