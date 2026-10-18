import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  Title,
  Tooltip,
  type ChartConfiguration,
  type Plugin,
} from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, Title);

/** Balkendiagramm der Auswertungen */
export interface ChartSpec {
  title: string;
  /** Waagrechte Balken, z.B. pro Status oder Person */
  horizontal?: boolean;
  stacked?: boolean;
  labels: string[];
  /** Farbe pro Datenreihe oder pro Balken */
  datasets: { label: string; data: number[]; color: string | string[]; stack?: string }[];
}

interface ChartTheme {
  text: string;
  grid: string;
  /** Hintergrund für Exporte (Bildschirm: transparent) */
  background: string | null;
  font: string;
}

/** Feste helle Farben für Bild und PDF, unabhängig vom Dunkelmodus */
const EXPORT_THEME: ChartTheme = {
  text: '#3d4756',
  grid: '#e3e7ed',
  background: '#ffffff',
  font: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
};

function screenTheme(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { text: v('--text-muted', '#5d6879'), grid: v('--border', '#dde1e7'), background: null, font: v('--font', EXPORT_THEME.font) };
}

const backgroundPlugin = (color: string): Plugin<'bar'> => ({
  id: 'background',
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
});

function config(spec: ChartSpec, theme: ChartTheme, exportMode: boolean): ChartConfiguration<'bar'> {
  // Exporte werden verkleinert (z.B. im PDF), deshalb grössere Schrift
  const font = { family: theme.font, size: exportMode ? 20 : 12 };
  const axis = {
    stacked: !!spec.stacked,
    ticks: { color: theme.text, font, precision: 0 },
    grid: { color: theme.grid },
    border: { color: theme.grid },
  };
  return {
    type: 'bar',
    data: {
      labels: spec.labels,
      datasets: spec.datasets.map((d) => ({
        label: d.label,
        data: d.data,
        backgroundColor: d.color,
        stack: d.stack,
        borderRadius: 3,
        maxBarThickness: 40,
      })),
    },
    options: {
      indexAxis: spec.horizontal ? 'y' : 'x',
      responsive: !exportMode,
      maintainAspectRatio: false,
      animation: exportMode ? false : undefined,
      devicePixelRatio: exportMode ? 1 : undefined,
      plugins: {
        title: { display: exportMode, text: spec.title, color: '#1c2330', font: { family: theme.font, size: 26, weight: 'bold' } },
        legend: { display: spec.datasets.length > 1, position: 'bottom', labels: { color: theme.text, boxWidth: 12, font } },
      },
      scales: { x: { ...axis, beginAtZero: true }, y: { ...axis, beginAtZero: true } },
    },
    plugins: theme.background ? [backgroundPlugin(theme.background)] : [],
  };
}

/** Diagramm auf dem Bildschirm (Farben aus dem aktuellen Farbschema) */
export function drawChart(canvas: HTMLCanvasElement, spec: ChartSpec): Chart<'bar'> {
  return new Chart(canvas, config(spec, screenTheme(), false));
}

/** Diagramm als PNG mit Titel und weissem Hintergrund (für Bild- und PDF-Export) */
export function chartImage(spec: ChartSpec, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const chart = new Chart(canvas, config(spec, EXPORT_THEME, true));
  const url = chart.toBase64Image('image/png', 1);
  chart.destroy();
  return url;
}

/** Höhe für waagrechte Balken je nach Anzahl */
export const barChartHeight = (bars: number) => Math.max(120, 60 + bars * 32);
