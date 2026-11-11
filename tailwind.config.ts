import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        caption: ["12px", { lineHeight: "1.5", fontWeight: "400" }],
        body: ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        subhead: ["16px", { lineHeight: "1.25", fontWeight: "500" }],
        title: ["20px", { lineHeight: "1.25", fontWeight: "600" }],
      },
      colors: {
        navy: "#0F1426",
        ink: "#4F4F4F",
        mist: "#9BA1AC",
        hair: "#C8CCD4",
        line: "#ECEDEF",
        paper: "#F7F9FF",
        lilac: "#E6EAF5",
        purple: "#6A41C6",
        action: "#7F55D9",
        "action-hover": "#6C43C6",
        "purple-soft": "#9073F7",
        "purple-wash": "#F1ECFB",
        "lot-wash": "#E3F8EF",
        lot: "#16A06A",
        "vendor-wash": "#E4F1FD",
        vendor: "#2F7FD8",
        success: "#16C57F",
        warning: "#E7B316",
        "warning-wash": "#FCF6E1",
        danger: "#EF5650",
        "danger-wash": "#FDEBEA",
      },
      boxShadow: {
        none: "none",
        pop: "0 8px 24px rgba(15, 20, 38, 0.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
