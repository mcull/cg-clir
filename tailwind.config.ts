import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Admin console redesign palette (Creative Growth gallery language).
        ink: "#171512",
        paper: "#F7F5F0",
        card: "#FFFFFF",
        green: {
          DEFAULT: "#2c8b3d",
          dark: "#1f6c2c",
          light: "#7BC98B",
        },
        muted: "#6E685C",
        faint: "#A39C8C",
        hairline: "#EAE6DC",
        line: "#C9C2B4",
        "sidebar-line": "#35322C",
        "sidebar-hover": "#24211C",
        "row-hover": "#F3F0E8",
      },
    },
  },
  plugins: [],
};
export default config;
