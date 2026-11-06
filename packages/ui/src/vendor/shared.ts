// Generated from packages/react/src/shared.ts. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
import { useCallback, useState, type SetStateAction, type HTMLAttributes, type Ref, type ReactNode } from 'react';
export interface DOMProps<T extends HTMLElement = HTMLDivElement> extends Omit<HTMLAttributes<T>,'onChange'|'defaultValue'|'children'|'onFocus'|'onBlur'> {
  ref?: Ref<T>; onFocus?: HTMLAttributes<Element>['onFocus']; onBlur?: HTMLAttributes<Element>['onBlur'];
}
export interface NativeProps<T extends HTMLElement = HTMLDivElement> extends DOMProps<T> { children?: ReactNode }
export const cx = (...values: (string | false | null | undefined)[]) => values.filter(Boolean).join(' ');
export function useControllableState<T>(value: T | undefined, defaultValue: T, onChange?: (value: T) => void) {
  const [internal,setInternal] = useState(defaultValue);
  const current = value===undefined?internal:value;
  const set = useCallback((next: SetStateAction<T>) => {
    const resolved = typeof next==='function' ? (next as (v:T)=>T)(current) : next;
    if(value===undefined) setInternal(resolved);
    if(resolved!==current) onChange?.(resolved);
  },[current,value,onChange]);
  return [current,set] as const;
}

/** Remove absent native optional props before passing them into React Aria's exact optional API. */
export function definedProps<T extends object>(props: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}
