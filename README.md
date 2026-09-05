# HeatHealthAI — SIH 2026 Verified Build

## Run

1. Open a terminal in this folder.
2. Install dependencies:
   `py -m pip install -r requirements.txt`
3. Start backend:
   `py -m uvicorn main:app --reload`
4. In a second terminal, start frontend:
   `py -m http.server 5500 --directory frontend`
5. Open `http://127.0.0.1:5500`

## Notes
- Weather is fetched from Open-Meteo with fallback handling.
- Mortality and hospitalization are 0–100 decision-support indicators, not clinical probabilities.
- Demo demographic/ward layers are synthetic and explicitly labelled in the UI/API.
- SMS/WhatsApp dispatch requires valid Twilio configuration.
