from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from datetime import datetime, timedelta
from pathlib import Path
import math, os, csv, statistics
import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

APP_VERSION = "7.0.0-SIH"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
DATA_DIR = Path(__file__).resolve().parent / "data"
HEALTH_DATASET = DATA_DIR / "heat_health.csv"

app = FastAPI(
    title="HeatHealthAI",
    description="Localized human thermal stress and heat-health decision support API",
    version=APP_VERSION,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOCATION_ALIASES = {
    "vizag": "Visakhapatnam, Andhra Pradesh, India",
    "vizag city": "Visakhapatnam, Andhra Pradesh, India",
    "visakhapatnam": "Visakhapatnam, Andhra Pradesh, India",
    "kakinada": "Kakinada, Andhra Pradesh, India",
    "vijayawada": "Vijayawada, Andhra Pradesh, India",
    "dispur": "Dispur, Assam, India",
    "guwahati": "Guwahati, Assam, India",
}

RISK_COLORS = {"LOW":"#22c55e","MODERATE":"#eab308","HIGH":"#f97316","EXTREME":"#ef4444"}
RISK_EMOJIS = {"LOW":"🟢","MODERATE":"🟡","HIGH":"🟠","EXTREME":"🔴"}

# Demo demographic layers are explicitly labelled. Replace with municipal/GIS data in deployment.
DEMO_AREAS = {
    "Visakhapatnam": [("Madhurawada",35600,78,72),("Gajuwaka",48200,84,81),("MVP Colony",22100,61,58),("Bheemunipatnam",31800,70,66),("Anakapalle",51200,76,74)],
    "Kakinada": [("Sarpavaram",28400,73,69),("Jagannaickpur",21700,67,63),("Ramanayyapeta",30200,79,71),("Indrapalem",19500,65,61),("Samalkota",38600,75,73)],
    "Vijayawada": [("Bhavanipuram",22400,74,71),("Benz Circle",28600,69,64),("Patamata",41700,77,75),("Moghalrajpuram",26300,72,68),("Governorpet",18100,64,60)],
    "Guwahati": [("Dispur",41200,76,70),("Beltola",35600,71,67),("Khanapara",28900,68,65),("Maligaon",31800,74,72),("Jalukbari",24300,66,62)],
    "default": [("Local Area 1",24000,70,65),("Local Area 2",21000,66,61),("Local Area 3",18000,62,58),("Local Area 4",16000,58,55),("Local Area 5",14000,54,51)],
}

ZONE_POPULATIONS = {"ZONE 1":12500,"ZONE 2":9800,"ZONE 3":7600,"ZONE 4":11300}
ZONE_RECIPIENTS = {"ZONE 1":["+919999000001"],"ZONE 2":["+919999000002"],"ZONE 3":["+919999000003"],"ZONE 4":["+919999000004"]}


def safe_float(v, default=0.0):
    try: return float(v)
    except Exception: return default


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, safe_float(v, lo)))


def round_value(v, digits=1):
    try: return round(float(v), digits)
    except Exception: return 0


def risk_level(score):
    s = clamp(score)
    if s < 25: return "LOW"
    if s < 50: return "MODERATE"
    if s < 75: return "HIGH"
    return "EXTREME"


def risk_message(level):
    return {
        "LOW":"Thermal conditions are generally manageable for most healthy people.",
        "MODERATE":"Heat stress is increasing; vulnerable people may experience discomfort or dehydration.",
        "HIGH":"Dangerous heat stress is developing; prolonged exposure may increase heat-related illness.",
        "EXTREME":"Extreme human thermal danger detected; rapid protective action is recommended.",
    }.get(level, "Thermal conditions are being analyzed.")


def calculate_heat_index(temp_c, humidity):
    t = safe_float(temp_c); rh = clamp(humidity, 0, 100)
    if t < 26.7: return t
    f = t * 9/5 + 32
    hi_f = (-42.379 + 2.04901523*f + 10.14333127*rh - 0.22475541*f*rh
            - 0.00683783*f*f - 0.05481717*rh*rh + 0.00122874*f*f*rh
            + 0.00085282*f*rh*rh - 0.00000199*f*f*rh*rh)
    # NOAA-style low/high RH adjustments improve edge behaviour.
    if rh < 13 and 80 <= f <= 112:
        hi_f -= ((13-rh)/4) * math.sqrt((17-abs(f-95))/17)
    elif rh > 85 and 80 <= f <= 87:
        hi_f += ((rh-85)/10) * ((87-f)/5)
    return (hi_f-32)*5/9


def saturation_vapour_pressure(temp_c):
    return 0.6108 * math.exp((17.27*temp_c)/(temp_c+237.3))


def estimate_wet_bulb_stull(temp_c, humidity):
    """Stull (2011) approximation; used only to estimate natural wet-bulb temperature."""
    t = safe_float(temp_c); rh = clamp(humidity, 5, 99)
    return (t*math.atan(0.151977*math.sqrt(rh+8.313659)) +
            math.atan(t+rh) - math.atan(rh-1.676331) +
            0.00391838*rh**1.5*math.atan(0.023101*rh) - 4.686035)


