import React, { useRef, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Brush, Eraser, Undo, Save, Loader2, Trash2 } from 'lucide-react';

interface InpaintEditorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    imageUrl: string;
    onSave: (maskFile: File) => Promise<void>;
}

export function InpaintEditor({ open, onOpenChange, imageUrl, onSave }: InpaintEditorProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushSize, setBrushSize] = useState([30]);
    const [mode, setMode] = useState<'brush' | 'eraser'>('brush');
    const [history, setHistory] = useState<ImageData[]>([]);
    const [historyStep, setHistoryStep] = useState(-1);
    const [isSaving, setIsSaving] = useState(false);

    // Initialize canvas
    useEffect(() => {
        if (!open || !imageUrl || !canvasRef.current || !containerRef.current) return;
        // Reset history on open (if completely fresh)
        // Note: we might want to keep history if re-opening?
        // For now, assume fresh start or handle it carefully.
        // Actually, if we re-open, we should rely on state. But hooks reset on unmount?
        // Dialog unmounts content?
        // If the component remains mounted but hidden? Radix Dialog can unmount.
        // Let's assume restart.

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = imageUrl;
        img.onload = () => {
            const container = containerRef.current;
            if (!container) return;

            let width = img.naturalWidth;
            let height = img.naturalHeight;

            canvas.width = width;
            canvas.height = height;
            ctx.clearRect(0, 0, width, height);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Initial save (Empty)
            // We need to reset history state here because new image = new dimension = new history invalid
            setHistory([]);
            setHistoryStep(-1);

            // We need to wait for state update? No, just call a specialized init.
            const data = ctx.getImageData(0, 0, width, height);
            setHistory([data]);
            setHistoryStep(0);
        };
    }, [open, imageUrl]);

    const saveHistory = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        const data = ctx.getImageData(0, 0, w, h);
        setHistory(prev => {
            const newHistory = prev.slice(0, historyStep + 1);
            return [...newHistory, data];
        });
        setHistoryStep(prev => prev + 1);
    };

    const handleUndo = () => {
        if (historyStep > 0) {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (canvas && ctx) {
                const prevData = history[historyStep - 1];
                ctx.putImageData(prevData, 0, 0);
                setHistoryStep(prev => prev - 1);
            }
        }
    };

    const handleClear = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            saveHistory(ctx, canvas.width, canvas.height);
        }
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        setIsDrawing(true);
        const { x, y } = getCoordinates(e, canvas);

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineWidth = brushSize[0];
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { x, y } = getCoordinates(e, canvas);

        // Drawing Logic
        if (mode === 'brush') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(255, 255, 255, 1.0)'; // White mask
        } else {
            ctx.globalCompositeOperation = 'destination-out'; // Erase
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        }

        ctx.lineTo(x, y);
        ctx.stroke();
    };

    const stopDrawing = () => {
        if (!isDrawing) return;
        setIsDrawing(false);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
            ctx.closePath();
            saveHistory(ctx, canvas.width, canvas.height);
        }
    };

    const getCoordinates = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const handleSave = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Prompt for filename
        // Default name suggestion
        let defaultName = "mask";
        try {
            // Try to extract from URL if possible, otherwise generic
            const urlParts = imageUrl.split(/[\\/]/);
            const lastPart = urlParts.pop();
            if (lastPart) {
                defaultName = lastPart.split('.')[0] + "_mask";
            }
        } catch (e) { }

        const name = prompt("Enter filename for mask:", defaultName);
        if (!name) return; // Cancelled

        // Append .png if missing
        const finalName = name.toLowerCase().endsWith('.png') ? name : `${name}.png`;

        setIsSaving(true);

        try {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tCtx = tempCanvas.getContext('2d');
            if (!tCtx) throw new Error("Context lost");

            // Fill Black
            tCtx.fillStyle = "black";
            tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

            // Draw Mask (White)
            tCtx.drawImage(canvas, 0, 0);

            // Export
            tempCanvas.toBlob(async (blob) => {
                if (blob) {
                    const file = new File([blob], finalName, { type: "image/png" });
                    await onSave(file);
                    onOpenChange(false);
                }
            }, 'image/png');

        } catch (e) {
            console.error(e);
            alert("Failed to save mask");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => !isSaving && onOpenChange(val)}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-1 gap-0">
                <DialogHeader className="p-4 border-b">
                    <DialogTitle className="flex items-center justify-between">
                        <span>Edit Mask</span>
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={handleClear} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                                <Trash2 className="w-4 h-4 mr-1" /> Clear
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleUndo} disabled={historyStep <= 0}>
                                <Undo className="w-4 h-4 mr-1" /> Undo
                            </Button>
                            <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-2">
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save Mask
                            </Button>
                        </div>
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 bg-slate-900 overflow-hidden relative flex items-center justify-center p-4">
                    <div ref={containerRef} className="relative shadow-2xl border border-slate-700 max-w-full max-h-[60vh]">
                        {/* Background Image */}
                        <img
                            src={imageUrl}
                            alt="Background"
                            className="max-w-full max-h-[60vh] object-contain block select-none pointer-events-none"
                            style={{ opacity: 0.5 }} // Dim background to make white mask visible
                        />

                        {/* Drawing Canvas */}
                        <canvas
                            ref={canvasRef}
                            className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                            onMouseDown={startDrawing}
                            onMouseMove={draw}
                            onMouseUp={stopDrawing}
                            onMouseLeave={stopDrawing}
                            onTouchStart={startDrawing}
                            onTouchMove={draw}
                            onTouchEnd={stopDrawing}
                        />
                    </div>
                </div>

                <div className="p-4 bg-slate-100 border-t flex items-center justify-center gap-6">
                    <div className="flex items-center gap-2 bg-white p-1 rounded-md border shadow-sm">
                        <Button
                            variant={mode === 'brush' ? "default" : "ghost"}
                            size="icon"
                            onClick={() => setMode('brush')}
                            className="h-8 w-8"
                        >
                            <Brush className="w-4 h-4" />
                        </Button>
                        <Button
                            variant={mode === 'eraser' ? "default" : "ghost"}
                            size="icon"
                            onClick={() => setMode('eraser')}
                            className="h-8 w-8"
                        >
                            <Eraser className="w-4 h-4" />
                        </Button>
                    </div>

                    <div className="flex items-center gap-3 w-48">
                        <span className="text-xs font-semibold text-slate-500">Size</span>
                        <Slider
                            value={brushSize}
                            onValueChange={(val) => setBrushSize(val)}
                            min={1}
                            max={100}
                            step={1}
                        />
                        <span className="text-xs w-6 text-right font-mono">{brushSize[0]}</span>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
