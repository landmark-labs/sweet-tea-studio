import { useEffect, useMemo, useState } from "react";
import { Activity, Gauge, HardDrive, ThermometerSun, Zap, X } from "lucide-react";

import { api, SystemMetrics } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { DraggablePanel } from "@/components/ui/draggable-panel";

interface PerformanceHUDProps {
  className?: string;
  refreshMs?: number;
  visible?: boolean;
  onClose?: () => void;
}

export function PerformanceHUD({ className, refreshMs = 3000, visible = true, onClose }: PerformanceHUDProps) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const data = await api.getSystemMetrics();
      setMetrics(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    fetchMetrics();
    const id = setInterval(fetchMetrics, refreshMs);
    return () => {
      clearInterval(id);
    };
  }, [refreshMs, visible]);

  const gpuUsage = useMemo(() => {
    if (!metrics?.gpus?.length) return null;
    return metrics.gpus.map((gpu) => {
      const percent = gpu.memory_total_mb ? (gpu.memory_used_mb / gpu.memory_total_mb) * 100 : 0;
      return { ...gpu, memory_percent: percent };
    });
  }, [metrics]);

  return (
    <DraggablePanel
      persistenceKey="ds_perf_hud_pos"
      defaultPosition={{ x: window.innerWidth - 340, y: window.innerHeight - 400 }}
      className={cn("fixed z-40 w-72", !visible && "hidden", className)}
    >
      <Card className="shadow-xl border-slate-200 bg-white/95 backdrop-blur text-[11px]">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-200 cursor-move">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <Gauge className={cn("w-3 h-3 text-blue-600", loading && "animate-pulse")} />
            performance
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-400">{Math.round(refreshMs / 1000)}s</span>
            {onClose && (
              <button
                onClick={onClose}
                className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600"
                aria-label="Close performance HUD"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div className="p-2 space-y-2 text-slate-700">
          {error && (
            <div className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded p-1.5">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-500">
                <Activity className="w-2.5 h-2.5" /> CPU
              </div>
              <div className="text-sm font-bold text-slate-900">{metrics?.cpu.percent ?? "--"}%</div>
              <div className="text-[9px] text-slate-400">{metrics?.cpu.count ?? 0} threads</div>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-500">
                <HardDrive className="w-2.5 h-2.5" /> RAM
              </div>
              <div className="text-sm font-bold text-slate-900">{metrics?.memory.percent?.toFixed(0) ?? "--"}%</div>
              <div className="text-[9px] text-slate-400">
                {(metrics?.memory.used ? metrics.memory.used / 1024 / 1024 / 1024 : 0).toFixed(1)} /
                {(metrics?.memory.total ? metrics.memory.total / 1024 / 1024 / 1024 : 0).toFixed(1)} GB
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[9px] text-slate-500 uppercase">
              <ThermometerSun className="w-2.5 h-2.5" /> Temp
            </div>
            <div className="text-[10px] text-slate-700">
              {metrics?.temperatures?.cpu ? `${metrics.temperatures.cpu.toFixed(1)}°C` : "n/a"}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-500">
              <Zap className="w-2.5 h-2.5" /> GPUs
            </div>
            {!gpuUsage && !loading && <div className="text-[9px] text-slate-400">No GPU detected.</div>}
            {gpuUsage?.map((gpu) => (
              <div key={gpu.index} className="p-1.5 border border-slate-200 rounded bg-slate-50">
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-800">
                  <span className="truncate max-w-[140px]">{gpu.name}</span>
                  <span className="text-[9px] text-slate-500">{gpu.utilization_percent.toFixed(0)}%</span>
                </div>
                <Progress value={gpu.memory_percent} className="h-1 mt-1" />
                <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                  <span>
                    {gpu.memory_used_mb.toFixed(0)} / {gpu.memory_total_mb.toFixed(0)} MB
                  </span>
                  <span>
                    {gpu.bandwidth_gb_s ? `${gpu.bandwidth_gb_s} GB/s` : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-500">
              <HardDrive className="w-2.5 h-2.5" /> Disk
            </div>
            <div className="text-[10px] text-slate-700">
              {metrics?.disk.bandwidth_mb_s ? `${metrics.disk.bandwidth_mb_s.toFixed(1)} MB/s` : "..."}
            </div>
          </div>
        </div>
      </Card>
    </DraggablePanel>
  );
}