def estimate_globe_temperature(temp_c, solar_wm2, wind_kmh):
    """Transparent solar/wind globe-temperature estimate for prototype WBGT."""
    t = safe_float(temp_c); s = max(0, safe_float(solar_wm2)); v = max(0.5, safe_float(wind_kmh))
    # Empirical black-globe warming term; deliberately bounded to avoid runaway values.
    solar_term = 9.0 * min(s/900.0, 1.0) / (1.0 + 0.08*v)
    return t + min(12.0, solar_term)


def calculate_wbgt(temp_c, humidity, wind_kmh, solar_wm2):
    """Outdoor WBGT estimate using estimated Twb and globe temperature.

    Production should replace estimated Twb/Tg with measured or validated radiation,
    globe-temperature and psychrometric inputs. The UI therefore calls this WBGT estimate.
    """
    twb = estimate_wet_bulb_stull(temp_c, humidity)
    tg = estimate_globe_temperature(temp_c, solar_wm2, wind_kmh)
    return 0.7*twb + 0.2*tg + 0.1*safe_float(temp_c)


def calculate_utci_estimate(temp_c, humidity, wind_kmh, solar_wm2):
    """Human-thermal UTCI estimate, not the official 6th-order UTCI polynomial."""
    t = safe_float(temp_c); rh = clamp(humidity); v = max(0.5, safe_float(wind_kmh)); s = max(0, safe_float(solar_wm2))
    vapour = (rh/100.0) * saturation_vapour_pressure(t)
    humidity_effect = min(6.0, vapour * 1.4)
    wind_effect = min(5.0, max(0.0, v-1.0)*0.08)
    radiant_effect = min(6.0, s/900.0*6.0)
    return t + humidity_effect + radiant_effect - wind_effect


def calculate_htsi(temp_c, humidity, wind_kmh, solar_wm2, heat_index=None, wbgt=None):
    t=safe_float(temp_c); rh=clamp(humidity); w=max(0,safe_float(wind_kmh)); s=max(0,safe_float(solar_wm2))
    hi = calculate_heat_index(t,rh) if heat_index is None else safe_float(heat_index)
    wb = calculate_wbgt(t,rh,w,s) if wbgt is None else safe_float(wbgt)
    temp_score=clamp((t-25)/20*100)
    humidity_score=clamp((rh-35)/55*100)
    wind_score=clamp(100-w/35*100)
    solar_score=clamp(s/900*100)
    hi_score=clamp((hi-27)/18*100)
    wb_score=clamp((wb-18)/17*100)
    return clamp(temp_score*.18+humidity_score*.12+wind_score*.08+solar_score*.10+hi_score*.24+wb_score*.28)


def calculate_drivers(t,rh,w,s):
    return [
        {"name":"Temperature","value":round_value(clamp((t-25)/20*100),1),"description":"Direct thermal load on the human body."},
        {"name":"Humidity","value":round_value(clamp((rh-35)/55*100),1),"description":"High humidity reduces evaporative cooling."},
        {"name":"Low Wind","value":round_value(clamp(100-w/35*100),1),"description":"Low wind reduces convective cooling."},
        {"name":"Solar Radiation","value":round_value(clamp(s/900*100),1),"description":"Solar radiation increases environmental heat load."},
    ]


def calculate_vulnerability_score(elderly_percent, outdoor_worker_percent, population_density, exposure, children_percent=0):
    score=(clamp(elderly_percent/25*100)*.25 + clamp(outdoor_worker_percent/40*100)*.25 +
           clamp(population_density/30000*100)*.20 + clamp(exposure)*.20 + clamp(children_percent/25*100)*.10)
    return round_value(clamp(score),1)


def health_priority(thermal_score, vulnerability_score):
    score=clamp(thermal_score)*.65+clamp(vulnerability_score)*.35
    level="CRITICAL" if score>=80 else "URGENT" if score>=65 else "HIGH" if score>=45 else "WATCH" if score>=25 else "ROUTINE"
    return {"score":round_value(score,1),"level":level}


