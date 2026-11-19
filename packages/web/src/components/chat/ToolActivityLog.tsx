/**
 * [INPUT]: 依赖工具状态列表、聊天文案和共享主题。
 * [OUTPUT]: 提供折叠摘要、最近调用和失败筛选。
 * [POS]: 聊天记录的工具展示层；不参与执行与审批。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, LoaderCircle, X } from "lucide-react";
import type { AgentToolActivity } from "../../api.js";

const RECENT_CALLS = 6;

function toolLabel(name: string, labels: Record<string, string>): string {
  const key = name.replace(/^mcp(?:__cyberos__|_cyberos_)/, "");
  return Object.hasOwn(labels, key) ? labels[key]! : name;
}

export function ToolActivityLog({ activities }: { activities: AgentToolActivity[] }) {
  const { t } = useTranslation();
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const labels = t("chat.toolActivity.names", { returnObjects: true });
  const failedCount = activities.filter(tool => tool.status === "failed").length;
  const running = activities.filter(tool => tool.status === "running").at(-1);
  const filtered = failuresOnly ? activities.filter(tool => tool.status === "failed") : activities;
  const visible = showAll ? filtered : filtered.slice(-RECENT_CALLS);
  const heading = running
    ? t("chat.toolActivity.runningAction", { name: toolLabel(running.name, labels) })
    : t("chat.toolActivity.title");
  const countLabel = t("chat.toolActivity.calls", { count: activities.length });
  const failedLabel = t("chat.toolActivity.failures", { count: failedCount });

  if (activities.length === 0) return null;

  return <><details className="agent-tool-activity">
    <summary data-tooltip={running ? `${heading} · ${running.name}` : undefined}>
      <ChevronRight className="tool-activity-chevron" aria-hidden="true" size={14} />
      <span className="tool-activity-heading">
        {running ? <LoaderCircle className="composer-spinner" aria-hidden="true" size={14} /> : null}
        <span>{heading}</span>
      </span>
      <span className="tool-activity-count">{countLabel}</span>
      {failedCount ? <span className="tool-activity-failures">{failedLabel}</span> : null}
    </summary>
    <div className="tool-activity-body">
      {failedCount || failuresOnly ? <div className="tool-activity-toolbar">
        <button type="button" aria-pressed={failuresOnly} onClick={() => {
          setFailuresOnly(!failuresOnly);
          setShowAll(false);
        }}>{t("chat.toolActivity.failuresOnly")}</button>
      </div> : null}
      <ol className="tool-activity-list" aria-label={t("chat.toolActivity.title")}>
        {visible.map(tool => <li key={`${tool.runId}:${tool.id}`} data-state={tool.status}>
          {tool.status === "running"
            ? <LoaderCircle className="composer-spinner" aria-hidden="true" size={14} />
            : tool.status === "completed" ? <Check aria-hidden="true" size={14} /> : <X aria-hidden="true" size={14} />}
          <span className="tool-activity-name" tabIndex={0} data-tooltip={tool.name}>{toolLabel(tool.name, labels)}</span>
          <small>{t(`chat.toolStatus.${tool.status}`)}</small>
        </li>)}
      </ol>
      {filtered.length > RECENT_CALLS ? <button className="tool-activity-more" type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
        {showAll ? t("chat.toolActivity.showRecent", { count: RECENT_CALLS }) : t("chat.toolActivity.showAll", { count: filtered.length })}
      </button> : null}
    </div>
  </details>
    <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{heading} · {countLabel}{failedCount ? ` · ${failedLabel}` : ""}</span>
  </>;
}
