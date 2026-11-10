import { Field, Input, Section, ThemePicker } from "@cyberos/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LanguagePreference, SupportedLocale } from "../../i18n/locale.js";
import { formatBytes } from "../../i18n/format.js";
import { previewFileSizeLimitBytesToMiB, previewFileSizeLimitMiBToBytes } from "../../lib/preview-settings.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { HelpTip } from "../common/HelpTip.js";

export function SettingsAppearancePage({
  languagePreference,
  onLanguagePreferenceChange
}: {
  languagePreference: LanguagePreference;
  onLanguagePreferenceChange: (preference: LanguagePreference) => void;
}) {
  const { t } = useTranslation();
  const languageOptions: { value: LanguagePreference; label: string }[] = [
    { value: "system", label: t("common.language.system") },
    { value: "en", label: t("common.language.english") },
    { value: "zh-CN", label: t("common.language.chineseSimplified") }
  ];
  const selectedLanguageLabel =
    languageOptions.find((option) => option.value === languagePreference)?.label ?? languagePreference;

  return (
    <div className="settings-content-body">
      <div className="settings-page-grid">
        <Section className="settings-section-card" title={t("settings.appearance.title")} description={t("settings.appearance.browserSaved")}>

          <ThemePicker />
        </Section>
        <Section className="settings-section-card" title={t("settings.appearance.languageTitle")} description={t("settings.appearance.languageDescription")}>

          <Field className="settings-preference-field" htmlFor="language-select" label={t("settings.appearance.languageField")} help={<HelpTip label={t("settings.appearance.languageField")} content={t("settings.appearance.languageHelp")} />}>
            <CustomSelect
              id="language-select"
              value={languagePreference}
              options={languageOptions}
              ariaLabel={`${t("settings.appearance.languageField")}: ${selectedLanguageLabel}`}
              onChange={onLanguagePreferenceChange}
            />
          </Field>
        </Section>

      </div>
    </div>
  );
}

export function SettingsFilesPage({
  previewFileSizeLimitBytes,
  locale,
  onPreviewFileSizeLimitChange
}: {
  previewFileSizeLimitBytes: number;
  locale: SupportedLocale;
  onPreviewFileSizeLimitChange: (bytes: number) => void;
}) {
  const { t } = useTranslation();
  const previewFileSizeLimitMiB = previewFileSizeLimitBytesToMiB(previewFileSizeLimitBytes);
  const [draftLimitMiB, setDraftLimitMiB] = useState(String(previewFileSizeLimitMiB));
  useEffect(() => {
    setDraftLimitMiB(String(previewFileSizeLimitMiB));
  }, [previewFileSizeLimitMiB]);

  function changeDraftLimit(value: string) {
    setDraftLimitMiB(value);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      onPreviewFileSizeLimitChange(previewFileSizeLimitMiBToBytes(parsed));
    }
  }

  return (
    <div className="settings-content-body">
      <div className="settings-page-grid">
        <Section className="settings-section-card" title={t("settings.files.previewTitle")} description={t("settings.files.previewDescription")}>

          <Field className="settings-preference-field settings-size-field" htmlFor="preview-file-size-limit" label={t("settings.files.previewFileSizeLimit")} help={<HelpTip label={t("settings.files.previewFileSizeLimit")} content={t("settings.files.previewFileSizeLimitHelp", { limit: formatBytes(previewFileSizeLimitBytes, locale) })} id="preview-file-size-limit-help" />}>
            <div className="settings-unit-input">
              <Input
                id="preview-file-size-limit"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={draftLimitMiB}
                aria-describedby="preview-file-size-limit-help"
                onBlur={() => setDraftLimitMiB(String(previewFileSizeLimitMiB))}
                onChange={(event) => changeDraftLimit(event.target.value)}
              />
              <span>{t("settings.files.megabytes")}</span>
            </div>
          </Field>
        </Section>

      </div>
    </div>
  );
}