def build_fallback_weather():
    now=datetime.now(); ht=[]; hh=[]; hw=[]; hs=[]; hp=[]; dates=[]; mx=[]; mn=[]; app=[]; rain=[]; dwin=[]
    for i in range(168):
        ts=now+timedelta(hours=i); h=ts.hour
        heat=3 if 11<=h<=16 else 1.5 if 8<=h<11 or 17<=h<=19 else -1
        temp=38+heat+min(i/72,1)*1.5
        hum=58 if 11<=h<=17 else 68
        wind=12 if 13<=h<=17 else 9
        solar=750*max(0,1-abs(h-13)/7) if 7<=h<=18 else 0
        ht.append(ts.isoformat()); hh.append(hum); hw.append(wind); hs.append(round(solar,1)); hp.append(1005)
        if h==0:
            day=(ts.date())
            dates.append(day.isoformat()); mx.append(round(41+min(i/24,6)*.6,1)); mn.append(round(29+min(i/24,6)*.3,1)); app.append(mx[-1]+2.5); rain.append(0); dwin.append(12)
    # guarantee 7 unique days
    dates=[]; mx=[]; mn=[]; app=[]; rain=[]; dwin=[]
    for d in range(7):
        day=(now.date()+timedelta(days=d)).isoformat(); dates.append(day); mx.append(round(41+min(d*.6,3),1)); mn.append(round(29+min(d*.3,1.5),1)); app.append(round(mx[-1]+2.5,1)); rain.append(0); dwin.append(12)
    now_solar=750*max(0,1-abs(now.hour-13)/7) if 7<=now.hour<=18 else 0
    return {"current":{"temperature_2m":ht and 40 or 40,"relative_humidity_2m":68,"apparent_temperature":42,"wind_speed_10m":9,"surface_pressure":1005,"shortwave_radiation":round(now_solar,1),"time":now.isoformat()},
            "hourly":{"time":ht,"temperature_2m":[38+(3 if 11<= (datetime.fromisoformat(x).hour)<=16 else 1.5 if 8<=datetime.fromisoformat(x).hour<11 or 17<=datetime.fromisoformat(x).hour<=19 else -1)+min(i/72,1)*1.5 for i,x in enumerate(ht)],"relative_humidity_2m":hh,"wind_speed_10m":hw,"shortwave_radiation":hs,"surface_pressure":hp},
            "daily":{"time":dates,"temperature_2m_max":mx,"temperature_2m_min":mn,"apparent_temperature_max":app,"precipitation_sum":rain,"wind_speed_10m_max":dwin},"_weather_source":"HEATHEALTHAI FALLBACK","_weather_fallback":True}


def fetch_weather(latitude, longitude):
    params={"latitude":latitude,"longitude":longitude,"current":"temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,surface_pressure,shortwave_radiation","hourly":"temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,shortwave_radiation,surface_pressure","daily":"temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,wind_speed_10m_max","timezone":"auto","forecast_days":7}
    try:
        r=requests.get(OPEN_METEO_URL,params=params,timeout=15); r.raise_for_status(); d=r.json(); d["_weather_source"]="OPEN-METEO"; d["_weather_fallback"]=False; return d
    except Exception as exc:
        d=build_fallback_weather(); d["_weather_error"]=str(exc); return d


def daily_environment(weather):
    h=weather.get("hourly",{}); out={}
    for i,ts in enumerate(h.get("time",[])):
        day=str(ts)[:10]; x=out.setdefault(day,{"humidity":[],"solar":[]})
        if i<len(h.get("relative_humidity_2m",[])): x["humidity"].append(safe_float(h["relative_humidity_2m"][i],60))
        if i<len(h.get("shortwave_radiation",[])): x["solar"].append(max(0,safe_float(h["shortwave_radiation"][i],0)))
    return {d:{"humidity":round_value(statistics.mean(v["humidity"]) if v["humidity"] else 60,1),"solar":round_value(statistics.mean([x for x in v["solar"] if x>25] or v["solar"] or [500]),1)} for d,v in out.items()}


def load_health_model():
    """Optional real-data model. No synthetic health outcomes are generated.

    CSV schema: date,location,temperature,humidity,wind,solar,htsi,vulnerability,
    hospital_admissions_rate,mortality_rate
    """
    if not HEALTH_DATASET.exists():
        return {"status":"NOT_TRAINED","reason":"No validated historical health dataset supplied.","dataset":str(HEALTH_DATASET),"n_rows":0}
    try:
        rows=list(csv.DictReader(HEALTH_DATASET.open(newline="",encoding="utf-8")))
        required={"temperature","humidity","wind","solar","htsi","vulnerability","hospital_admissions_rate","mortality_rate"}
        if not rows or not required.issubset(rows[0].keys()):
            return {"status":"INVALID_DATASET","reason":"Dataset is missing required columns.","required_columns":sorted(required),"n_rows":len(rows)}
        return {"status":"DATASET_READY","reason":"Historical health data is present; training/evaluation should be run before operational use.","n_rows":len(rows),"columns":list(rows[0].keys())}
    except Exception as exc:
        return {"status":"DATASET_ERROR","reason":str(exc),"n_rows":0}


def health_indicator(htsi,vulnerability):
    # Transparent decision-support indicator, deliberately not presented as a probability.
    thermal=clamp(htsi*.65+vulnerability*.35)
    hospitalization=clamp((htsi*.55+vulnerability*.25+max(0,htsi-60)*.5))
    mortality=clamp((max(0,htsi-35)*.75+vulnerability*.25))
    return {"hospitalization":round_value(hospitalization,1),"mortality":round_value(mortality,1),"health_score":round_value(thermal,1)}


def build_alert(location, htsi, health_score):
    severity=max(clamp(htsi),clamp(health_score))
    if severity>=80 or htsi>=75: status,priority,title="CRITICAL","URGENT","Extreme Heat Health Alert"
    elif severity>=60 or htsi>=50: status,priority,title="WARNING","HIGH","Heat Health Warning"
    elif severity>=35 or htsi>=25: status,priority,title="CAUTION","WATCH","Heat Health Advisory"
    else: status,priority,title="NORMAL","ROUTINE","Heat Health Status"
    return {"title":title,"status":status,"priority":priority,"message":f"{location}: {risk_message(risk_level(htsi))}","actions":["Hydration and cooling breaks","Protect elderly, children and outdoor workers","Adjust outdoor work during peak heat","Review cooling-centre, water and hospital readiness"],"channels":{"sms":{"status":"SIMULATION_READY"},"whatsapp":{"status":"SIMULATION_READY"}},"delivery_note":"Decision-support preview; real delivery requires an authorised provider and recipient registry."}


