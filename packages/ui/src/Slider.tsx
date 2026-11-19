/**
 * [INPUT]: 依赖固定 CyberUI 滑块和调用方的数值格式。
 * [OUTPUT]: 提供共享 Slider，保留鼠标、触屏和键盘语义。
 * [POS]: CyberOS 控件适配层；触控尺寸由 slider.css 统一定义。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Slider as CyberSlider, type SliderProps } from "./vendor/slider.js";

export type { SliderProps } from "./vendor/slider.js";
export function Slider({ className, ...props }: SliderProps) {
  return <CyberSlider {...props} className={["ui-slider", className].filter(Boolean).join(" ")} />;
}
