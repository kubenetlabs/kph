import { type Config } from "tailwindcss";

export default {
  content: ["./src/**/*.tsx"],
  theme: {
    extend: {
      colors: {
        // Core backgrounds
        background: "#0A0E14",
        foreground: "#F0F6FC",
        
        // Card surfaces
        card: {
          DEFAULT: "#151B24",
          hover: "#1C2432",
          border: "#334155",
        },
        
        // Primary (teal/green - success, primary actions)
        primary: {
          DEFAULT: "#00D4AA",
          foreground: "#0A0E14",
          50: "#E6FFF9",
          100: "#B3FFEC",
          200: "#80FFE0",
          300: "#4DFFD3",
          400: "#1AFFC7",
          500: "#00D4AA",
          600: "#00A888",
          700: "#007D66",
          800: "#005244",
          900: "#002922",
        },
        
        // Accent (purple - secondary accent)
        accent: {
          DEFAULT: "#6366F1",
          foreground: "#FFFFFF",
          light: "#818CF8",
          dark: "#4F46E5",
        },
        
        // Semantic colors
        warning: {
          DEFAULT: "#F59E0B",
          foreground: "#0A0E14",
          light: "#FBBF24",
          dark: "#D97706",
        },
        
        danger: {
          DEFAULT: "#EF4444",
          foreground: "#FFFFFF",
          light: "#F87171",
          dark: "#DC2626",
        },
        
        success: {
          DEFAULT: "#10B981",
          foreground: "#FFFFFF",
          light: "#34D399",
          dark: "#059669",
        },
        
        // Muted text and borders
        muted: {
          DEFAULT: "#8B949E",
          foreground: "#8B949E",
        },
        
        border: "#334155",
        
        // Component-specific colors
        cilium: "#7C3AED",
        tetragon: "#BE185D",
        gateway: "#F59E0B",
        policyhub: "#0EA5E9",
      },
      
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
      
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      
      boxShadow: {
        glow: "0 0 20px rgba(0, 212, 170, 0.3)",
        "glow-accent": "0 0 20px rgba(99, 102, 241, 0.3)",
        "glow-cyan": "0 0 20px rgba(14, 165, 233, 0.4)",
      },
      
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-in-out",
      },
      
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(-10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