def current_metrics(weather):
    c=weather.get("current",{}); h=weather.get("hourly",{})
    solar=c.get("shortwave_radiation")
    if solar is None:
        # Fallback: match the hourly slot for the current hour instead of always taking index 0 (midnight).
        times=h.get("time") or []; current_time=c.get("time")
        idx=times.index(current_time) if current_time in times else datetime.now().hour
        idx=min(idx,len(h.get("shortwave_radiation",[])or[])-1) if h.get("shortwave_radiation") else -1
        solar=(h.get("shortwave_radiation") or [0])[idx] if idx>=0 else 0
    t=safe_float(c.get("temperature_2m"),35); rh=safe_float(c.get("relative_humidity_2m"),60); w=safe_float(c.get("wind_speed_10m"),10); s=safe_float(solar,0)
    hi=calculate_heat_index(t,rh); wb=calculate_wbgt(t,rh,w,s); ut=calculate_utci_estimate(t,rh,w,s); ht=calculate_htsi(t,rh,w,s,hi,wb)
    return t,rh,w,s,hi,wb,ut,ht


FRONTEND_DIR = Path(__file__).resolve().parent / "frontend"

@app.get("/", include_in_schema=False)
def serve_frontend():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/api")
def root():
    return {"name":"HeatHealthAI","status":"online","version":APP_VERSION,"endpoints":["/risk","/forecast","/hourly","/impact-forecast","/health-impact","/vulnerability","/hotspots","/action-plan","/emergency-priority","/interventions","/alerts/zone-population","/alerts/zone-dispatch","/alerts/send","/geocode","/reverse-geocode","/model-status","/health"]}

@app.get("/model-status")
def model_status():
    return {"application_version":APP_VERSION,"health_model":load_health_model(),"thermal_methods":{"heat_index":"NOAA-style heat-index equation","wbgt":"Outdoor WBGT estimate using estimated wet-bulb and globe temperature","utci":"Human-thermal UTCI estimate; replace with official UTCI polynomial for production","htsi":"Composite decision-support index"},"operational_status":"PROTOTYPE_UNTIL_VALIDATED"}

@app.get("/risk")
def risk(latitude:float=Query(...,ge=-90,le=90),longitude:float=Query(...,ge=-180,le=180),location:str=Query("Selected Location")):
    weather=fetch_weather(latitude,longitude); t,rh,w,s,hi,wb,ut,ht=current_metrics(weather)
    # Demo vulnerability is only used for prioritisation, not claimed as local truth.
    v=calculate_vulnerability_score(14,22,125000/4,88,18)
    health=health_indicator(ht,v); level=risk_level(ht)
    alert=build_alert(location,ht,health["health_score"])
    return {"location":location,"latitude":latitude,"longitude":longitude,"risk":{"level":level,"score":round_value(ht,1),"emoji":RISK_EMOJIS[level],"message":risk_message(level)},"thermal":{"heat_index":round_value(hi,1),"wbgt":round_value(wb,1),"wbgt_method":"outdoor estimate","utci":round_value(ut,1),"utci_method":"prototype estimate","htsi":round_value(ht,1)},"environment":{"temperature":round_value(t,1),"humidity":round_value(rh,1),"wind":round_value(w,1),"solar":round_value(s,1),"apparent":round_value(weather.get("current",{}).get("apparent_temperature",t),1)},"health":{"mortality":health["mortality"],"hospitalization":health["hospitalization"],"health_score":health["health_score"],"status":"RISK_INDICATOR_NOT_PROBABILITY"},"vulnerability":{"score":v,"source":"DEMO_PROFILE_REPLACE_WITH_MUNICIPAL_DATA"},"alert":alert,"drivers":calculate_drivers(t,rh,w,s),"weather_source":weather.get("_weather_source"),"weather_fallback":weather.get("_weather_fallback",False),"model_status":load_health_model(),"updated":datetime.now().strftime("%d %b %Y, %H:%M:%S")}

