export type WeatherCode =
  'SUNNY' | 'PARTLY_CLOUDY' | 'CLOUDY' | 'RAINY' | 'STORMY' | 'TYPHOON' | 'CUSTOM';
export type BusinessDate = string;
export interface RequestEnvelope {
  apiVersion: '1';
  requestId: string;
  action: string;
  payload: Record<string, unknown>;
}
export type ApiResult<T> =
  | { apiVersion: '1'; requestId: string; ok: true; data: T }
  | {
      apiVersion: '1';
      requestId: string | null;
      ok: false;
      error: { code: string; message: string };
    };
export type JournalWeather =
  | { weather: Exclude<WeatherCode, 'CUSTOM'>; weatherName?: never }
  /** 1-20 Unicode code points, single line. */
  | { weather: 'CUSTOM'; weatherName: string };
export type JournalInput = {
  date: BusinessDate;
  tags?: string[];
  text?: string;
  expectedVersion: number;
} & JournalWeather;
/** Client response, projected by entryView; no internal account identity. */
export type JournalEntry = {
  date: BusinessDate;
  tags: string[];
  text: string;
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
} & JournalWeather;
export interface Account {
  id: string;
  status: 'active' | 'disabled';
}
export interface TrustedActor {
  accountId: string;
  roles: string[];
}
