import subprocess
import time
from typing import Any, Dict, List, Optional

import psutil


PCIE_GENERATION_BANDWIDTH = {
    1: 0.250,
    2: 0.500,
    3: 0.985,
    4: 1.969,
    5: 3.938,
    6: 7.877,
}


class SystemMonitor:
    def __init__(self, sample_interval: float = 2.0):
        self.sample_interval = sample_interval
        self._cache: Optional[Dict[str, Any]] = None
        self._last_sample = 0.0
        self._last_disk_total = 0
        self._last_disk_time = 0.0

    def _estimate_pcie_bandwidth(self, generation: int, width: int) -> Optional[float]:
        per_lane = PCIE_GENERATION_BANDWIDTH.get(generation)
        if not per_lane or not width:
            return None
        return round(per_lane * width, 2)

    def _gpu_metrics(self) -> List[Dict[str, Any]]:
        query = (
            "nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu,"
            "temperature.gpu,pcie.link.gen.current,pcie.link.width.current --format=csv,noheader,nounits"
        )

        try:
            output = subprocess.check_output(query.split(), text=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            return []

        gpus: List[Dict[str, Any]] = []
        for index, line in enumerate(output.strip().splitlines()):
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 7:
                continue

            name, mem_total, mem_used, util, temp, gen, width = parts[:7]

            generation = int(gen) if gen else 0
            link_width = int(width) if width else 0
            bandwidth = self._estimate_pcie_bandwidth(generation, link_width)

            gpus.append(
                {
                    "index": index,
                    "name": name,
                    "memory_total_mb": float(mem_total),
                    "memory_used_mb": float(mem_used),
                    "utilization_percent": float(util),
                    "temperature_c": float(temp) if temp else None,
                    "pcie_generation": generation,
                    "pcie_width": link_width,
                    "bandwidth_gb_s": bandwidth,
                }
            )

        return gpus

    def _cpu_temperature(self) -> Optional[float]:
        try:
            temperatures = psutil.sensors_temperatures()
        except Exception:
            return None

        for entries in temperatures.values():
            if entries:
                return entries[0].current
        return None

    def _disk_bandwidth(self, now: float, read_bytes: int, write_bytes: int) -> Optional[float]:
        current_total = read_bytes + write_bytes

        if self._last_disk_total == 0:
            self._last_disk_total = current_total
            self._last_disk_time = now
            return None

        delta_bytes = current_total - self._last_disk_total
        delta_time = now - self._last_disk_time

        self._last_disk_total = current_total
        self._last_disk_time = now

        if delta_time <= 0:
            return None

        return round(delta_bytes / delta_time / 1024 / 1024, 2)

    def get_metrics(self) -> Dict[str, Any]:
        now = time.monotonic()
        if self._cache and now - self._last_sample < self.sample_interval:
            return self._cache

        cpu_percent = psutil.cpu_percent(interval=None)
        memory = psutil.virtual_memory()
        disk = psutil.disk_io_counters()

        disk_bw = self._disk_bandwidth(now, disk.read_bytes, disk.write_bytes)

        metrics = {
            "timestamp": time.time(),
            "cpu": {"percent": cpu_percent, "count": psutil.cpu_count() or 0},
            "memory": {
                "total": memory.total,
                "available": memory.available,
                "used": memory.used,
                "percent": memory.percent,
            },
            "temperatures": {"cpu": self._cpu_temperature()},
            "disk": {
                "read_bytes": disk.read_bytes,
                "write_bytes": disk.write_bytes,
                "bandwidth_mb_s": disk_bw,
            },
            "gpus": self._gpu_metrics(),
        }

        self._cache = metrics
        self._last_sample = now
        return metrics


monitor = SystemMonitor()
