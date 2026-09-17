import React from "react";

interface CyclodeIconProps {
  className?: string;
  size?: number;
  withBackground?: boolean;
  variant?: "exact" | "bold";
}

// Precomputed mathematical epicycloid paths (128x128 viewBox, maximized edge-to-edge)
// exact: 7-arch epicycloid (k=7/2), 100% faithful to user reference diagram
const PATH_7_2 =
  "M 100.27,64.0 L 100.92,64.11 L 102.72,64.84 L 105.31,66.7 L 108.13,70.03 L 110.51,74.9 L 111.84,81.1 L 111.59,88.21 L 109.44,95.61 L 105.35,102.62 L 99.54,108.56 L 92.45,112.91 L 84.71,115.34 L 77.01,115.78 L 70.03,114.45 L 64.27,111.77 L 60.06,108.36 L 57.44,104.88 L 56.2,101.94 L 55.89,100.02 L 55.93,99.36 L 55.68,99.97 L 54.57,101.57 L 52.17,103.68 L 48.3,105.68 L 43.03,106.92 L 36.68,106.83 L 29.81,105.01 L 23.07,101.27 L 17.15,95.72 L 12.64,88.73 L 9.98,80.85 L 9.34,72.77 L 10.62,65.17 L 13.48,58.65 L 17.36,53.64 L 21.62,50.29 L 25.6,48.51 L 28.75,47.95 L 30.69,48.08 L 31.32,48.26 L 30.78,47.88 L 29.47,46.44 L 27.95,43.64 L 26.86,39.42 L 26.82,34.0 L 28.32,27.84 L 31.63,21.54 L 36.77,15.8 L 43.5,11.26 L 51.32,8.43 L 59.59,7.59 L 67.62,8.76 L 74.74,11.7 L 80.46,15.94 L 84.48,20.84 L 86.8,25.74 L 87.64,30.01 L 87.49,33.2 L 86.93,35.07 L 86.62,35.64 L 87.1,35.2 L 88.8,34.25 L 91.87,33.39 L 96.23,33.26 L 101.52,34.43 L 107.2,37.26 L 112.6,41.89 L 117.05,48.18 L 119.98,55.75 L 121.0,64.0 L 119.98,72.25 L 117.05,79.82 L 112.6,86.11 L 107.2,90.74 L 101.52,93.57 L 96.23,94.74 L 91.87,94.61 L 88.8,93.75 L 87.1,92.8 L 86.62,92.36 L 86.93,92.93 L 87.49,94.8 L 87.64,97.99 L 86.8,102.26 L 84.48,107.16 L 80.46,112.06 L 74.74,116.3 L 67.62,119.24 L 59.59,120.41 L 51.32,119.57 L 43.5,116.74 L 36.77,112.2 L 31.63,106.46 L 28.32,100.16 L 26.82,94.0 L 26.86,88.58 L 27.95,84.36 L 29.47,81.56 L 30.78,80.12 L 31.32,79.74 L 30.69,79.92 L 28.75,80.05 L 25.6,79.49 L 21.62,77.71 L 17.36,74.36 L 13.48,69.35 L 10.62,62.83 L 9.34,55.23 L 9.98,47.15 L 12.64,39.27 L 17.15,32.28 L 23.07,26.73 L 29.81,22.99 L 36.68,21.17 L 43.03,21.08 L 48.3,22.32 L 52.17,24.32 L 54.57,26.43 L 55.68,28.03 L 55.93,28.64 L 55.89,27.98 L 56.2,26.06 L 57.44,23.12 L 60.06,19.64 L 64.27,16.23 L 70.03,13.55 L 77.01,12.22 L 84.71,12.66 L 92.45,15.09 L 99.54,19.44 L 105.35,25.38 L 109.44,32.39 L 111.59,39.79 L 111.84,46.9 L 110.51,53.1 L 108.13,57.97 L 105.31,61.3 L 102.72,63.16 L 100.92,63.89 Z";

