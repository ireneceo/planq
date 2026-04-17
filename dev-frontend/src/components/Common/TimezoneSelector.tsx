import { useMemo } from 'react';
import PlanQSelect from './PlanQSelect';
import {
  TIMEZONE_PRESETS,
  listAllTimezones,
  cityFromTz,
  offsetFromTz,
} from '../../utils/timezones';

type Props = {
  value: string;
  onChange: (tz: string) => void;
  disabled?: boolean;
  exclude?: string[];              // 제외할 TZ (이미 선택된 것)
  placeholder?: string;
  size?: 'sm' | 'md';
};

export default function TimezoneSelector({
  value,
  onChange,
  disabled,
  exclude = [],
  placeholder,
  size = 'sm',
}: Props) {
  const now = useMemo(() => new Date(), []);

  const options = useMemo(() => {
    const all = listAllTimezones();
    const presetSet = new Set(TIMEZONE_PRESETS.map((p) => p.value));
    const rest = all.filter((t) => !presetSet.has(t)).sort();
    const merged = [
      ...TIMEZONE_PRESETS.map((p) => p.value),
      ...rest,
    ];
    return merged
      .filter((tz) => !exclude.includes(tz))
      .map((tz) => {
        const off = offsetFromTz(now, tz);
        const city = cityFromTz(tz);
        return {
          value: tz,
          label: `${city} · ${tz}${off ? ` (UTC${off})` : ''}`,
        };
      });
  }, [exclude, now]);

  const current = options.find((o) => o.value === value) || null;

  return (
    <PlanQSelect
      value={current}
      onChange={(opt) => {
        const v = (opt as { value: string } | null)?.value;
        if (v) onChange(v);
      }}
      options={options}
      isDisabled={disabled}
      placeholder={placeholder}
      size={size}
      isSearchable
    />
  );
}
