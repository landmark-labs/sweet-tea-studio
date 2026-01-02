import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Brush, Eraser, Loader2, Move, Redo, RotateCcw, Save, Trash2, Undo, ZoomIn, ZoomOut } from 'lucide-react';

interface InpaintEditorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    imageUrl: string;
    onSave: (maskFile: File) => Promise<void>;
}

const HISTORY_LIMIT = 30;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

type Tool = "brush" | "eraser" | "pan";

export function InpaintEditor({ open, onOpenChange, imageUrl, onSave }: InpaintEditorProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const patternRef = useRef<CanvasPattern | null>(null);

    const [tool, setTool] = useState<Tool>("brush");
    const [brushSize, setBrushSize] = useState(30);
    const [invertOutput, setInvertOutput] = useState(false);
    const [filename, setFilename] = useState("mask.png");

    const [isDrawing, setIsDrawing] = useState(false);
    const [isPanning, setIsPanning] = useState(false);
    const panStartRef = useRef<{ x: number; y: number } | null>(null);
    const spaceDownRef = useRef(false);

    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });

    const historyRef = useRef<{ stack: ImageData[]; index: number }>({ stack: [], index: -1 });
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [historySize, setHistorySize] = useState(0);

    const [isSaving, setIsSaving] = useState(false);
    const [isReady, setIsReady] = useState(false);

    const canUndo = historyIndex > 0;
    const canRedo = historyIndex >= 0 && historyIndex < historySize - 1;
    const zoomLabel = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);

    const buildDefaultFilename = useCallback(() => {
        let base = "image";
        try {
            if (imageUrl.includes("?path=")) {
                const url = new URL(imageUrl, window.location.origin);
                base = url.searchParams.get("path")?.split(/[\\/]/).pop() || base;
            } else {
                base = imageUrl.split(/[\\/]/).pop() || base;
            }
        } catch {
            base = "image";
        }

        base = base.replace(/\.(png|jpg|jpeg|webp|gif|bmp|tif|tiff)$/i, "");
        if (!base) base = "image";
        return `${base}_mask.png`;
    }, [imageUrl]);

    const isTypingInTextField = useCallback(() => {
        const active = document.activeElement;
        if (!active) return false;
        const tag = active.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea") return true;
        return Boolean((active as HTMLElement).isContentEditable);
    }, []);

    // Initialize canvas + editor state each time the dialog opens.
    useEffect(() => {
        if (!open || !imageUrl || !canvasRef.current || !containerRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        setIsReady(false);

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = imageUrl;
        img.onload = () => {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Build checkered mask pattern (white/gray) for the overlay strokes.
            const tile = document.createElement("canvas");
            tile.width = 16;
            tile.height = 16;
            const tCtx = tile.getContext("2d");
            if (tCtx) {
                tCtx.fillStyle = "#9ca3af";
                tCtx.fillRect(0, 0, 16, 16);
                tCtx.fillStyle = "#ffffff";
                tCtx.fillRect(0, 0, 8, 8);
                tCtx.fillRect(8, 8, 8, 8);
                patternRef.current = ctx.createPattern(tile, "repeat");
            } else {
                patternRef.current = null;
            }

            setTool("brush");
            setBrushSize(30);
            setInvertOutput(false);
            setFilename(buildDefaultFilename());
            setZoom(1);
            setPan({ x: 0, y: 0 });

            setIsDrawing(false);
            setIsPanning(false);
            panStartRef.current = null;
            spaceDownRef.current = false;

            const initial = ctx.getImageData(0, 0, canvas.width, canvas.height);
            historyRef.current = { stack: [initial], index: 0 };
            setHistoryIndex(0);
            setHistorySize(1);
            setIsReady(true);
        };
        img.onerror = () => {
            setIsReady(false);
        };
    }, [open, imageUrl, buildDefaultFilename]);

    const pushHistory = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
        const snapshot = ctx.getImageData(0, 0, w, h);
        const ref = historyRef.current;
        const nextStack = ref.stack.slice(0, ref.index + 1);
        nextStack.push(snapshot);

        const overflow = Math.max(0, nextStack.length - HISTORY_LIMIT);
        const trimmed = overflow > 0 ? nextStack.slice(overflow) : nextStack;
        const nextIndex = trimmed.length - 1;

        historyRef.current = { stack: trimmed, index: nextIndex };
        setHistoryIndex(nextIndex);
        setHistorySize(trimmed.length);
    }, []);

    const handleUndo = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const ref = historyRef.current;
        if (ref.index <= 0) return;

        const nextIndex = ref.index - 1;
        const next = ref.stack[nextIndex];
        if (!next) return;
        ctx.putImageData(next, 0, 0);
        historyRef.current.index = nextIndex;
        setHistoryIndex(nextIndex);
    }, []);

    const handleRedo = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const ref = historyRef.current;
        if (ref.index >= ref.stack.length - 1) return;

        const nextIndex = ref.index + 1;
        const next = ref.stack[nextIndex];
        if (!next) return;
        ctx.putImageData(next, 0, 0);
        historyRef.current.index = nextIndex;
        setHistoryIndex(nextIndex);
    }, []);

    const handleClear = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pushHistory(ctx, canvas.width, canvas.height);
    }, [pushHistory]);

    const zoomBy = useCallback((delta: number, anchor?: { x: number; y: number }) => {
        const viewport = viewportRef.current;
        const rect = viewport?.getBoundingClientRect();
        const cx = rect ? rect.width / 2 : 0;
        const cy = rect ? rect.height / 2 : 0;
        const ax = anchor?.x ?? cx;
        const ay = anchor?.y ?? cy;

        setZoom((prevZoom) => {
            const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom + delta));
            if (nextZoom === prevZoom) return prevZoom;
            const ratio = nextZoom / prevZoom;

            setPan((prevPan) => {
                if (nextZoom === 1) return { x: 0, y: 0 };
                return {
                    x: prevPan.x + (ax - cx - prevPan.x) * (1 - ratio),
                    y: prevPan.y + (ay - cy - prevPan.y) * (1 - ratio),
                };
            });

            return nextZoom;
        });
    }, []);

    const resetView = useCallback(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, []);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const viewport = viewportRef.current;
        const rect = viewport?.getBoundingClientRect();
        const x = rect ? e.clientX - rect.left : undefined;
        const y = rect ? e.clientY - rect.top : undefined;
        const delta = e.deltaY * -0.001;
        if (x === undefined || y === undefined) {
            zoomBy(delta);
            return;
        }
        zoomBy(delta, { x, y });
    }, [zoomBy]);

    // Keyboard shortcuts (scoped to editor open)
    useEffect(() => {
        if (!open) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (isTypingInTextField()) return;

            const key = e.key;
            const lower = key.toLowerCase();
            const meta = e.metaKey || e.ctrlKey;

            if (key === " ") {
                e.preventDefault();
                spaceDownRef.current = true;
            }

            if (meta && lower === "z") {
                e.preventDefault();
                if (e.shiftKey) {
                    handleRedo();
                } else {
                    handleUndo();
                }
                return;
            }

            if (!meta && lower === "b") setTool("brush");
            if (!meta && lower === "e") setTool("eraser");
            if (!meta && lower === "v") setTool("pan");
            if (!meta && lower === "x") setInvertOutput((prev) => !prev);

            if (!meta && key === "[") setBrushSize((prev) => Math.max(1, prev - 2));
            if (!meta && key === "]") setBrushSize((prev) => Math.min(300, prev + 2));
            if (!meta && lower === "0") resetView();
        };

        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === " ") {
                spaceDownRef.current = false;
            }
        };

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [handleRedo, handleUndo, isTypingInTextField, open, resetView]);

    const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isReady || isSaving) return;
        if (e.button !== 0) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        e.preventDefault();
        e.stopPropagation();

        const shouldPan = tool === "pan" || spaceDownRef.current || e.shiftKey;
        if (shouldPan) {
            setIsPanning(true);
            panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
        }

        setIsDrawing(true);

        const { x, y } = getCoordinates(e, canvas);

        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = brushSize;

        if (tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.strokeStyle = "rgba(0,0,0,1)";
            ctx.fillStyle = "rgba(0,0,0,1)";
        } else {
            ctx.globalCompositeOperation = "source-over";
            const pattern = patternRef.current;
            ctx.strokeStyle = pattern ?? "rgba(255,255,255,1)";
            ctx.fillStyle = pattern ?? "rgba(255,255,255,1)";
        }

        // Dot brush: render immediately on pointer down.
        const radius = Math.max(0.5, brushSize / 2);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(x, y);
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isReady || isSaving) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        if (isPanning) {
            e.preventDefault();
            e.stopPropagation();
            const start = panStartRef.current;
            if (!start) return;
            setPan({ x: e.clientX - start.x, y: e.clientY - start.y });
            return;
        }

        if (!isDrawing) return;

        e.preventDefault();
        e.stopPropagation();

        const { x, y } = getCoordinates(e, canvas);

        ctx.lineWidth = brushSize;
        if (tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
        } else {
            ctx.globalCompositeOperation = "source-over";
        }

        ctx.lineTo(x, y);
        ctx.stroke();
    };

    const stopDrawing = (e?: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isReady || isSaving) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        if (isPanning) {
            setIsPanning(false);
            panStartRef.current = null;
            return;
        }

        if (!isDrawing) return;
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        setIsDrawing(false);
        ctx.closePath();
        pushHistory(ctx, canvas.width, canvas.height);
    };

    const getCoordinates = (e: React.PointerEvent, canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const handleSave = async () => {
        if (!isReady) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const safeName = (filename || "mask.png").trim() || "mask.png";
        const finalName = safeName.toLowerCase().endsWith(".png") ? safeName : `${safeName}.png`;

        setIsSaving(true);
        try {
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas context unavailable");

            const w = canvas.width;
            const h = canvas.height;
            const maskData = ctx.getImageData(0, 0, w, h);

            const outCanvas = document.createElement("canvas");
            outCanvas.width = w;
            outCanvas.height = h;
            const outCtx = outCanvas.getContext("2d");
            if (!outCtx) throw new Error("Output context unavailable");

            const out = outCtx.createImageData(w, h);
            const src = maskData.data;
            const dst = out.data;
            for (let i = 0; i < src.length; i += 4) {
                const a = src[i + 3];
                const v = invertOutput ? 255 - a : a;
                dst[i] = v;
                dst[i + 1] = v;
                dst[i + 2] = v;
                dst[i + 3] = 255;
            }
            outCtx.putImageData(out, 0, 0);

            await new Promise<void>((resolve, reject) => {
                outCanvas.toBlob(async (blob) => {
                    try {
                        if (!blob) throw new Error("Failed to encode PNG");
                        const file = new File([blob], finalName, { type: "image/png" });
                        await onSave(file);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }, "image/png");
            });

            onOpenChange(false);
        } catch (e) {
            console.error(e);
            alert("Failed to save mask");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => !isSaving && onOpenChange(val)}>
            <DialogContent className="w-screen h-screen max-w-none max-h-none flex flex-col p-0 gap-0">
                <DialogHeader className="px-4 py-3 border-b bg-white pr-14">
                    <div className="flex items-center gap-3">
                        <DialogTitle className="text-sm">draw mask</DialogTitle>
                        <div className="flex-1 flex justify-center">
                            <div className="flex flex-wrap items-center justify-center gap-2">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-500 tracking-wide">paint =</span>
                                <span className="text-xs text-slate-600">mask</span>
                                <Switch checked={invertOutput} onCheckedChange={setInvertOutput} />
                                <span className="text-xs text-slate-600">keep</span>
                            </div>

                            <div className="hidden md:flex items-center gap-2">
                                <span className="text-[10px] text-slate-500 tracking-wide">file</span>
                                <Input
                                    value={filename}
                                    onChange={(e) => setFilename(e.target.value)}
                                    className="h-8 w-[260px] text-xs"
                                    placeholder="mask.png"
                                />
                            </div>

                            <Button variant="ghost" size="sm" onClick={handleClear} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                                <Trash2 className="w-4 h-4 mr-1" /> clear
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleUndo} disabled={!canUndo}>
                                <Undo className="w-4 h-4 mr-1" /> undo
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleRedo} disabled={!canRedo}>
                                <Redo className="w-4 h-4 mr-1" /> redo
                            </Button>
                            <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-2">
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                save mask
                            </Button>
                            </div>
                        </div>
                    </div>

                    <div className="md:hidden pt-2">
                        <Input
                            value={filename}
                            onChange={(e) => setFilename(e.target.value)}
                            className="h-9 text-xs"
                            placeholder="mask.png"
                        />
                    </div>
                </DialogHeader>

                <div ref={viewportRef} className="flex-1 bg-slate-900/30 backdrop-blur-3xl overflow-hidden relative flex items-center justify-center" onWheel={handleWheel}>
                    <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-white/10 text-white px-3 py-1 rounded-md backdrop-blur-md text-xs font-mono">
                        {zoomLabel}
                    </div>
                    <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => zoomBy(-0.25)}>
                            <ZoomOut className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => zoomBy(0.25)}>
                            <ZoomIn className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={resetView}>
                            <RotateCcw className="w-4 h-4" />
                        </Button>
                    </div>

                    <div
                        ref={containerRef}
                        className="relative select-none"
                        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }}
                    >
                        <img
                            src={imageUrl}
                            alt="Background"
                            className="max-w-[95vw] max-h-[80vh] object-contain block pointer-events-none"
                            draggable={false}
                        />

                        <canvas
                            ref={canvasRef}
                            className="absolute inset-0 w-full h-full touch-none"
                            style={{ opacity: 0.9, cursor: tool === "pan" ? "grab" : "crosshair", pointerEvents: isReady ? "auto" : "none" }}
                            onContextMenu={(e) => e.preventDefault()}
                            onPointerDown={startDrawing}
                            onPointerMove={draw}
                            onPointerUp={stopDrawing}
                            onPointerLeave={stopDrawing}
                            onPointerCancel={stopDrawing}
                        />
                    </div>

                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-white/70 bg-white/10 px-3 py-1 rounded backdrop-blur-md">
                        wheel: zoom (at cursor) | space/shift or <Move className="inline w-3 h-3 mx-1" />: pan | ctrl/cmd+z: undo | ctrl/cmd+shift+z: redo
                    </div>

                    {!isReady && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex items-center gap-2 bg-white/10 text-white px-4 py-2 rounded-md backdrop-blur-md text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" /> loading image…
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 bg-slate-50 border-t flex flex-wrap items-center justify-center gap-4">
                    <div className="flex items-center gap-2 bg-white p-1 rounded-md border shadow-sm">
                        <Button
                            variant={tool === "brush" ? "default" : "ghost"}
                            size="icon"
                            onClick={() => setTool("brush")}
                            className="h-8 w-8"
                            title="brush (b)"
                        >
                            <Brush className="w-4 h-4" />
                        </Button>
                        <Button
                            variant={tool === "eraser" ? "default" : "ghost"}
                            size="icon"
                            onClick={() => setTool("eraser")}
                            className="h-8 w-8"
                            title="eraser (e)"
                        >
                            <Eraser className="w-4 h-4" />
                        </Button>
                        <Button
                            variant={tool === "pan" ? "default" : "ghost"}
                            size="icon"
                            onClick={() => setTool("pan")}
                            className="h-8 w-8"
                            title="pan (v)"
                        >
                            <Move className="w-4 h-4" />
                        </Button>
                    </div>

                    <div className="flex items-center gap-3 w-[320px] max-w-full">
                        <span className="text-xs font-semibold text-slate-500">size</span>
                        <Slider
                            value={[brushSize]}
                            onValueChange={(val) => setBrushSize(val[0] ?? 30)}
                            min={1}
                            max={300}
                            step={1}
                        />
                        <Input
                            type="number"
                            value={brushSize}
                            onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                setBrushSize(Math.min(300, Math.max(1, Math.floor(n))));
                            }}
                            className="h-8 w-20 text-xs font-mono text-right"
                        />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
