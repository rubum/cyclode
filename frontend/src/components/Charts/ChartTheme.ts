export interface ChartThemeConfig {
  colors: {
    accent: string;
    green: string;
    yellow: string;
    red: string;
    purple: string;
    bronze: string;
    teal: string;
    palette: string[];
  };
  grid: {
    stroke: string;
    strokeDasharray: string;
  };
  axis: {
    stroke: string;
    tickLine: boolean;
    tick: {
      fill: string;
      fontSize: number;
      fontFamily: string;
    };
  };
  tooltip: {
    contentStyle: React.CSSProperties;
    labelStyle: React.CSSProperties;
    itemStyle: React.CSSProperties;
  };
}

export const CHART_THEME: ChartThemeConfig = {
  colors: {
    accent: '#61AFEF', // Clean OneDark Blue
    green: '#98C379',  // OneDark Emerald
    yellow: '#E5C07B', // OneDark Gold
    red: '#E06C75',    // OneDark Rose
    purple: '#C678DD', // OneDark Violet
    bronze: '#D19A66', // OneDark Bronze / Orange
    teal: '#56B6C2',   // OneDark Cyan / Teal
    palette: [
      '#61AFEF',
      '#98C379',
      '#E5C07B',
      '#C678DD',
      '#56B6C2',
      '#D19A66',
      '#E06C75'
    ]
  },
  grid: {
    stroke: 'rgba(255, 255, 255, 0.07)',
    strokeDasharray: '3 3',
  },
  axis: {
    stroke: 'rgba(255, 255, 255, 0.15)',
    tickLine: false,
    tick: {
      fill: '#CBD5E1',
      fontSize: 11,
      fontFamily: 'JetBrains Mono, Menlo, monospace',
    },
  },
  tooltip: {
    contentStyle: {
      backgroundColor: '#21252B',
      borderColor: '#3E4451',
      borderWidth: 1,
      borderRadius: '8px',
      color: '#CBD5E1',
      fontSize: '11px',
      fontFamily: 'JetBrains Mono, Menlo, monospace',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
      padding: '8px 12px',
    },
    labelStyle: {
      color: '#F1F5F9',
      fontWeight: 600,
      marginBottom: '4px',
    },
    itemStyle: {
      padding: '2px 0',
    },
  },
};
