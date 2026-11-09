import { Button, DialogActions, DialogHeader, Field, Textarea } from "@cyberos/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalPortal } from "../../common/ModalPortal.js";
import { useModalDialog } from "../useModalDialog.js";
import { terminalPastePreview } from "../../../lib/terminal-workbench.js";
import type { TerminalClipboardState } from "./useTerminalWorkbench.js";

export function TerminalClipboardDialog({ state, onClose, onSubmit }: {
  state: TerminalClipboardState;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const dialogRef = useModalDialog<HTMLFormElement>(onClose);
  const [draft, setDraft] = useState(state.text);
  const confirmation = state.kind === "confirm";
  const copying = state.kind === "copy";
  const title = copying ? "manualCopy" : confirmation ? "confirmPaste" : "manualPaste";
  return (
    <ModalPortal className="file-action-backdrop" onRequestClose={onClose}>
      <form ref={dialogRef} className="file-action-dialog terminal-clipboard-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} onSubmit={event => { event.preventDefault(); onSubmit(draft); }}>
        <DialogHeader title={t(`workspace.terminal.${title}`)} headingId={headingId} />
        <p className="file-action-copy">{t(`workspace.terminal.${confirmation ? "pasteWarning" : "clipboardFallback"}`)}</p>
        <Field label={t(`workspace.terminal.${copying ? "copyText" : confirmation ? "pastePreview" : "pasteText"}`)}>
          <Textarea
            autoFocus={!confirmation}
            readOnly={copying || confirmation}
            value={confirmation ? terminalPastePreview(state.text) : draft}
            rows={7}
            spellCheck={false}
            onChange={event => setDraft(event.target.value)}
            onFocus={event => { if (copying) event.currentTarget.select(); }}
          />
        </Field>
        <DialogActions>
          <Button variant="secondary" type="button" onClick={onClose}>{t("common.actions.cancel")}</Button>
          <Button variant={confirmation ? "danger" : "primary"} type="submit" disabled={!copying && !draft}>
            {t(`workspace.terminal.${copying ? "done" : confirmation ? "pasteConfirm" : "continuePaste"}`)}
          </Button>
        </DialogActions>
      </form>
    </ModalPortal>
  );
}
