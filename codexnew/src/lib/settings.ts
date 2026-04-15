import { createServiceClient } from './supabase/server';

export type SettingKey =
  | 'PASS_THRESHOLD'
  | 'VALID_MONTHS'
  | 'VIDEO_COMPLETE_RATE'
  | 'COMPLETION_PREFIX'
  | 'QUIZ_COUNT';

const DEFAULTS: Record<SettingKey, string> = {
  PASS_THRESHOLD: '7',
  VALID_MONTHS: '6',
  VIDEO_COMPLETE_RATE: '95',
  COMPLETION_PREFIX: 'SF',
  QUIZ_COUNT: '10',
};

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const supabase = createServiceClient();
  const { data } = await supabase.from('app_settings').select('key, value');
  const result = { ...DEFAULTS };
  if (data) {
    for (const row of data) {
      if (row.key in DEFAULTS) {
        result[row.key as SettingKey] = row.value;
      }
    }
  }
  return result;
}

export async function getSettingInt(key: SettingKey): Promise<number> {
  const settings = await getSettings();
  return parseInt(settings[key], 10);
}
