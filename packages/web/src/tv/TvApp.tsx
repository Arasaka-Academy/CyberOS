import { AppearanceProvider } from "@cyberos/ui";
import { useTranslation } from "react-i18next";
import { PlaybackProvider } from "../components/playback/PlaybackProvider.js";
import { MusicProvider } from "../components/music/MusicProvider.js";
import { TvLibrary } from "./TvLibrary.js";

export function TvApp() {
  const { i18n } = useTranslation();
  return <AppearanceProvider locale={i18n.resolvedLanguage === "en" ? "en" : "zh-CN"}>
    <PlaybackProvider><MusicProvider><TvLibrary /></MusicProvider></PlaybackProvider>
  </AppearanceProvider>;
}
