import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export type ChartOption = echarts.EChartsCoreOption;

/** Diagramm-Tokens: eine Serienfarbe, Text in Textfarben, zurückhaltende Gitterlinien. */
export const VIZ = {
  series: '#2a78d6',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  grid: '#e7e6e2',
  surface: '#ffffff',
};

export function EChart({ option, height }: { option: ChartOption; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    const observer = new ResizeObserver(() => chart.current?.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} style={{ height, width: '100%' }} />;
}

const tooltipBase = {
  backgroundColor: '#ffffff',
  borderColor: VIZ.grid,
  textStyle: { color: VIZ.textPrimary, fontSize: 13 },
  extraCssText: 'border-radius:12px;box-shadow:0 4px 16px rgba(15,23,42,.12);',
};

/** Waagerechte Balken für Ranglisten (Produkte, Bedienungen …), Wert an der Balkenspitze. */
export function rankingOption(rows: { label: string; value: number }[], format: (v: number) => string): ChartOption {
  const data = [...rows].reverse();
  return {
    animation: false,
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipBase,
      trigger: 'item',
      formatter: (p: { name: string; value: number }) => `${p.name}<br/><b>${format(p.value)}</b>`,
    },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: VIZ.grid, width: 1 } },
      axisLabel: { color: VIZ.textSecondary },
      minInterval: 1,
    },
    yAxis: {
      type: 'category',
      data: data.map((r) => r.label),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: VIZ.grid } },
      axisLabel: { color: VIZ.textPrimary, width: 140, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: data.map((r) => r.value),
        barMaxWidth: 18,
        itemStyle: { color: VIZ.series, borderRadius: [0, 4, 4, 0] },
        emphasis: { itemStyle: { color: '#256abf' } },
        label: { show: true, position: 'right', color: VIZ.textSecondary, formatter: (p: { value: number }) => format(p.value) },
      },
    ],
  };
}

/** Säulen über die Zeit (15-Minuten-Fenster). */
export function timelineOption(points: { label: string; value: number }[], unit: string): ChartOption {
  return {
    animation: false,
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(42,120,214,0.08)' } },
      formatter: (params: { name: string; value: number }[]) => `${params[0].name} Uhr<br/><b>${params[0].value} ${unit}</b>`,
    },
    xAxis: {
      type: 'category',
      data: points.map((p) => p.label),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: VIZ.grid } },
      axisLabel: { color: VIZ.textSecondary },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: VIZ.grid, width: 1 } },
      axisLabel: { color: VIZ.textSecondary },
    },
    series: [
      {
        type: 'bar',
        data: points.map((p) => p.value),
        barMaxWidth: 24,
        barCategoryGap: '20%',
        itemStyle: { color: VIZ.series, borderRadius: [4, 4, 0, 0] },
        emphasis: { itemStyle: { color: '#256abf' } },
      },
    ],
  };
}
