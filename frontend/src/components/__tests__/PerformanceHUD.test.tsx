import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { PerformanceHUD } from "@/components/PerformanceHUD";

const mockMetrics = {
  cpu: { percent: 12, count: 16 },
  memory: { total: 1024 * 1024 * 1024, used: 512 * 1024 * 1024, available: 512 * 1024 * 1024, percent: 50 },
  disk: { read_bytes: 0, write_bytes: 0, bandwidth_mb_s: 12.5 },
  temperatures: { cpu: 60 },
  gpus: [
    {
      index: 0,
      name: "Test GPU",
      memory_total_mb: 16384,
      memory_used_mb: 4096,
      utilization_percent: 24,
      temperature_c: 65,
      pcie_generation: 4,
      pcie_width: 16,
      bandwidth_gb_s: 30,
    },
  ],
};

describe("PerformanceHUD", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: () => Promise.resolve(mockMetrics) } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders metrics and updates on interval", async () => {
    render(<PerformanceHUD refreshMs={50} />);

    expect(await screen.findByText(/performance/i)).toBeInTheDocument();
    expect(await screen.findByText(/Test GPU/)).toBeInTheDocument();
    expect(await screen.findByText(/50%/)).toBeInTheDocument();

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it("shows fallback when GPUs are missing", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ...mockMetrics, gpus: [] }) } as Response);

    render(<PerformanceHUD refreshMs={50} />);

    await waitFor(() => expect(screen.getByText(/No GPU detected/i)).toBeInTheDocument());
  });
});