@app.get("/forecast")
def forecast(latitude:float=Query(...),longitude:float=Query(...)):
    weather=fetch_weather(latitude,longitude); d=weather.get("daily",{}); env=daily_environment(weather); result=[]
    n=min(5,len(d.get("time",[])),len(d.get("temperature_2m_max",[])))
    for i in range(n):
        date=d["time"][i]; t=safe_float(d["temperature_2m_max"][i],35); w=safe_float((d.get("wind_speed_10m_max") or [10]*n)[i] if i<len(d.get("wind_speed_10m_max",[])) else 10,10); e=env.get(date,{"humidity":60,"solar":500}); rh,s=e["humidity"],e["solar"]; hi=calculate_heat_index(t,rh); wb=calculate_wbgt(t,rh,w,s); ht=calculate_htsi(t,rh,w,s,hi,wb); lev=risk_level(ht)
        result.append({"date":date,"max":round_value(t,1),"min":round_value(d.get("temperature_2m_min",[t])[i] if i<len(d.get("temperature_2m_min",[])) else t,1),"apparent":round_value(d.get("apparent_temperature_max",[t])[i] if i<len(d.get("apparent_temperature_max",[])) else t,1),"rain":round_value(d.get("precipitation_sum",[0])[i] if i<len(d.get("precipitation_sum",[])) else 0,1),"wind":round_value(w,1),"humidity":rh,"solar":s,"heat_index":round_value(hi,1),"wbgt":round_value(wb,1),"htsi":round_value(ht,1),"risk":lev,"emoji":RISK_EMOJIS[lev]})
    return {"forecast":result,"weather_source":weather.get("_weather_source"),"weather_fallback":weather.get("_weather_fallback",False)}

@app.get("/hourly")
def hourly_forecast(latitude:float=Query(...),longitude:float=Query(...)):
    weather=fetch_weather(latitude,longitude); h=weather.get("hourly",{}); out=[]
    for i,ts in enumerate(h.get("time",[])[:48]):
        t=safe_float(h.get("temperature_2m",[])[i],35); rh=safe_float(h.get("relative_humidity_2m",[])[i],60); w=safe_float(h.get("wind_speed_10m",[])[i],10); s=safe_float(h.get("shortwave_radiation",[])[i] if i<len(h.get("shortwave_radiation",[])) else 0,0); hi=calculate_heat_index(t,rh); wb=calculate_wbgt(t,rh,w,s); ht=calculate_htsi(t,rh,w,s,hi,wb); lev=risk_level(ht); out.append({"time":ts,"temperature":round_value(t,1),"humidity":round_value(rh,0),"wind":round_value(w,1),"wbgt":round_value(wb,1),"htsi":round_value(ht,1),"risk":lev,"emoji":RISK_EMOJIS[lev]})
    return {"hourly":out,"weather_source":weather.get("_weather_source"),"weather_fallback":weather.get("_weather_fallback",False)}

@app.get("/simulate")
def simulate(temperature:float=Query(...),humidity:float=Query(...),wind:float=Query(...),solar:float=Query(...)):
    w_kmh=wind*3.6
    hi=calculate_heat_index(temperature,humidity); wb=calculate_wbgt(temperature,humidity,w_kmh,solar); ut=calculate_utci_estimate(temperature,humidity,w_kmh,solar); ht=calculate_htsi(temperature,humidity,w_kmh,solar,hi,wb); lev=risk_level(ht)
    h=health_indicator(ht,50)  # neutral vulnerability baseline; this scenario is not location-specific
    return {"inputs":{"temperature":temperature,"humidity":humidity,"wind_mps":wind,"solar":solar},"risk":lev,"emoji":RISK_EMOJIS[lev],"htsi":round_value(ht,1),"heat_index":round_value(hi,1),"wbgt":round_value(wb,1),"utci":round_value(ut,1),"health":{"hospitalization":h["hospitalization"],"mortality":h["mortality"]},"message":risk_message(lev),"drivers":calculate_drivers(temperature,humidity,w_kmh,solar),"note":"Scenario output uses a neutral vulnerability baseline; it is a decision-support simulation, not a medical prediction."}

@app.get("/health-impact")
def health_impact(latitude:float=Query(...),longitude:float=Query(...)):
    r=risk(latitude,longitude,"Selected Location"); return {"status":"success","location":{"latitude":latitude,"longitude":longitude},"environment":r["environment"],"thermal":{**r["thermal"],"risk_level":r["risk"]["level"]},"vulnerability":r["vulnerability"],"health_prediction":{"hospitalization":{"indicator":r["health"]["hospitalization"],"unit":"0-100","meaning":"Modeled heat-health pressure; not a clinical probability."},"mortality":{"indicator":r["health"]["mortality"],"unit":"0-100","meaning":"Modeled mortality stress; not a clinical probability."},"health_impact":{"score":r["health"]["health_score"],"level":r["risk"]["level"],"priority":"HIGH" if r["risk"]["level"] in {"HIGH","EXTREME"} else "ROUTINE"},"model":r["model_status"]},"weather_source":r["weather_source"],"generated_at":datetime.now().isoformat()}

