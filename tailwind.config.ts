import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Manrope", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Fraunces", "Georgia", "serif"],
      },
      colors: {
        white: "#fffcf7",
        slate: {
          50: "#f4f1ea",
          100: "#e7e2d6",
          200: "#d3cdc0",
          300: "#b3ab9b",
          400: "#6d675e",
          500: "#564f48",
          600: "#3d3832",
          700: "#2b261f",
          800: "#1e1a16",
          900: "#141210",
          950: "#0c0b0a",
        },
        indigo: {
          50: "#e7f6f2",
          100: "#c8ebe2",
          200: "#99d6c8",
          300: "#5eb8a4",
          400: "#2f9a84",
          500: "#147d6b",
          600: "#0f6b5c",
          700: "#0d564b",
          800: "#0e433c",
          900: "#0c332e",
          950: "#06211e",
        },
      },
    },
  },
  plugins: [],
};

export default config;
