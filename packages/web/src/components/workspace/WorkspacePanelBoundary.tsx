import { Button, EmptyState } from "@cyberos/ui";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspacePanelId } from "../../lib/workspace-panel-settings.js";
import { APP_REGISTRY } from "../../mobile/apps.js";
import { PanelHeader } from "./PanelHeader.js";

interface PanelBoundaryProps {
  panel: WorkspacePanelId;
  active?: boolean;
  children: ReactNode;
}

interface PanelBoundaryState {
  panel: WorkspacePanelId;
  failed: boolean;
}

export class WorkspacePanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  state: PanelBoundaryState = { panel: this.props.panel, failed: false };

  static getDerivedStateFromProps(props: PanelBoundaryProps, state: PanelBoundaryState) {
    return props.panel !== state.panel ? { panel: props.panel, failed: false } : null;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.active === false ? null : <PanelLoadError panel={this.props.panel} />;
  }
}

function PanelLoadError({ panel }: { panel: WorkspacePanelId }) {
  const { t } = useTranslation();
  const definition = APP_REGISTRY.find((entry) => entry.id === panel)!;
  const Icon = definition.Icon;
  return <section className="workspace-management" data-panel-error={panel}>
    <PanelHeader icon={<Icon size={20} aria-hidden="true" />} title={t(definition.labelKey)} subtitle={null} actions={null} />
    <div className="management-body">
      <EmptyState role="alert" icon={<AlertTriangle size={24} aria-hidden="true" />}
        title={t("workspace.loading.panelFailed")}
        description={t("workspace.loading.panelFailedDescription")}
        actions={<Button variant="secondary" type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={16} aria-hidden="true" />{t("workspace.loading.reloadPage")}
        </Button>}
      />
    </div>
  </section>;
}