@app.get("/impact-forecast")
def impact_forecast(latitude:float=Query(...),longitude:float=Query(...)):
    f=forecast(latitude,longitude)["forecast"]; v=calculate_vulnerability_score(14,22,31250,88,18); rows=[]
    for i,x in enumerate(f):
        p=health_priority(x["htsi"],v); h=health_indicator(x["htsi"],v); rows.append({**x,"thermal_risk":x["risk"],"day_index":i,"label":"TODAY" if i==0 else f"+{i} DAY","utci":round_value(calculate_utci_estimate(x["max"],x["humidity"],x["wind"],x["solar"]),1),"vulnerability_score":v,"priority_score":p["score"],"priority_level":p["level"],"hospitalization_indicator":h["hospitalization"],"mortality_indicator":h["mortality"],"health_impact_level":risk_level(h["health_score"]),"action":"ACTIVATE HEAT ACTION PLAN" if p["level"] in {"CRITICAL","URGENT"} else "PREPARE TARGETED ACTIONS" if p["level"]=="HIGH" else "MONITOR + PREPARE" if p["level"]=="WATCH" else "ROUTINE MONITORING"})
    change=(rows[-1]["htsi"]-rows[0]["htsi"]) if len(rows)>1 else 0; direction="RISING" if change>=7 else "FALLING" if change<=-7 else "STABLE"; peak=max(rows,key=lambda z:z["priority_score"],default=None)
    return {"forecast":rows,"trend":{"direction":direction,"change":round_value(change,1)},"peak":peak,"early_warning":{"status":peak["thermal_risk"] if peak else "LOW","label":"EXTREME FORECAST" if peak and peak["thermal_risk"]=="EXTREME" else "HIGH-RISK FORECAST" if peak and peak["thermal_risk"]=="HIGH" else "FORECAST MONITORING","days_ahead":peak["day_index"] if peak else None,"action":peak["action"] if peak else "MONITOR"},"vulnerability_score":v,"data_status":"WEATHER FORECAST + DECISION-SUPPORT HEALTH INDICATOR","warning":"Health indicators are not validated epidemiological probabilities. Supply historical health data and calibrate before operational use."}

@app.get("/vulnerability")
def vulnerability(latitude:float=Query(...),longitude:float=Query(...),location:str=Query("Selected Location")):
    key=next((k for k in DEMO_AREAS if k!="default" and k.lower() in location.lower()),"default"); rows=[]
    weather=fetch_weather(latitude,longitude); t,rh,w,s,hi,wb,ut,ht=current_metrics(weather)
    for name,pop,vuln,exposure in DEMO_AREAS[key]:
        v=round_value(vuln,1)
        p=health_priority(ht,v); lev=risk_level(ht)
        rows.append({"name":name,"population":pop,"elderly_percent":14,"outdoor_worker_percent":22,"children_percent":18,"exposure":exposure,"vulnerability_score":v,"vulnerability_level":"CRITICAL" if v>=80 else "HIGH" if v>=65 else "MODERATE" if v>=45 else "LOW","thermal_risk":lev,"htsi":round_value(ht,1),"priority_level":p["level"],"source":"SYNTHETIC DEMO PROFILE"})
    return {"location":location,"areas":rows,"weather_source":weather.get("_weather_source"),"weather_fallback":weather.get("_weather_fallback",False),"warning":"Replace synthetic demographic/exposure values with authorised ward-level municipal data before operational use."}

@app.get("/hotspots")
def hotspots(latitude:float=Query(...),longitude:float=Query(...)):
    offsets=[("Central Urban Zone",0,0), ("North Residential Zone",.035,0), ("East Commercial Zone",0,.045),("South Industrial Zone",-.04,0),("West Dense Settlement",0,-.045)]; out=[]
    for name,dy,dx in offsets:
        t=39+abs(dy)*20+abs(dx)*10; rh=65+min(10,abs(dx)*100); w=7; s=650; hi=calculate_heat_index(t,rh); wb=calculate_wbgt(t,rh,w,s); ht=calculate_htsi(t,rh,w,s,hi,wb); lev=risk_level(ht); out.append({"name":name,"latitude":latitude+dy,"longitude":longitude+dx,"temperature":round_value(t,1),"humidity":round_value(rh,1),"wind":w,"solar":s,"htsi":round_value(ht,1),"risk":lev,"data_status":"DEMO OFFSET — NOT REAL WARD GIS"})
    return {"hotspots":out,"warning":"Hotspot geometry is synthetic for SIH demonstration. Replace with authorised ward polygons and local observations/forecast grids."}

@app.get("/action-plan")
def action_plan(latitude:float=Query(...),longitude:float=Query(...),htsi:float=Query(0,ge=0,le=100),priority:str=Query("ROUTINE"),mortality:float=Query(0,ge=0,le=100),hospitalization:float=Query(0,ge=0,le=100),population:int=Query(0,ge=0)):
    if htsi>=80 or priority.upper() in {"CRITICAL","URGENT"}: level="ACTIVATE"; actions=["Open/activate cooling centres","Issue local heat emergency messaging","Shift/suspend non-essential outdoor work at peak heat","Increase hospital and ambulance readiness","Prioritise elderly, children and outdoor workers","Review electricity and drinking-water preparedness"]
    elif htsi>=60 or priority.upper()=="HIGH": level="PREPARE"; actions=["Prepare cooling centres and water","Issue targeted heat-health advisories","Increase vulnerable-population monitoring","Prepare hospitals and emergency services","Adjust outdoor-work schedules"]
    elif htsi>=40 or priority.upper()=="WATCH": level="WATCH"; actions=["Monitor thermal conditions","Promote hydration and cooling breaks","Review cooling-centre and water readiness"]
    else: level="ROUTINE"; actions=["Continue routine monitoring","Maintain heat-health awareness"]
    return {"activation_level":level,"trigger_htsi":round_value(htsi,1),"priority_level":priority.upper(),"estimated_population":population,"mortality_indicator":round_value(mortality,1),"hospitalization_indicator":round_value(hospitalization,1),"actions":actions,"note":"Decision support only; final activation remains with authorised authorities."}

