import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        mist: "#F8FAFC",
        accent: "#0B7285",
        success: "#1B7F5E",
        warning: "#B45309",
        danger: "#B42318"
      }
    }
  },
  plugins: []
};

export default config;
