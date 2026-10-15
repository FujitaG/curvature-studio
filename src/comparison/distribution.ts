import { CURRENT_SAMPLE_UNIT } from '../math/model';
import { HISTOGRAM_BIN_COUNT } from '../export/histogram';
import type { MetricMode } from '../state/types';
export function comparisonDistribution(inputs: number[][], metric: MetricMode, mode: 'share' | 'count') {
    const min = metric === 'keff' ? 0 : -1, max = 1, size = HISTOGRAM_BIN_COUNT;
    const series = inputs.map(input => {
        const values = input.filter(Number.isFinite), counts = Array<number>(size).fill(0);
        for (const value of values)
            counts[Math.max(0, Math.min(size - 1, Math.floor((value - min) / (max - min) * size)))]++;
        return { n: values.length, counts, heights: counts.map(n => mode === 'share' ? (values.length ? n / values.length * 100 : 0) : n) };
    });
    const peak = Math.max(0, ...series.flatMap(s => s.heights));
    const upper = peak === 0 ? (mode === 'share' ? 100 : 1) : mode === 'share' ? Math.min(100, Math.ceil(peak / 10) * 10) : Math.ceil(peak);
    return { min, max, series, upper, size, sampleUnit: CURRENT_SAMPLE_UNIT };
}
