
const scrollPositions = new Map<string, number>();

export const getScrollPosition = (key: string): number => {
    return scrollPositions.get(key) || 0;
};

export const saveScrollPosition = (key: string, pos: number): void => {
    scrollPositions.set(key, pos);
};
