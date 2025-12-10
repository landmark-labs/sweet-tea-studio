import { useEffect, useMemo, useState } from "react";
import { Activity, Gauge, HardDrive, ThermometerSun, Zap } from "lucide-react";

import { api, SystemMetrics } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { DraggablePanel } from "@/components/ui/draggable-panel";

interface PerformanceHUDProps {
  className?: string;
  refreshMs?: number;
  visible?: boolean;
}

export function PerformanceHUD({ className, refreshMs = 3000, visible = true }: PerformanceHUDProps) {
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
      defaultPosition={{ x: window.innerWidth - 420, y: window.innerHeight - 500 }}
      className={cn("fixed z-40 w-96", !visible && "hidden", className)}
    >
      <Card className="shadow-xl border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 cursor-move">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Gauge className={cn("w-4 h-4 text-blue-600", loading && "animate-pulse")} />
            Performance HUD
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">refresh {Math.round(refreshMs / 1000)}s</span>
          </div>
        </div>

        <div className="p-4 space-y-3 text-sm text-slate-700">
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                <Activity className="w-3 h-3" /> CPU
              </div>
              <div className="text-lg font-bold text-slate-900">{metrics?.cpu.percent ?? "--"}%</div>
              <div className="text-[11px] text-slate-500">{metrics?.cpu.count ?? 0} threads</div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                <HardDrive className="w-3 h-3" /> RAM
              </div>
              <div className="text-lg font-bold text-slate-900">{metrics?.memory.percent?.toFixed(0) ?? "--"}%</div>
              <div className="text-[11px] text-slate-500">
                {(metrics?.memory.used ? metrics.memory.used / 1024 / 1024 / 1024 : 0).toFixed(1)} /
                {(metrics?.memory.total ? metrics.memory.total / 1024 / 1024 / 1024 : 0).toFixed(1)} GB
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500 uppercase">
              <ThermometerSun className="w-3 h-3" /> Temp
            </div>
            <div className="text-right text-sm text-slate-700">
              {metrics?.temperatures?.cpu ? `${metrics.temperatures.cpu.toFixed(1)}°C` : "n/a"}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
              <Zap className="w-3 h-3" /> GPUs
            </div>
            {!gpuUsage && !loading && <div className="text-xs text-slate-500">No GPU detected.</div>}
            {gpuUsage?.map((gpu) => (
              <div key={gpu.index} className="p-2 border border-slate-200 rounded-md bg-slate-50">
                <div className="flex items-center justify-between text-sm font-semibold text-slate-800">
                  <span>{gpu.name}</span>
                  <span className="text-xs text-slate-500">{gpu.utilization_percent.toFixed(0)}% util</span>
                </div>
                <Progress value={gpu.memory_percent} className="h-1.5 mt-2" />
                <div className="flex justify-between text-[11px] text-slate-500 mt-1">
                  <span>
                    {gpu.memory_used_mb.toFixed(0)} / {gpu.memory_total_mb.toFixed(0)} MB
                  </span>
                  <span>
                    {gpu.bandwidth_gb_s ? `${gpu.bandwidth_gb_s} GB/s` : "link n/a"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
              <HardDrive className="w-3 h-3" /> Disk
            </div>
            <div className="text-sm text-slate-700">
              {metrics?.disk.bandwidth_mb_s ? `${metrics.disk.bandwidth_mb_s.toFixed(2)} MB/s` : "sampling..."}
            </div>
            <div className="text-[11px] text-slate-500">rolling average</div>
          </div>


        </div>
      </Card>
    </DraggablePanel>
  );
}
