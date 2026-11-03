import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#19332f", leaf: "#2d8a68", cream: "#f7f4ec", sun: "#f5b84b", rust: "#c95f45" }, boxShadow: { soft: "0 18px 50px rgba(25, 51, 47, .10)" } } },
  plugins: []
};
export default config;
