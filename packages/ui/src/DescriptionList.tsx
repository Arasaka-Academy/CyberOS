import type { ComponentPropsWithRef, Key, ReactNode } from "react";

export interface DescriptionItem {
  id?: Key;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  mono?: boolean;
  tooltip?: string;
}

/** Aligned facts stay a semantic description list; complex feature values remain React nodes. */
export function DescriptionList({ items, className, ...props }: Omit<ComponentPropsWithRef<"dl">, "children"> & { items: readonly DescriptionItem[] }) {
  return <dl {...props} className={["ui-description-list", className].filter(Boolean).join(" ")}>
    {items.map((item, index) => <div key={item.id ?? index} className="ui-description-row">
      <dt>{item.label}</dt>
      <dd className={item.mono ? "is-mono" : undefined} data-tooltip={item.tooltip ?? (typeof item.value === "string" ? item.value : undefined)}>
        {item.value}{item.detail ? <small>{item.detail}</small> : null}
      </dd>
    </div>)}
  </dl>;
}
