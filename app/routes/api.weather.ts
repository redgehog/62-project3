import { data } from "react-router";

export async function loader() {
  const key = process.env.WEATHERAPI_KEY;
  const location = process.env.WEATHERAPI_LOCATION ?? "College Station, TX";

  if (!key) {
    return data({ error: "WEATHERAPI_KEY not configured" }, { status: 500 });
  }

  const url = `https://api.weatherapi.com/v1/current.json?key=${key}&q=${encodeURIComponent(location)}&aqi=no`;

  const res = await fetch(url);
  if (!res.ok) {
    return data({ error: "Weather fetch failed" }, { status: 500 });
  }

  const json = await res.json();
  return {
    temp_f: json.current.temp_f as number,
    condition: json.current.condition.text as string,
  };
}
