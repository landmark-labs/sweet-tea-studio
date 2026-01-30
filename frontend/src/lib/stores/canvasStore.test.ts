import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { api } from '@/lib/api';

// Mock the API
vi.mock('@/lib/api', () => ({
    api: {
        getCanvases: vi.fn(),
        getCanvas: vi.fn(),
        createCanvas: vi.fn(),
        updateCanvas: vi.fn(),
        deleteCanvas: vi.fn(),
    },
}));

describe('canvasStore', () => {
    beforeEach(() => {
        useCanvasStore.setState({
            canvases: [],
            selectedCanvasId: null,
            snapshotProvider: null,
            snapshotApplier: null,
            isSaving: false,
        });
        vi.clearAllMocks();
    });

    it('should auto-save current canvas when switching to another', async () => {
        const { getState, setState } = useCanvasStore;

        // Setup initial state: We are on canvas 1
        const mockProvider = vi.fn().mockReturnValue({ some: 'data' });
        setState({
            selectedCanvasId: 1,
            snapshotProvider: mockProvider,
            canvases: [{ id: 1, name: 'C1' } as any, { id: 2, name: 'C2' } as any]
        });

        // Mock API responses
        (api.updateCanvas as any).mockResolvedValue({ id: 1, name: 'C1', payload: { some: 'data' } });
        (api.getCanvas as any).mockResolvedValue({ id: 2, name: 'C2', payload: {} });

        // Action: Switch to canvas 2
        await getState().loadCanvas(2);

        // Assert: saveCanvas logic should have triggered (updateCanvas called)
        expect(mockProvider).toHaveBeenCalled();
        expect(api.updateCanvas).toHaveBeenCalledWith(1, expect.objectContaining({
            payload: { some: 'data' }
        }));

        // Assert: We ended up on canvas 2
        expect(getState().selectedCanvasId).toBe(2);
    });

    it('should NOT auto-save if no canvas is currently selected', async () => {
        const { getState, setState } = useCanvasStore;

        // Setup initial state: No canvas selected
        const mockProvider = vi.fn();
        setState({
            selectedCanvasId: null, // Nothing selected
            snapshotProvider: mockProvider,
            canvases: [{ id: 1, name: 'C1' } as any, { id: 2, name: 'C2' } as any]
        });

        // Mock API responses
        (api.getCanvas as any).mockResolvedValue({ id: 2, name: 'C2', payload: {} });

        // Action: Switch to canvas 2
        await getState().loadCanvas(2);

        // Assert: Provider should NOT be called because we didn't have a previous canvas
        expect(mockProvider).not.toHaveBeenCalled();
        expect(api.updateCanvas).not.toHaveBeenCalled();

        // Assert: We ended up on canvas 2
        expect(getState().selectedCanvasId).toBe(2);
    });
});
