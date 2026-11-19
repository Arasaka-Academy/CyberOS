'use client';
import * as A from 'react-aria-components';
import { type Ref } from 'react';
import { cx } from './shared.js';
import s from './slider.module.css';
import fieldStyles from './field.module.css';
export interface SliderProps extends Omit<A.SliderProps<number>, 'children' | 'className'> {
    label: string;
    className?: string;
    ref?: Ref<HTMLDivElement>;
}
export function Slider({ label, className, ...props }: SliderProps) {
    return <A.Slider {...props} className={cx(fieldStyles.field, className)}><div className={cx(s.sliderHead)}><A.Label className={cx(fieldStyles.label)}>{label}</A.Label><A.SliderOutput /></div><A.SliderTrack className={cx(s.sliderTrack)}><A.SliderThumb className={cx(s.sliderThumb)}/></A.SliderTrack></A.Slider>;
}