// bold: 5-arch epicycloid (k=5/2), maximized for extra boldness at small scales
const PATH_5_2 =
  "M 95.67,64.0 L 96.52,64.16 L 98.87,65.27 L 102.07,68.05 L 105.22,72.92 L 107.31,79.81 L 107.42,88.25 L 104.9,97.36 L 99.53,106.09 L 91.55,113.35 L 81.61,118.21 L 70.72,120.11 L 60.0,118.94 L 50.52,115.03 L 43.13,109.14 L 38.25,102.25 L 35.89,95.44 L 35.58,89.65 L 36.54,85.52 L 37.78,83.25 L 38.38,82.61 L 37.59,82.98 L 35.05,83.47 L 30.82,83.1 L 25.41,81.02 L 19.67,76.67 L 14.62,69.9 L 11.3,61.05 L 10.51,50.83 L 12.71,40.27 L 17.89,30.5 L 25.58,22.55 L 34.95,17.2 L 44.91,14.79 L 54.36,15.22 L 62.35,17.92 L 68.26,22.04 L 71.91,26.54 L 73.57,30.45 L 73.89,33.02 L 73.79,33.88 L 74.21,33.12 L 75.98,31.23 L 79.62,29.05 L 85.22,27.55 L 92.42,27.69 L 100.48,30.2 L 108.37,35.41 L 115.01,43.21 L 119.44,53.05 L 121.0,64.0 L 119.44,74.95 L 115.01,84.79 L 108.37,92.59 L 100.48,97.8 L 92.42,100.31 L 85.22,100.45 L 79.62,98.95 L 75.98,96.77 L 74.21,94.88 L 73.79,94.12 L 73.89,94.98 L 73.57,97.55 L 71.91,101.46 L 68.26,105.96 L 62.35,110.08 L 54.36,112.78 L 44.91,113.21 L 34.95,110.8 L 25.58,105.45 L 17.89,97.5 L 12.71,87.73 L 10.51,77.17 L 11.3,66.95 L 14.62,58.1 L 19.67,51.33 L 25.41,46.98 L 30.82,44.9 L 35.05,44.53 L 37.59,45.02 L 38.38,45.39 L 37.78,44.75 L 36.54,42.48 L 35.58,38.35 L 35.89,32.56 L 38.25,25.75 L 43.13,18.86 L 50.52,12.97 L 60.0,9.06 L 70.72,7.89 L 81.61,9.79 L 91.55,14.65 L 99.53,21.91 L 104.9,30.64 L 107.42,39.75 L 107.31,48.19 L 105.22,55.08 L 102.07,59.95 L 98.87,62.73 L 96.52,63.84 Z";

interface CyclodeIconProps {
  className?: string;
  size?: number;
  variant?: "exact" | "bold";
}

export const CyclodeIcon: React.FC<CyclodeIconProps> = ({
  className = "w-6 h-6",
  size,
  variant = "exact",
}) => {
  const style = size ? { width: size, height: size } : undefined;
  const isExact = variant === "exact";
  const pathD = isExact ? PATH_7_2 : PATH_5_2;
  const baseRadius = isExact ? 36.27 : 31.67;
  const strokeWidth = isExact ? 4.5 : 5.0;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      className={className}
      style={style}
      fill="none"
    >
      <defs>
        {/* Adaptive amber-gold gradient tuned for high contrast in both dark and light modes */}
        <linearGradient
          id="cyclodeGoldGrad"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#F59E0B" />
          <stop offset="40%" stopColor="#D97706" />
          <stop offset="85%" stopColor="#B45309" />
          <stop offset="100%" stopColor="#78350F" />
        </linearGradient>
        {/* Subtle drop shadow to ensure separation on both white and pitch dark backgrounds */}
        <filter id="cyclodeDepth" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="1.2"
            stdDeviation="1.5"
            floodColor="#000000"
            floodOpacity="0.32"
          />
        </filter>
      </defs>

      {/* Central Base Circle (transparent fill, works across all dark/light backgrounds) */}
      <circle
        cx="64"
        cy="64"
        r={baseRadius}
        fill="none"
        stroke="url(#cyclodeGoldGrad)"
        strokeWidth={strokeWidth}
        filter="url(#cyclodeDepth)"
      />

      {/* Orbiting Epicycloid Curve */}
      <path
        d={pathD}
        fill="none"
        stroke="url(#cyclodeGoldGrad)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#cyclodeDepth)"
      />
    </svg>
  );
};
