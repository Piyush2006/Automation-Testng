import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
const bootError = document.getElementById("boot-error");

if (!root) {
  bootError?.removeAttribute("hidden");
} else {
  try {
    createRoot(root).render(<App />);
  } catch (error) {
    console.error(error);
    bootError?.removeAttribute("hidden");
  }
}