@app.get("/emergency-priority")
def emergency_priority(latitude:float=Query(...),longitude:float=Query(...),location:str=Query("Selected Location"),htsi:float=Query(0,ge=0,le=100)):
    key=next((k for k in DEMO_AREAS if k!="default" and k.lower() in location.lower()),"default"); areas=[]
    for name,pop,vuln,exposure in DEMO_AREAS[key]:
        score=clamp(htsi*.55+vuln*.25+exposure*.20); lev="CRITICAL" if score>=80 else "URGENT" if score>=65 else "HIGH" if score>=50 else "WATCH" if score>=35 else "ROUTINE"; areas.append({"name":name,"population":pop,"vulnerability":vuln,"exposure":exposure,"priority_score":round_value(score,1),"priority_level":lev})
    areas.sort(key=lambda x:x["priority_score"],reverse=True)
    for i,a in enumerate(areas,1): a["rank"]=i
    return {"location":location,"generated_at":datetime.now().isoformat(),"areas":areas,"method":"HTSI + demographic vulnerability + exposure decision-support score","warning":"Synthetic demo layers are not official disaster classifications."}

INTERVENTION_CATALOG={"COOLING_CENTERS":{"title":"Activate cooling centres","owner":"Municipal Corporation","trigger":"HIGH / EXTREME heat risk"},"HOSPITAL_PREP":{"title":"Increase hospital preparedness","owner":"Health Department","trigger":"HIGH / EXTREME health-impact risk"},"OUTDOOR_WORK":{"title":"Adjust outdoor-work hours","owner":"Labour / Municipal Authority","trigger":"HIGH / EXTREME thermal stress"},"VULNERABLE_CHECK":{"title":"Prioritise vulnerable-population checks","owner":"Health / Community Teams","trigger":"HIGH vulnerability + heat risk"},"POWER_GRID":{"title":"Review power-grid readiness","owner":"Power Utility","trigger":"EXTREME heat / high cooling demand"},"WATER_SUPPLY":{"title":"Verify drinking-water supply","owner":"Municipal / Water Authority","trigger":"HIGH / EXTREME heat risk"}}

@app.get("/interventions")
def interventions(htsi:float=Query(0,ge=0,le=100),priority:str=Query("ROUTINE")):
    p=priority.upper(); rec=[]
    for code in INTERVENTION_CATALOG:
        if htsi>=80 or p in {"CRITICAL","URGENT"}: rec.append(code)
        elif htsi>=60 or p=="HIGH":
            if code!="POWER_GRID": rec.append(code)
        elif htsi>=40 or p=="WATCH":
            if code in {"WATER_SUPPLY","VULNERABLE_CHECK"}: rec.append(code)
    return {"status":"ACTION_REQUIRED" if rec else "MONITOR","recommended":rec,"catalog":INTERVENTION_CATALOG,"generated_at":datetime.now().isoformat()}

@app.get("/states")
def states(): return {"states":["Andhra Pradesh","Assam","Telangana","Tamil Nadu","Karnataka","Delhi","Maharashtra","West Bengal","Gujarat","Rajasthan"],"note":"Coverage list for the prototype; not an official operational coverage statement."}

@app.get("/geocode")
def geocode_location(q:str=Query(...,min_length=1,max_length=120)):
    query=" ".join(q.strip().split()); search_query=LOCATION_ALIASES.get(query.lower(),f"{query}, India")
    try:
        r=requests.get(NOMINATIM_SEARCH_URL,params={"q":search_query,"format":"jsonv2","limit":5,"addressdetails":1},headers={"User-Agent":"HeatHealthAI-SIH2026/1.0"},timeout=8); r.raise_for_status(); results=r.json()
    except Exception as exc: return {"found":False,"message":"Location service unavailable.","detail":str(exc)}
    if not results: return {"found":False,"message":f"Location '{query}' was not found."}
    b=results[0]; a=b.get("address") or {}; city=a.get("city") or a.get("town") or a.get("municipality") or a.get("city_district") or a.get("county") or b.get("name") or query
    return {"found":True,"query":query,"name":city,"display_name":b.get("display_name",city),"latitude":safe_float(b.get("lat")),"longitude":safe_float(b.get("lon")),"state":a.get("state","") ,"country":a.get("country","India")}

@app.get("/reverse-geocode")
def reverse_geocode_location(latitude:float=Query(...,ge=-90,le=90),longitude:float=Query(...,ge=-180,le=180)):
    try:
        r=requests.get(NOMINATIM_REVERSE_URL,params={"lat":latitude,"lon":longitude,"format":"jsonv2","zoom":10,"addressdetails":1},headers={"User-Agent":"HeatHealthAI-SIH2026/1.0"},timeout=8); r.raise_for_status(); d=r.json(); a=d.get("address") or {}; name=a.get("city") or a.get("town") or a.get("municipality") or a.get("city_district") or a.get("county") or d.get("name")
        return {"found":bool(name),"name":name,"display_name":d.get("display_name")}
    except Exception as exc: return {"found":False,"message":"Reverse geocoding unavailable.","detail":str(exc)}


