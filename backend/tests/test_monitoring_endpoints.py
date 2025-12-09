from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.endpoints import monitoring


class DummyMonitor:
    def __init__(self):
        self.calls = 0

    def get_metrics(self):
        self.calls += 1
        return {
            "cpu": {"percent": 42, "count": 8},
            "memory": {"total": 1024, "used": 512, "available": 512, "percent": 50},
            "temperatures": {"cpu": 65.0},
            "disk": {"read_bytes": 1000, "write_bytes": 2000, "bandwidth_mb_s": 1.5},
            "gpus": [
                {
                    "index": 0,
                    "name": "Mock GPU",
                    "memory_total_mb": 16384,
                    "memory_used_mb": 4096,
                    "utilization_percent": 12,
                    "temperature_c": 70,
                    "pcie_generation": 4,
                    "pcie_width": 16,
                    "bandwidth_gb_s": 31.5,
                }
            ],
        }


def test_monitoring_metrics_endpoint(monkeypatch):
    monitoring.monitor = DummyMonitor()

    app = FastAPI()
    app.include_router(monitoring.router, prefix="/api/v1/monitoring")
    client = TestClient(app)

    resp = client.get("/api/v1/monitoring/metrics")
    assert resp.status_code == 200

    payload = resp.json()
    assert payload["cpu"]["percent"] == 42
    assert payload["gpus"][0]["name"] == "Mock GPU"

    second = client.get("/api/v1/monitoring/metrics")
    assert second.status_code == 200
    assert monitoring.monitor.calls == 2
