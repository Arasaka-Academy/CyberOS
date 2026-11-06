import { mountAppearance } from "@cyberos/ui/theme";
import "@cyberos/ui/fonts.css";
import "@cyberos/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "pinyin-ime";
import "pinyin-ime/pinyin-ime.css";
import { initI18n } from "../i18n/index.js";
import { TvApp } from "./TvApp.js";
import { TooltipLayer } from "../components/common/TooltipLayer.js";
import "./tv.css";

mountAppearance();

void initI18n().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <TvApp />
      <TooltipLayer />
    </StrictMode>
  );
});