def normalize_zone(z):
    v=str(z or "").strip().upper(); return v if v.startswith("ZONE ") else "ZONE "+v

def build_zone_alert(zone,location,status,htsi,mortality,hospitalization):
    return f"HeatHealthAI {status}: {location} — {zone}. HTSI {htsi:.1f}/100. Mortality Risk Indicator {mortality:.1f}/100. Hospitalization Risk Indicator {hospitalization:.1f}/100. Follow local heat-health guidance."

@app.get("/alerts/zone-population")
def get_zone_population(zone:str=Query(...)):
    z=normalize_zone(zone)
    if z not in ZONE_RECIPIENTS: raise HTTPException(404,"No authorised demo registry configured for this zone.")
    return {"zone":z,"recipient_count":ZONE_POPULATIONS[z],"registry_records":len(ZONE_RECIPIENTS[z]),"mode":"SIH_DEMO_POPULATION","note":"Synthetic count; not mobile-phone location data."}

TWILIO_ACCOUNT_SID=os.getenv("TWILIO_ACCOUNT_SID","").strip(); TWILIO_AUTH_TOKEN=os.getenv("TWILIO_AUTH_TOKEN","").strip(); TWILIO_SMS_FROM=os.getenv("TWILIO_SMS_FROM","").strip(); TWILIO_WHATSAPP_FROM=os.getenv("TWILIO_WHATSAPP_FROM","").strip()

def twilio_send_message(to,body,channel):
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN: raise RuntimeError("Twilio credentials are not configured on the backend.")
    if not str(to).startswith("+"): raise ValueError("Use international phone format.")
    sender=TWILIO_WHATSAPP_FROM if channel=="whatsapp" else TWILIO_SMS_FROM
    dest=f"whatsapp:{to}" if channel=="whatsapp" else to
    if not sender: raise RuntimeError(f"Twilio {channel} sender is not configured.")
    if channel=="whatsapp" and not sender.startswith("whatsapp:"): sender="whatsapp:"+sender
    url=f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"; r=requests.post(url,auth=(TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN),data={"From":sender,"To":dest,"Body":body},timeout=15)
    try: d=r.json()
    except Exception: d={"raw":r.text}
    if not r.ok: raise RuntimeError(d.get("message") or d.get("error_message") or r.text)
    return {"sid":d.get("sid"),"status":d.get("status","queued")}

@app.post("/alerts/zone-dispatch")
def dispatch_zone_alert(zone:str=Query(...),channel:str=Query(...),location:str=Query("Selected Location"),status:str=Query("CRITICAL"),htsi:float=Query(0,ge=0,le=100),mortality:float=Query(0,ge=0,le=100),hospitalization:float=Query(0,ge=0,le=100),confirm:bool=Query(False)):
    z=normalize_zone(zone); ch=channel.lower(); recipients=ZONE_RECIPIENTS.get(z)
    if recipients is None: raise HTTPException(404,"No authorised recipient registry configured for this zone.")
    if ch not in {"sms","whatsapp"}: raise HTTPException(400,"Channel must be sms or whatsapp.")
    if not confirm: raise HTTPException(400,"Bulk dispatch requires explicit confirm=true.")
    msg=build_zone_alert(z,location,status.upper(),htsi,mortality,hospitalization); results=[]
    for to in recipients:
        try: x=twilio_send_message(to,msg,ch); results.append({"recipient":to,"status":"accepted","provider_id":x.get("sid"),"provider_status":x.get("status")})
        except Exception as exc: results.append({"recipient":to,"status":"failed","error":str(exc)})
    return {"success":True,"zone":z,"channel":ch,"targeted":len(results),"accepted":sum(x["status"]=="accepted" for x in results),"failed":sum(x["status"]=="failed" for x in results),"message":msg,"results":results,"sent_at":datetime.now().isoformat()}

@app.post("/alerts/send")
def send_alert(channel:str=Query(...),to:str=Query(...),location:str=Query("Selected Location"),status:str=Query("NORMAL"),htsi:float=Query(0,ge=0,le=100),mortality:float=Query(0,ge=0,le=100),hospitalization:float=Query(0,ge=0,le=100)):
    ch=channel.lower()
    if ch not in {"sms","whatsapp"}: raise HTTPException(400,"Channel must be sms or whatsapp.")
    msg=build_zone_alert("DIRECT",location,status.upper(),htsi,mortality,hospitalization)
    try: x=twilio_send_message(to,msg,ch)
    except ValueError as exc: raise HTTPException(400,str(exc))
    except RuntimeError as exc: raise HTTPException(502,str(exc))
    return {"success":True,"message":"Message accepted by Twilio.","channel":ch,"recipient":to,"text":msg,"provider_id":x.get("sid"),"provider_status":x.get("status"),"sent_at":datetime.now().isoformat()}

@app.get("/health")
def health(): return {"status":"healthy","version":APP_VERSION,"timestamp":datetime.now().isoformat(),"health_model":load_health_model()["status"],"weather_provider":"Open-Meteo with local fallback"}

# Serve frontend static files — must be mounted AFTER all API routes
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
