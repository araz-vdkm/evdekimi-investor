import React, { useEffect, useState } from 'react';
import { Sun, CloudSun, Cloud, CloudFog, CloudRain, CloudSnow, CloudLightning, Loader2 } from 'lucide-react';

export function WeatherWidget() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('https://api.open-meteo.com/v1/forecast?latitude=-8.5069&longitude=115.2625&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FMakassar')
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        console.error('Weather fetch error:', e);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[88px] w-[340px] bg-white/5 rounded-2xl border border-white/10 animate-pulse">
        <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
      </div>
    );
  }

  if (!data || !data.current || !data.daily) {
    return null;
  }

  const getWeatherIcon = (code: number, className: string) => {
    if (code === 0) return <Sun className={className} />;
    if (code === 1 || code === 2) return <CloudSun className={className} />;
    if (code === 3) return <Cloud className={className} />;
    if (code === 45 || code === 48) return <CloudFog className={className} />;
    if (code >= 51 && code <= 67) return <CloudRain className={className} />;
    if (code >= 71 && code <= 77) return <CloudSnow className={className} />;
    if (code >= 80 && code <= 82) return <CloudRain className={className} />;
    if (code >= 85 && code <= 86) return <CloudSnow className={className} />;
    if (code >= 95 && code <= 99) return <CloudLightning className={className} />;
    return <Sun className={className} />;
  };

  const getDayName = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' });
  };

  const currentTemp = Math.round(data.current.temperature_2m);
  const currentCode = data.current.weather_code;

  return (
    <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 flex items-center gap-5">
      {/* Current */}
      <div className="flex items-center gap-3">
        {getWeatherIcon(currentCode, "w-10 h-10 text-amber-300 drop-shadow-sm")}
        <div>
          <div className="text-2xl font-bold text-white leading-none">{currentTemp}°<span className="text-lg">C</span></div>
          <div className="text-[11px] font-medium text-white/80 uppercase tracking-wider mt-1">Ubud, Bali</div>
        </div>
      </div>

      <div className="w-px h-10 bg-white/20"></div>

      {/* Forecast */}
      <div className="flex items-center gap-4">
        {data.daily.time.slice(1, 6).map((time: string, index: number) => {
          const dayIndex = index + 1;
          const maxTemp = Math.round(data.daily.temperature_2m_max[dayIndex]);
          const minTemp = Math.round(data.daily.temperature_2m_min[dayIndex]);
          const code = data.daily.weather_code[dayIndex];
          
          return (
            <div key={time} className="flex flex-col items-center gap-1.5">
              <span className="text-[10px] uppercase font-bold text-white/70">{getDayName(time)}</span>
              {getWeatherIcon(code, "w-4 h-4 text-white/90 drop-shadow-sm")}
              <span className="text-xs font-semibold text-white flex items-center gap-1">
                {maxTemp}°<span className="text-white/50 text-[10px] font-medium">{minTemp}°</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
