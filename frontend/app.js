/* ============================================================
   HEATHEALTHAI
   HUMAN THERMAL INTELLIGENCE
   FRONTEND APPLICATION
============================================================ */


/* ============================================================
   API
============================================================ */

// Single Render service: frontend and API share the same origin.
// window.HEATHEALTHAI_API can be set via a <script> tag to override.
const API_URL = window.HEATHEALTHAI_API ||
    (location.hostname === "127.0.0.1" || location.hostname === "localhost"
        ? "http://127.0.0.1:8000"
        : "");  // same-origin on Render


/* ============================================================
   GLOBAL STATE
============================================================ */

let map = null;
let selectedMarker = null;
let hotspotLayer = null;

let currentLatitude = 17.6868;
let currentLongitude = 83.2185;
let currentLocation = "Visakhapatnam";


/* ============================================================
   RISK COLORS
============================================================ */

const RISK_COLORS = {
    LOW: "#22c55e",
    MODERATE: "#eab308",
    HIGH: "#f97316",
    "VERY HIGH": "#dc2626",
    EXTREME: "#ef4444"
};


const RISK_BG = {
    LOW: "rgba(34,197,94,0.10)",
    MODERATE: "rgba(234,179,8,0.10)",
    HIGH: "rgba(249,115,22,0.10)",
    "VERY HIGH": "rgba(220,38,38,0.10)",
    EXTREME: "rgba(239,68,68,0.10)"
};


const RISK_EMOJIS = {
    LOW: "🟢",
    MODERATE: "🟡",
    HIGH: "🟠",
    "VERY HIGH": "🔴",
    EXTREME: "🔴"
};


/* ============================================================
   SAFE NUMBER VALIDATION
============================================================ */

/**
 * Safely convert any value to a finite number.
 * Returns fallback (default null) for null, undefined, NaN, Infinity, empty string, etc.
 */
function safeNumber(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "string") {
        const trimmed = value.replace(/,/g, "").trim();
        if (trimmed === "" || trimmed === "NaN" || trimmed === "null" || trimmed === "undefined") return fallback;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

/**
 * Clamp HTSI to 0–100 range, returning fallback if not finite.
 */
function safeHTSI(value, fallback = 0) {
    const num = safeNumber(value, fallback);
    return Math.max(0, Math.min(100, num));
}


/* ============================================================
   CENTRALIZED RISK CLASSIFICATION
============================================================ */

/**
 * 5-tier risk classification matching backend thresholds.
 * Used for current/observed conditions and hotspots.
 * Always returns a valid string, never undefined.
 */
function getRiskLevel(htsi) {
    const value = safeNumber(htsi, 0);
    if (value < 25) return "LOW";
    if (value < 50) return "MODERATE";
    if (value < 70) return "HIGH";
    if (value < 85) return "VERY HIGH";
    return "EXTREME";
}

/**
 * Forecast risk capped at HIGH for the SIH prototype.
 * Future forecasts should not claim VERY HIGH or EXTREME without a validated ML model.
 */
function getForecastRiskLevel(htsi) {
    const value = safeNumber(htsi, 0);
    if (value < 25) return "LOW";
    if (value < 50) return "MODERATE";
    return "HIGH";
}

/**
 * Safe display for numeric values. Returns formatted string or "Data unavailable".
 */
function safeDisplay(value, digits = 1, suffix = "") {
    const num = safeNumber(value);
    if (num === null) return "Data unavailable";
    return num.toFixed(digits) + suffix;
}


/* ============================================================
   DOM HELPERS
============================================================ */

function $(id) {
    return document.getElementById(id);
}


function setText(id, value) {
    const element = $(id);

    if (element) {
        element.textContent = value;
    }
}


function formatNumber(value, digits = 1) {

    if (
        value === null ||
        value === undefined ||
        Number.isNaN(Number(value))
    ) {
        return "--";
    }

    return Number(value).toFixed(digits);
}


/* ============================================================
   RISK HELPERS
============================================================ */

function getRiskColor(level) {
    return RISK_COLORS[level] || "#94a3b8";
}


function getRiskEmoji(level) {
    return RISK_EMOJIS[level] || RISK_EMOJIS[getRiskLevel(0)] || "🌡️";
}


function applyRiskColor(element, level) {

    if (!element) {
        return;
    }

    element.style.color =
        getRiskColor(level);
}


function setProgress(score, level) {

    const progress =
        $("riskProgress");

    if (!progress) {
        return;
    }

    progress.style.width =
        `${Math.max(0, Math.min(100, score))}%`;

    progress.style.background =
        getRiskColor(level);
}


/* ============================================================
   MAP INITIALIZATION
============================================================ */

function initializeMap() {

    if (!window.L) {
        console.error(
            "Leaflet was not loaded."
        );

        return;
    }

    map = L.map("map", {
        zoomControl: true
    }).setView(
        [
            currentLatitude,
            currentLongitude
        ],
        11
    );


    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                '&copy; OpenStreetMap contributors'
        }
    ).addTo(map);


    hotspotLayer =
        L.layerGroup().addTo(map);


    updateMapLocation(
        currentLatitude,
        currentLongitude,
        "MODERATE"
    );
}


/* ============================================================
   MAP LOCATION
============================================================ */

function updateMapLocation(
    latitude,
    longitude,
    level
) {

    if (!map) {
        return;
    }


    if (selectedMarker) {
        map.removeLayer(
            selectedMarker
        );
    }


    selectedMarker =
        L.circleMarker(
            [
                latitude,
                longitude
            ],
            {
                radius: 13,
                color: "#ffffff",
                weight: 3,
                fillColor:
                    getRiskColor(level),
                fillOpacity: 0.85
            }
        ).addTo(map);


    selectedMarker.bindPopup(
        `
        <div style="min-width:180px">
            <strong>${escapeHtml(currentLocation)}</strong>
            <br>
            Risk:
            <strong style="color:${getRiskColor(level)}">
                ${level}
            </strong>
            <br>
            Coordinates:
            ${latitude.toFixed(4)},
            ${longitude.toFixed(4)}
        </div>
        `
    );


    map.setView(
        [
            latitude,
            longitude
        ],
        11
    );
}


/* ============================================================
   MAP HOTSPOTS
============================================================ */

function renderHotspotMap(
    hotspots
) {

    if (!map || !hotspotLayer) {
        return;
    }

    hotspotLayer.clearLayers();


    hotspots.forEach(
        hotspot => {

            const riskLevel = hotspot.risk || getRiskLevel(safeNumber(hotspot.htsi, 0));
            const color = getRiskColor(riskLevel);


            const marker =
                L.circleMarker(
                    [
                        hotspot.latitude,
                        hotspot.longitude
                    ],
                    {
                        radius:
                            10 +
                            Math.min(
                                hotspot.htsi / 15,
                                7
                            ),

                        color: "#ffffff",

                        weight: 2,

                        fillColor: color,

                        fillOpacity: 0.75
                    }
                );


            marker.bindPopup(
                `
                <div style="min-width:190px">

                    <strong>
                        ${escapeHtml(hotspot.name)}
                    </strong>

                    <hr>

                    <div>
                        Thermal Risk:
                        <strong
                            style="color:${color}"
                        >
                            ${riskLevel}
                        </strong>
                    </div>

                    <div>
                        HTSI:
                        <strong>
                            ${formatNumber(
                                hotspot.htsi
                            )}/100
                        </strong>
                    </div>

                    <div>
                        Temperature:
                        ${formatNumber(
                            hotspot.temperature
                        )}°C
                    </div>

                </div>
                `
            );


            marker.addTo(
                hotspotLayer
            );
        }
    );
}


/* ============================================================
   MAIN ANALYSIS
============================================================ */

async function resolveCityToCoordinates(cityName) {

    const query = String(cityName || "").trim();

    if (!query) return null;

    try {
        const response = await fetch(
            `${API_URL}/geocode?q=${encodeURIComponent(query)}`
        );

        if (!response.ok) {
            throw new Error(`Geocoding API returned ${response.status}`);
        }

        const result = await response.json();

        if (!result.found) return null;

        const latitude = Number(result.latitude);
        const longitude = Number(result.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }

        return {
            name: result.name || query,
            latitude,
            longitude,
            displayName: result.display_name || result.name || query
        };

    } catch (error) {
        console.warn("City geocoding failed:", error);
        return null;
    }
}


async function reverseGeocodeCoordinates(latitude, longitude) {

    try {
        const response = await fetch(
            `${API_URL}/reverse-geocode?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`
        );

        if (!response.ok) return null;

        const result = await response.json();

        if (!result.found) return null;

        return result.name || null;

    } catch (error) {
        console.warn("Reverse geocoding failed:", error);
        return null;
    }
}


function setLocationFields(name, latitude, longitude) {

    currentLocation = name;
    currentLatitude = Number(latitude);
    currentLongitude = Number(longitude);

    const cityInput = $("city");
    const latInput = $("latitude");
    const lonInput = $("longitude");

    if (cityInput) cityInput.value = name;
    if (latInput) latInput.value = currentLatitude.toFixed(6);
    if (lonInput) lonInput.value = currentLongitude.toFixed(6);

    // Refresh hyper-local area choices whenever the location changes.
    refreshAreaOptions();

    setText("locationName", name);
    setText(
        "coordinates",
        `${currentLatitude.toFixed(4)}, ${currentLongitude.toFixed(4)}`
    );
}


async function analyzeLocation() {

    const button = $("analyzeBtn");
    const cityInput = $("city");

    const cityQuery = String(
        cityInput?.value || ""
    ).trim();

    let latitude = Number(
        $("latitude")?.value
    );

    let longitude = Number(
        $("longitude")?.value
    );

    // --------------------------------------------------------
    // CITY SEARCH IS THE PRIMARY USER ACTION.
    // Resolve the city to coordinates first.
    // This prevents stale Guwahati/Dispur coordinates from
    // being reused when the user searches Vizag, Kakinada, etc.
    // --------------------------------------------------------
    if (cityQuery) {

        button.disabled = true;
        button.innerHTML = "LOCATING...";

        const resolved =
            await resolveCityToCoordinates(cityQuery);

        if (resolved) {
            latitude = resolved.latitude;
            longitude = resolved.longitude;

            setLocationFields(
                resolved.name,
                latitude,
                longitude
            );
        }
    }

    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
    ) {
        button.disabled = false;
        button.innerHTML =
            `ANALYZE HEAT RISK <span>→</span>`;

        alert(
            "Please enter a valid city or valid latitude and longitude."
        );

        return;
    }

    if (
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
    ) {
        button.disabled = false;
        button.innerHTML =
            `ANALYZE HEAT RISK <span>→</span>`;

        alert(
            "Latitude or longitude is outside the valid range."
        );

        return;
    }

    currentLatitude = latitude;
    currentLongitude = longitude;

    // If coordinates were edited directly, resolve the location name.
    // If the city search resolved successfully, this simply preserves it.
    if (!cityQuery) {
        const coordinatePlace =
            await reverseGeocodeCoordinates(
                latitude,
                longitude
            );

        if (coordinatePlace) {
            setLocationFields(
                coordinatePlace,
                latitude,
                longitude
            );
        } else {
            setText(
                "locationName",
                "Selected Location"
            );
        }
    }

    currentLocation =
        String(
            $("city")?.value ||
            currentLocation ||
            "Selected Location"
        ).trim();

    button.disabled = true;
    button.innerHTML = "ANALYZING...";

    setText(
        "locationName",
        currentLocation
    );

    setText(
        "coordinates",
        `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
    );

    try {

        const url =
            `${API_URL}/risk` +
            `?latitude=${encodeURIComponent(latitude)}` +
            `&longitude=${encodeURIComponent(longitude)}` +
            `&location=${encodeURIComponent(currentLocation)}`;

        const response =
            await fetch(url);

        if (!response.ok) {
            throw new Error(
                `API returned ${response.status}`
            );
        }

        const data =
            await response.json();

        renderRisk(data);

        // Re-apply the resolved location after all renderers finish.
        setText(
            "locationName",
            currentLocation
        );

        setText(
            "coordinates",
            `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
        );

        await Promise.all([
            loadForecast(),
            loadHourly(),
            loadHotspots(),
            loadVulnerability(),
            loadImpactForecast()
        ]);

        // SIH STEPS 7–9: decision support, prioritisation and intervention triggers.
        await loadActionPlan(data);
        await loadEmergencyPriority();
        // Pass riskData to interventions so it uses the same HTSI as actions
        await loadInterventions(data);

        // Ensure the map and selected marker follow the same coordinates.
        const finalLevel =
            data.risk?.level || "MODERATE";

        updateMapLocation(
            latitude,
            longitude,
            finalLevel
        );

        if (map) {
            map.setView(
                [latitude, longitude],
                Math.max(map.getZoom(), 11),
                { animate: true }
            );
        }

    } catch (error) {

        console.error(
            "Analysis failed:",
            error
        );

        showError(
            "Unable to retrieve live thermal data. Make sure the backend is running."
        );

    } finally {

        button.disabled = false;
        button.innerHTML =
            `ANALYZE HEAT RISK <span>→</span>`;
    }
}



/* ============================================================
   SIH STEP 7 — AUTOMATED HEAT ACTION PLAN
============================================================ */

async function loadActionPlan(riskData) {
    const summary = $("actionPlanSummary");
    const list = $("actionPlanList");
    const badge = $("actionPlanBadge");

    if (!summary || !list) return;

    // ============================================================
    // HTSI
    // ============================================================

    const htsi = safeNumber(
        riskData?.risk?.htsi ??
        riskData?.risk?.score ??
        riskData?.thermal?.htsi ??
        riskData?.htsi ??
        $("htsiScore")?.textContent,
        0
    );


    // ============================================================
    // PRIORITY
    // ============================================================

    const priority = String(
        riskData?.health?.priority_level ??
        riskData?.priority_level ??
        "ROUTINE"
    ).toUpperCase();


    // ============================================================
    // MORTALITY
    // ============================================================

    const mortality = safeNumber(
        riskData?.health?.mortality?.indicator ??
        riskData?.health?.mortality ??
        $("mortality")?.textContent ??
        0,
        0
    );


    // ============================================================
    // HOSPITALIZATION
    // ============================================================

    const hospitalization = safeNumber(
        riskData?.health?.hospitalization?.indicator ??
        riskData?.health?.hospitalization ??
        $("hospitalization")?.textContent ??
        0,
        0
    );


    // ============================================================
    // POPULATION
    // ============================================================

    const population = safeNumber(
        $("zonePopulation")?.textContent,
        0
    );


    // ============================================================
    // DEBUG
    // ============================================================

    console.log(
        "STEP 7 ACTION PLAN INPUT:",
        {
            latitude: currentLatitude,
            longitude: currentLongitude,
            htsi: htsi,
            priority: priority,
            mortality: mortality,
            hospitalization: hospitalization,
            population: population
        }
    );


    // ============================================================
    // FINAL SAFETY CHECK
    // ============================================================

    if (
        !Number.isFinite(htsi) ||
        !Number.isFinite(mortality) ||
        !Number.isFinite(hospitalization) ||
        !Number.isFinite(population)
    ) {

        console.error(
            "STEP 7 INVALID INPUT:",
            {
                htsi,
                mortality,
                hospitalization,
                population
            }
        );

        if (badge) {
            badge.textContent = "DATA ERROR";
        }

        if (summary) {
            summary.innerHTML = `
                <div class="error-state">
                    Action plan input data is invalid.
                </div>
            `;
        }

        if (list) {
            list.innerHTML = "";
        }

        return;
    }


    // ============================================================
    // CALL BACKEND
    // ============================================================

    try {

        const params = new URLSearchParams({
            latitude: String(currentLatitude),
            longitude: String(currentLongitude),
            htsi: String(htsi),
            priority: priority,
            mortality: String(mortality),
            hospitalization: String(hospitalization),
            population: String(population)
        });

        console.log(
            "STEP 7 REQUEST:",
            `${API_URL}/action-plan?${params.toString()}`
        );


        const response = await fetch(
            `${API_URL}/action-plan?${params.toString()}`
        );


        // ========================================================
        // HTTP ERROR
        // ========================================================

        if (!response.ok) {

            let errorMessage = `Action plan HTTP ${response.status}`;

            try {
                const errorData = await response.json();

                console.error(
                    "STEP 7 BACKEND ERROR:",
                    errorData
                );

                if (errorData?.detail) {
                    errorMessage += `: ${JSON.stringify(errorData.detail)}`;
                }

            } catch (_) {
                // Response wasn't JSON.
            }

            throw new Error(errorMessage);
        }


        // ========================================================
        // READ RESPONSE
        // ========================================================

        const data = await response.json();

        console.log(
            "STEP 7 RESPONSE:",
            data
        );


        // ========================================================
        // ACTIVATION LEVEL
        // ========================================================

        const level = String(
            data.activation_level || "ROUTINE"
        ).toUpperCase();


        const color = getPriorityColor(
            level === "ACTIVATE"
                ? "CRITICAL"
                : level === "PREPARE"
                    ? "HIGH"
                    : level === "WATCH"
                        ? "WATCH"
                        : "ROUTINE"
        );


        // ========================================================
        // BADGE
        // ========================================================

        if (badge) {

            badge.textContent = level;

            badge.style.color = color;

            badge.style.borderColor = `${color}66`;
        }


        // ========================================================
        // SUMMARY
        // ========================================================

        if (summary) {

            summary.innerHTML = `
                <div class="command-hero-kicker">
                    RESPONSE LEVEL
                </div>

                <strong style="color:${color}">
                    ${escapeHtml(level)}
                </strong>

                <div class="command-hero-metrics">

                    <span>
                        HTSI
                        <b>
                            ${formatNumber(
                                data.trigger_htsi,
                                1
                            )}
                        </b>
                    </span>

                    <span>
                        POPULATION
                        <b>
                            ${formatPopulation(
                                data.estimated_population
                            )}
                        </b>
                    </span>

                    <span>
                        HOSPITAL IND.
                        <b>
                            ${formatNumber(
                                data.hospitalization_indicator,
                                0
                            )}%
                        </b>
                    </span>

                    <span>
                        MORTALITY IND.
                        <b>
                            ${formatNumber(
                                data.mortality_indicator,
                                0
                            )}%
                        </b>
                    </span>

                </div>
            `;
        }


        // ========================================================
        // RECOMMENDED ACTIONS (from centralized catalog)
        // ========================================================

        if (list) {

            // Compute recommended actions from the centralized catalog using HTSI
            lastRecommendedActions = getRecommendedActionIds(htsi);

            // Also use backend actions as supplementary display
            const backendActions = Array.isArray(data.actions)
                ? data.actions
                : [];

            // Build the display from the centralized catalog,
            // showing which actions are active based on current HTSI
            const catalogActions = ACTION_CATALOG.filter(
                action => lastRecommendedActions.has(action.id)
            );

            if (catalogActions.length === 0 && backendActions.length === 0) {

                list.innerHTML = `
                    <div class="error-state">
                        No specific actions required at current risk level.
                    </div>
                `;

            } else {
                // Use catalog actions as primary, fall back to backend
                const displayActions = catalogActions.length > 0
                    ? catalogActions.map(a => a.title)
                    : backendActions;

                list.innerHTML = displayActions
                    .map((action, index) => `
                        <div class="action-item">

                            <span>
                                ${String(index + 1).padStart(2, "0")}
                            </span>

                            <p>
                                ${escapeHtml(String(typeof action === "object" ? action.title || action : action))}
                            </p>

                        </div>
                    `)
                    .join("");
            }
        }


    } catch (error) {

        console.error(
            "Action plan failed:",
            error
        );


        if (badge) {
            badge.textContent = "OFFLINE";
        }


        if (summary) {

            summary.innerHTML = `
                <div class="error-state">
                    Action plan unavailable.
                </div>
            `;
        }


        if (list) {

            list.innerHTML = `
                <div class="error-state">
                    Decision-support actions unavailable.
                </div>
            `;
        }
    }
}


/* ============================================================
   SIH STEP 8 — EMERGENCY PRIORITISATION
============================================================ */

async function loadEmergencyPriority() {
    const cards = $("priorityCards");
    const table = $("priorityTable");
    const badge = $("priorityBadge");

    if (!cards || !table) return;

    const htsi = Number($("htsiScore")?.textContent || 0) || 0;

    try {
        const response = await fetch(
            `${API_URL}/emergency-priority` +
            `?latitude=${encodeURIComponent(currentLatitude)}` +
            `&longitude=${encodeURIComponent(currentLongitude)}` +
            `&location=${encodeURIComponent(currentLocation || "Selected Location")}` +
            `&htsi=${encodeURIComponent(htsi)}`
        );

        if (!response.ok) throw new Error(`Priority HTTP ${response.status}`);

        const data = await response.json();
        const areas = data.areas || [];

        if (badge) {
            badge.textContent = `${areas.length} AREAS RANKED`;
        }

        if (!areas.length) {
            cards.innerHTML = `<div class="empty-state">No priority areas available.</div>`;
            table.innerHTML = `<tr><td colspan="6">No priority data available.</td></tr>`;
            return;
        }

        cards.innerHTML = areas.slice(0, 3).map(area => {
            const color = getPriorityColor(area.priority_level);
            return `
                <div class="priority-card">
                    <div class="priority-rank">#${area.rank}</div>
                    <div class="priority-area">${escapeHtml(area.name)}</div>
                    <div class="priority-score" style="color:${color}">
                        ${formatNumber(area.priority_score, 0)}
                    </div>
                    <div class="priority-level" style="color:${color}">
                        ${escapeHtml(area.priority_level)}
                    </div>
                    <div class="priority-population">
                        ${formatPopulation(area.population)} people
                    </div>
                </div>
            `;
        }).join("");

        table.innerHTML = areas.map(area => {
            const color = getPriorityColor(area.priority_level);
            return `
                <tr>
                    <td><strong>#${area.rank}</strong></td>
                    <td><strong>${escapeHtml(area.name)}</strong></td>
                    <td>${formatPopulation(area.population)}</td>
                    <td>${formatNumber(area.vulnerability, 0)}/100</td>
                    <td>${formatNumber(area.exposure, 0)}/100</td>
                    <td>
                        <span style="color:${color};font-weight:900">
                            ${escapeHtml(area.priority_level)}
                            · ${formatNumber(area.priority_score, 0)}
                        </span>
                    </td>
                </tr>
            `;
        }).join("");
    } catch (error) {
        console.error("Emergency priority failed:", error);
        if (badge) badge.textContent = "OFFLINE";
        cards.innerHTML = `<div class="error-state">Emergency prioritisation unavailable.</div>`;
        table.innerHTML = `<tr><td colspan="6">Priority intelligence unavailable.</td></tr>`;
    }
}


/* ============================================================
   CENTRALIZED ACTION/RECOMMENDATION CATALOG
============================================================ */

const ACTION_CATALOG = [
    {
        id: "monitor_conditions",
        title: "Monitor thermal conditions",
        authority: "All Authorities",
        trigger: "MODERATE heat risk",
        minHtsi: 25,
        category: "monitoring"
    },
    {
        id: "hydration_cooling",
        title: "Promote hydration and cooling breaks",
        authority: "Health / Municipal Authority",
        trigger: "MODERATE heat risk",
        minHtsi: 25,
        category: "prevention"
    },
    {
        id: "water_supply",
        title: "Verify drinking-water supply",
        authority: "Municipal / Water Authority",
        trigger: "MODERATE / HIGH heat risk",
        minHtsi: 35,
        category: "infrastructure"
    },
    {
        id: "vulnerable_checks",
        title: "Prioritise vulnerable-population checks",
        authority: "Health / Community Teams",
        trigger: "MODERATE / HIGH vulnerability + heat risk",
        minHtsi: 35,
        category: "protection"
    },
    {
        id: "cooling_centres",
        title: "Activate cooling centres",
        authority: "Municipal Corporation",
        trigger: "HIGH heat risk",
        minHtsi: 50,
        category: "infrastructure"
    },
    {
        id: "outdoor_work",
        title: "Adjust outdoor-work hours",
        authority: "Labour / Municipal Authority",
        trigger: "HIGH thermal stress",
        minHtsi: 50,
        category: "regulation"
    },
    {
        id: "hospital_preparedness",
        title: "Increase hospital preparedness",
        authority: "Health Department",
        trigger: "HIGH health-impact risk",
        minHtsi: 50,
        category: "health"
    },
    {
        id: "power_grid",
        title: "Review power-grid readiness",
        authority: "Power Utility",
        trigger: "HIGH heat / high cooling demand",
        minHtsi: 60,
        category: "infrastructure"
    }
];

/**
 * Determine which actions from ACTION_CATALOG are RECOMMENDED
 * based on the current HTSI score.
 * Returns a Set of action IDs that are active.
 */
function getRecommendedActionIds(htsi) {
    const score = safeHTSI(htsi);
    const active = new Set();
    for (const action of ACTION_CATALOG) {
        if (score >= action.minHtsi) {
            active.add(action.id);
        }
    }
    return active;
}

// Shared state so both Action Plan and Interventions read the same data.
let lastRecommendedActions = new Set();


/* ============================================================
   SIH STEP 9 — INTERVENTION COMMAND CENTRE
============================================================ */

async function loadInterventions(riskData) {
    const grid = $("interventionGrid");
    const badge = $("interventionBadge");

    if (!grid) return;

    const htsi = safeNumber(
        riskData?.risk?.score ??
        riskData?.thermal?.htsi ??
        $("htsiScore")?.textContent,
        0
    );

    // Use the same centralized catalog and the shared recommended set
    const recommended = lastRecommendedActions.size > 0
        ? lastRecommendedActions
        : getRecommendedActionIds(htsi);

    if (badge) {
        badge.textContent = recommended.size > 0 ? "ACTION_REQUIRED" : "MONITOR";
    }

    grid.innerHTML = ACTION_CATALOG.map(action => {
        const active = recommended.has(action.id);
        return `
            <div class="intervention-card ${active ? "active" : ""}">
                <div class="intervention-icon">${active ? "✓" : "○"}</div>
                <div class="intervention-content">
                    <strong>${escapeHtml(action.title)}</strong>
                    <span>${escapeHtml(action.authority)}</span>
                    <small>${escapeHtml(action.trigger)}</small>
                </div>
                <div class="intervention-status">
                    ${active ? "RECOMMENDED" : "STANDBY"}
                </div>
            </div>
        `;
    }).join("");
}


/* ============================================================
   RENDER MAIN RISK
============================================================ */

function renderRisk(data) {

    const risk =
        data.risk || {};

    const thermal =
        data.thermal || {};

    const environment =
        data.environment || {};

    const health =
        data.health || {};


    const level =
        risk.level || "LOW";


    const score =
        Number(risk.score || 0);


    setText(
        "riskEmoji",
        risk.emoji ||
        getRiskEmoji(level)
    );


    setText(
        "riskLevel",
        level
    );


    setText(
        "htsiScore",
        formatNumber(score, 0)
    );


    setText(
        "htsiThermal",
        formatNumber(
            thermal.htsi,
            0
        )
    );


    setText(
        "heatIndex",
        formatNumber(
            thermal.heat_index
        )
    );


    setText(
        "wbgt",
        formatNumber(
            thermal.wbgt
        )
    );


    setText(
        "utci",
        formatNumber(
            thermal.utci
        )
    );


    setText(
        "temperature",
        formatNumber(
            environment.temperature
        )
    );


    setText(
        "humidity",
        formatNumber(
            environment.humidity,
            0
        )
    );


    setText(
        "wind",
        formatNumber(
            environment.wind
        )
    );


    setText(
        "solar",
        formatNumber(
            environment.solar,
            0
        )
    );


    setText(
        "apparent",
        formatNumber(
            environment.apparent
        )
    );


    setText(
        "mortality",
        `${formatNumber(
            health.mortality
        )}%`
    );


    setText(
        "hospitalization",
        `${formatNumber(
            health.hospitalization
        )}%`
    );

    // Keep the dashboard compatible with older HTML while exposing
    // the new vulnerability-adjustment value in the console for demo/debug use.
    if (data.vulnerability) {
        console.info("HeatHealthAI vulnerability profile:", data.vulnerability);
    }


    setText(
        "riskMessage",
        risk.message || ""
    );


    setText(
        "lastUpdated",
        data.updated || "--"
    );


    applyRiskColor(
        $("riskLevel"),
        level
    );


    applyRiskColor(
        $("htsiScore"),
        level
    );


    applyRiskColor(
        $("htsiThermal"),
        level
    );


    setProgress(
        score,
        level
    );


    renderAlert(
        data.alert
    );


    renderDrivers(
        data.drivers
    );


    updateMapLocation(
        currentLatitude,
        currentLongitude,
        level
    );
}


/* ============================================================
   ALERT
============================================================ */

function renderAlert(alert) {

    if (!alert) {
        return;
    }


    setText(
        "alertTitle",
        alert.title
    );


    setText(
        "alertStatus",
        alert.status
    );


    setText(
        "alertPriority",
        alert.priority
    );


    setText(
        "alertMessage",
        alert.message
    );


    const status =
        $("alertStatus");


    if (status) {

        status.style.color =
            getRiskColor(
                alertToRisk(
                    alert.status
                )
            );
    }


    const list =
        $("alertActions");


    if (!list) {
        return;
    }


    list.innerHTML = "";


    (
        alert.actions || []
    ).forEach(
        action => {

            const li =
                document.createElement(
                    "li"
                );

            li.textContent =
                action;

            list.appendChild(
                li
            );
        }
    );
}


function setDispatchLog(html) {
    const log = $('zoneDispatchResult') || $('dispatchLog');
    if (log) log.innerHTML = html;
}



const DEMO_AREA_POPULATIONS = {
    "Visakhapatnam": [
        ["Madhurawada", 35600],
        ["Gajuwaka", 48200],
        ["MVP Colony", 22100],
        ["Bheemunipatnam", 31800],
        ["Anakapalle", 51200]
    ],
    "Kakinada": [
        ["Sarpavaram", 18400],
        ["Jagannaickpur", 22100],
        ["Ramanayyapeta", 26700],
        ["Indrapalem", 14300],
        ["Samalkota", 43800]
    ],
    "Guwahati": [
        ["Dispur", 28600],
        ["Beltola", 31400],
        ["Khanapara", 19700],
        ["Maligaon", 25300],
        ["Jalukbari", 22400]
    ],
    "Vijayawada": [
        ["Bhavanipuram", 22400],
        ["Benz Circle", 28600],
        ["Patamata", 31800],
        ["Moghalrajpuram", 24700],
        ["Governorpet", 21900]
    ],
    "Hyderabad": [
        ["Madhapur", 41000],
        ["Kukatpally", 52000],
        ["Gachibowli", 38500],
        ["Secunderabad", 47000],
        ["Banjara Hills", 29500]
    ],
    "Chennai": [
        ["Adyar", 36000],
        ["Velachery", 52000],
        ["T Nagar", 41000],
        ["Anna Nagar", 45000],
        ["Tambaram", 61000]
    ],
    "Bengaluru": [
        ["Whitefield", 62000],
        ["Electronic City", 57000],
        ["Yelahanka", 48000],
        ["Indiranagar", 35000],
        ["Jayanagar", 39000]
    ],
    "Delhi": [
        ["Dwarka", 85000],
        ["Rohini", 92000],
        ["Saket", 54000],
        ["Karol Bagh", 46000],
        ["Lajpat Nagar", 51000]
    ],
    "Mumbai": [
        ["Andheri", 118000],
        ["Borivali", 98000],
        ["Bandra", 72000],
        ["Thane", 125000],
        ["Dadar", 61000]
    ],
    "Kolkata": [
        ["Salt Lake", 48000],
        ["New Town", 56000],
        ["Behala", 72000],
        ["Howrah", 91000],
        ["Alipore", 35000]
    ],
    "Pune": [
        ["Hinjewadi", 52000],
        ["Kothrud", 61000],
        ["Viman Nagar", 39000],
        ["Hadapsar", 68000],
        ["Shivajinagar", 44000]
    ],
    "default": [
        ["Local Area 1", 25000],
        ["Local Area 2", 18000],
        ["Local Area 3", 22000],
        ["Local Area 4", 19500],
        ["Local Area 5", 20500]
    ]
};

function getDemoAreasForLocation() {
    const key = Object.keys(DEMO_AREA_POPULATIONS).find(
        name => name.toLowerCase() === String(currentLocation || "").trim().toLowerCase()
    );
    return DEMO_AREA_POPULATIONS[key || "default"];
}

function refreshAreaOptions() {
    const select = $("alertZone");
    if (!select) return;
    const previous = select.value;
    const areas = getDemoAreasForLocation();
    select.innerHTML = areas.map(([name]) =>
        `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
    ).join("");
    if (areas.some(([name]) => name === previous)) select.value = previous;
}

async function loadZonePopulation() {
    refreshAreaOptions();
    const area = String($("alertZone")?.value || "Local Area 1");
    const result = $("zoneDispatchResult");
    const population = $("zonePopulation");
    const local = getDemoAreasForLocation().find(([name]) => name === area);
    if (result) result.innerHTML = "Identifying affected-area population...";
    const count = local ? local[1] : 0;
    if (population) population.textContent = formatPopulation(count);
    if (result) {
        result.innerHTML = `<strong>📍 ${escapeHtml(area)}</strong><br>🏙️ Parent location: <strong>${escapeHtml(currentLocation || "Selected Location")}</strong><br>👥 <strong>${formatPopulation(count)}</strong> people represented in this SIH demo area.<br><span>Population is synthetic/demo data. The prototype does not locate private phones.</span>`;
    }
}

function simulateZoneBroadcast(channel) {
    const area = String($("alertZone")?.value || "Local Area 1");
    const population = Number(String($("zonePopulation")?.textContent || "0").replace(/,/g, "")) || 0;
    const result = $("zoneDispatchResult");
    const status = String($("alertStatus")?.textContent || "NORMAL").toUpperCase();
    const htsi = Number($("htsiScore")?.textContent || 0) || 0;
    if (!population) {
        loadZonePopulation();
        if (result) result.innerHTML += "<br>Identify the area population first, then run the SIH broadcast simulation.";
        return;
    }
    const channelName = channel === "sms" ? "SMS" : "WHATSAPP";
    const highRisk = ["WARNING", "CRITICAL"].includes(status) || htsi >= 60;
    if (!highRisk) {
        if (result) result.innerHTML = `⚠️ ${escapeHtml(area)} is currently ${escapeHtml(status)} (HTSI ${htsi.toFixed(1)}). SIH safety mode: area-wide emergency broadcast is reserved for HIGH/EXTREME conditions or a forecast trigger.`;
        return;
    }
    if (result) {
        result.innerHTML = `<strong>🚨 ${channelName} AREA-WIDE DEMO DISPATCH</strong><br>📍 ${escapeHtml(area)} → 🔴 EMERGENCY TARGET<br>👥 Target population: <strong>${formatPopulation(population)}</strong><br>📨 Simulating delivery to all eligible people represented by this area.<br><br><strong>✅ SIH DEMO COMPLETE</strong> — ${formatPopulation(population)} recipients targeted. No real messages were sent.`;
    }
    const dispatch = $("dispatchState");
    if (dispatch) { dispatch.textContent = `${area} • ${channelName} DEMO`; dispatch.style.color = getRiskColor("EXTREME"); }
}

function alertToRisk(status) {

    const map = {
        NORMAL: "LOW",
        CAUTION: "MODERATE",
        WARNING: "HIGH",
        CRITICAL: "EXTREME"
    };

    return map[status] || "LOW";
}


/* ============================================================
   DRIVERS
============================================================ */

function renderDrivers(
    drivers
) {

    const container =
        $("drivers");


    if (!container) {
        return;
    }


    if (
        !drivers ||
        !drivers.length
    ) {

        container.innerHTML =
            `<div class="empty-state">
                No thermal drivers available.
             </div>`;

        return;
    }


    container.innerHTML =
        drivers.map(
            driver => {

                const value =
                    Math.max(
                        0,
                        Math.min(
                            100,
                            Number(
                                driver.value
                            ) || 0
                        )
                    );


                return `
                    <div class="driver-card">

                        <div class="driver-header">

                            <span>
                                ${escapeHtml(
                                    driver.name
                                )}
                            </span>

                            <span class="driver-value">
                                ${value.toFixed(0)}%
                            </span>

                        </div>

                        <div class="driver-track">

                            <div
                                class="driver-fill"
                                style="width:${value}%"
                            ></div>

                        </div>

                        <div
                            style="
                                margin-top:9px;
                                color:#657080;
                                font-size:10px;
                                line-height:1.5;
                            "
                        >
                            ${escapeHtml(
                                driver.description || ""
                            )}
                        </div>

                    </div>
                `;
            }
        ).join("");
}


/* ============================================================
   FORECAST
============================================================ */

async function loadForecast() {

    const container =
        $("forecast");


    if (!container) {
        return;
    }


    try {

        const response =
            await fetch(
                `${API_URL}/forecast` +
                `?latitude=${currentLatitude}` +
                `&longitude=${currentLongitude}`
            );


        if (!response.ok) {
            throw new Error(
                "Forecast request failed"
            );
        }


        const data =
            await response.json();


        renderForecast(
            data.forecast || []
        );


    } catch (error) {

        console.error(
            error
        );

        container.innerHTML =
            `<div class="error-state">
                Forecast unavailable.
             </div>`;
    }
}


function renderForecast(
    days
) {

    const container =
        $("forecast");


    if (!days.length) {

        container.innerHTML =
            `<div class="empty-state">
                No forecast data available.
             </div>`;

        return;
    }


    container.innerHTML =
        days.map(
            day => {

                const riskLevel = day.risk || getForecastRiskLevel(safeNumber(day.htsi, 0));
                const color =
                    getRiskColor(riskLevel);
                const emoji = day.emoji || getRiskEmoji(riskLevel);


                const date =
                    formatDate(
                        day.date
                    );

                const tempVal = safeNumber(day.temperature) ?? safeNumber(day.max);
                const tempDisplay = tempVal !== null ? tempVal.toFixed(1) + "°" : "Data unavailable";
                const minVal = safeNumber(day.min);
                const minDisplay = minVal !== null ? minVal.toFixed(1) + "°C" : "--";
                const apparentVal = safeNumber(day.apparent);
                const apparentDisplay = apparentVal !== null ? apparentVal.toFixed(1) + "°C" : "--";


                return `
                    <div
                        class="forecast-card"
                        style="
                            border-color:
                            ${color}55;
                        "
                    >

                        <div class="forecast-date">
                            ${date}
                        </div>

                        <div
                            class="forecast-temp"
                        >
                            ${tempDisplay}
                        </div>

                        <div class="forecast-min">
                            Low
                            ${minDisplay}
                        </div>

                        <div class="forecast-apparent">
                            Feels like
                            ${apparentDisplay}
                        </div>

                        <div class="forecast-metric">

                            <span>
                                Estimated HTSI
                            </span>

                            <strong>
                                ${formatNumber(
                                    day.htsi,
                                    0
                                )}/100
                            </strong>

                        </div>

                        <div class="forecast-metric">

                            <span>
                                Rain
                            </span>

                            <strong>
                                ${formatNumber(
                                    day.rain,
                                    1
                                )} mm
                            </strong>

                        </div>

                        <div class="forecast-risk"
                            style="
                                color:${color};
                            "
                        >
                            ${emoji}
                            ${riskLevel}
                        </div>

                    </div>
                `;
            }
        ).join("");
}


/* ============================================================
   HOURLY
============================================================ */

async function loadHourly() {

    const tbody =
        $("hourlyTable");


    if (!tbody) {
        return;
    }


    try {

        const response =
            await fetch(
                `${API_URL}/hourly` +
                `?latitude=${currentLatitude}` +
                `&longitude=${currentLongitude}`
            );


        if (!response.ok) {
            throw new Error(
                "Hourly request failed"
            );
        }


        const data =
            await response.json();


        renderHourly(
            data.hourly || []
        );


    } catch (error) {

        console.error(
            error
        );

        tbody.innerHTML =
            `<tr>
                <td colspan="7">
                    Unable to load hourly forecast.
                </td>
             </tr>`;
    }
}


function renderHourly(
    hours
) {

    const tbody =
        $("hourlyTable");


    tbody.innerHTML =
        hours.map(
            hour => {

                const color =
                    getRiskColor(
                        hour.risk
                    );


                return `
                    <tr>

                        <td>
                            ${formatHour(
                                hour.time
                            )}
                        </td>

                        <td>
                            ${formatNumber(
                                hour.temperature
                            )}°C
                        </td>

                        <td>
                            ${formatNumber(
                                hour.humidity,
                                0
                            )}%
                        </td>

                        <td>
                            ${formatNumber(
                                hour.wind
                            )} km/h
                        </td>

                        <td>
                            ${formatNumber(
                                hour.wbgt
                            )}°C
                        </td>

                        <td
                            style="
                                font-weight:900;
                            "
                        >
                            ${formatNumber(
                                hour.htsi,
                                0
                            )}
                        </td>

                        <td
                            style="
                                color:${color};
                                font-weight:900;
                            "
                        >
                            ${hour.emoji}
                            ${hour.risk}
                        </td>

                    </tr>
                `;
            }
        ).join("");
}


/* ============================================================
   HOTSPOTS
============================================================ */

async function loadHotspots() {

    const container =
        $("hotspots");


    if (!container) {
        return;
    }


    try {

        const response =
            await fetch(
                `${API_URL}/hotspots` +
                `?latitude=${currentLatitude}` +
                `&longitude=${currentLongitude}`
            );


        if (!response.ok) {
            throw new Error(
                "Hotspot request failed"
            );
        }


        const data =
            await response.json();


        renderHotspots(
            data.hotspots || []
        );


    } catch (error) {

        console.error(
            error
        );

        container.innerHTML =
            `<div class="error-state">
                Thermal hotspot data unavailable.
             </div>`;
    }
}


function renderHotspots(
    hotspots
) {

    const container =
        $("hotspots");


    if (!hotspots.length) {

        container.innerHTML =
            `<div class="empty-state">
                No hotspots available.
             </div>`;

        return;
    }


    const top =
        hotspots[0];


    const remaining =
        hotspots.slice(1);


    const topRisk = top.risk || getRiskLevel(safeNumber(top.htsi, 0));
    const topColor =
        getRiskColor(topRisk);


    let html = `
        <div
            class="top-hotspot"
            style="
                border-color:
                ${topColor}55;
                background:
                ${RISK_BG[topRisk] || RISK_BG.LOW};
            "
        >

            <div>

                <div
                    class="top-hotspot-label"
                    style="
                        color:${topColor};
                    "
                >
                    🔥 TOP THERMAL HOTSPOT
                </div>

                <strong
                    style="
                        display:block;
                        margin-top:5px;
                    "
                >
                    ${escapeHtml(
                        top.name
                    )}
                </strong>

            </div>

            <span
                style="
                    color:${topColor};
                "
            >
                ${topRisk}
                ·
                ${formatNumber(
                    top.htsi,
                    0
                )}/100
            </span>

        </div>
    `;


    html += remaining.map(
        hotspot => {

            const riskLevel = hotspot.risk || getRiskLevel(safeNumber(hotspot.htsi, 0));
            const color =
                getRiskColor(riskLevel);
            const emoji = hotspot.emoji || getRiskEmoji(riskLevel);

            return `
                <div
                    class="hotspot-card"
                    style="
                        border-color:
                        ${color}55;
                    "
                >

                    <div class="hotspot-name">
                        ${escapeHtml(
                            hotspot.name
                        )}
                    </div>

                    <div
                        class="hotspot-score"
                    >
                        ${formatNumber(
                            hotspot.htsi,
                            0
                        )}
                    </div>

                    <div
                        style="
                            color:#657080;
                            font-size:9px;
                            margin-top:3px;
                        "
                    >
                        HTSI / 100
                    </div>

                    <div
                        class="hotspot-risk"
                        style="
                            color:${color};
                        "
                    >
                        ${emoji}
                        ${riskLevel}
                    </div>

                </div>
            `;
        }
    ).join("");


    container.innerHTML =
        html;


    renderHotspotMap(
        hotspots
    );
}




/* ============================================================
   5-DAY HUMAN IMPACT FORECAST
============================================================ */

function getTrendColor(direction) {
    const colors = {
        "STABLE": "#94a3b8",
        "RISING": "#eab308",
        "RAPIDLY RISING": "#f97316",
        "FALLING": "#22c55e"
    };

    return colors[direction] || "#94a3b8";
}


async function loadImpactForecast() {
    const container = $("impactForecast");
    const hero = $("impactHero");
    const badge = $("impactTrendBadge");
    const disclaimer = $("impactDisclaimer");

    if (!container) return;

    try {
        const response = await fetch(
            `${API_URL}/impact-forecast` +
            `?latitude=${currentLatitude}` +
            `&longitude=${currentLongitude}` +
            `&location=${encodeURIComponent(currentLocation || "Selected Location")}`
        );

        if (!response.ok) {
            throw new Error("Impact forecast request failed");
        }

        const data = await response.json();

        renderImpactForecast(data);

        if (disclaimer && data.warning) {
            disclaimer.textContent = data.warning;
        }

    } catch (error) {
        console.error("Impact forecast failed:", error);

        if (container) {
            container.innerHTML = `
                <div class="error-state">
                    Human impact forecast unavailable.
                </div>
            `;
        }

        if (hero) {
            hero.innerHTML = `
                <div class="error-state">
                    Unable to calculate future health impact.
                </div>
            `;
        }

        if (badge) {
            badge.textContent = "OFFLINE";
        }
    }
}


function renderImpactForecast(data) {
    const container = $("impactForecast");
    const hero = $("impactHero");
    const badge = $("impactTrendBadge");

    const rows = data.forecast || [];
    const trend = data.trend || {};
    const peak = data.peak || null;
    // Always define the early-warning object so the renderer is safe even
    // when older/newer backend versions return different field names.
    const earlyWarning = data.early_warning || data.earlyWarning || {
        status: peak?.thermal_risk || "MONITOR",
        label: peak?.thermal_risk === "EXTREME" ? "EXTREME FORECAST" : "FORECAST MONITORING",
        days_ahead: peak ? Number(peak.day_index || 0) : null,
        action: peak?.action || "MONITOR"
    };

    if (!container || !rows.length) return;

    const trendColor = getTrendColor(trend.direction);

    if (badge) {
        badge.textContent =
            `${trend.direction || "STABLE"} · ${trend.change >= 0 ? "+" : ""}${formatNumber(trend.change, 0)} HTSI`;

        badge.style.color = trendColor;
        badge.style.borderColor = `${trendColor}55`;
    }

    if (hero) {
        const peakLabel =
            peak
                ? `${peak.label} · ${peak.thermal_risk}`
                : "--";

        const peakColor =
            peak
                ? getRiskColor(peak.thermal_risk)
                : "#94a3b8";

        hero.innerHTML = `
            <div class="impact-hero-grid">

                <div>
                    <div class="impact-hero-label">
                        Human impact trajectory
                    </div>

                    <div
                        class="impact-hero-value"
                        style="color:${trendColor}"
                    >
                        ${escapeHtml(trend.direction || "STABLE")}
                    </div>

                    <div class="impact-hero-note">
                        ${trend.change >= 0 ? "Thermal stress increase" : "Thermal stress decrease"}
                        of ${Math.abs(Number(trend.change || 0)).toFixed(1)} points
                        across the forecast window.
                    </div>
                </div>

                <div>
                    <div class="impact-hero-label">
                        Peak forecast
                    </div>
                    <div
                        class="impact-hero-value"
                        style="color:${peakColor}"
                    >
                        ${peak ? formatNumber(peak.htsi, 0) : "--"}
                    </div>
                    <div class="impact-hero-note">
                        ${escapeHtml(peakLabel)}
                    </div>
                </div>

                <div>
                    <div class="impact-hero-label">
                        Vulnerability
                    </div>
                    <div class="impact-hero-value">
                        ${formatNumber(data.vulnerability_score, 0)}
                    </div>
                    <div class="impact-hero-note">
                        Prototype population score /100
                    </div>
                </div>

                <div>
                    <div class="impact-hero-label">
                        Early warning
                    </div>
                    <div class="impact-hero-value" style="font-size:16px">
                        ${escapeHtml(earlyWarning.label || "FORECAST MONITORING")}
                    </div>
                    <div class="impact-hero-note">
                        ${earlyWarning.days_ahead !== null && earlyWarning.days_ahead !== undefined ? `Potential peak in ${earlyWarning.days_ahead} day${Number(earlyWarning.days_ahead) === 1 ? "" : "s"}.` : "Monitor the forecast trajectory."}
                    </div>
                </div>

                <div>
                    <div class="impact-hero-label">
                        Recommended response
                    </div>
                    <div
                        class="impact-hero-value"
                        style="font-size:16px"
                    >
                        ${peak
                            ? escapeHtml(peak.action)
                            : "MONITOR"
                        }
                    </div>
                </div>

            </div>
        `;
    }

    container.innerHTML = rows.map(row => {
        const riskLevel = row.thermal_risk || getForecastRiskLevel(safeNumber(row.htsi, 0));
        const color = getRiskColor(riskLevel);
        const emoji = row.emoji || getRiskEmoji(riskLevel);
        const tempVal = safeNumber(row.temperature) ?? safeNumber(row.max);
        const tempDisplay = tempVal !== null ? tempVal.toFixed(1) + "°C" : "Data unavailable";

        return `
            <div class="impact-day-card">

                <div class="impact-day-label">
                    ${escapeHtml(row.label)}
                </div>

                <div class="impact-day-date">
                    ${formatDate(row.date)}
                </div>

                <div
                    class="impact-score"
                    style="color:${color}"
                >
                    ${formatNumber(row.htsi, 0)}
                </div>

                <div
                    class="impact-risk"
                    style="color:${color}"
                >
                    ${emoji}
                    ${escapeHtml(riskLevel)}
                </div>

                <div class="impact-mini-metrics">

                    <div class="impact-mini-metric">
                        <span>TEMP</span>
                        <strong>
                            ${tempDisplay}
                        </strong>
                    </div>

                    <div class="impact-mini-metric">
                        <span>HUMIDITY</span>
                        <strong>
                            ${safeDisplay(row.humidity, 0, "%")}
                        </strong>
                    </div>

                    <div class="impact-mini-metric">
                        <span>WBGT (proxy)</span>
                        <strong>
                            ${safeDisplay(row.wbgt, 1, "°C")}
                        </strong>
                    </div>

                    <div class="impact-mini-metric">
                        <span>PRIORITY</span>
                        <strong
                            style="color:${getPriorityColor(row.priority_level)}"
                        >
                            ${escapeHtml(row.priority_level || "ROUTINE")}
                        </strong>
                    </div>

                    <div class="impact-mini-metric">
                        <span>HOSPITAL IND.</span>
                        <strong>
                            ${safeDisplay(row.hospitalization_indicator, 0, "%")}
                        </strong>
                    </div>

                    <div class="impact-mini-metric">
                        <span>MORTALITY IND.</span>
                        <strong>
                            ${safeDisplay(row.mortality_indicator, 0, "%")}
                        </strong>
                    </div>

                </div>

                <div class="impact-action">
                    ${escapeHtml(row.action || "MONITOR")}
                </div>

            </div>
        `;
    }).join("");
}


/* ============================================================
   POPULATION VULNERABILITY
============================================================ */

function getPriorityColor(level) {
    const colors = {
        ROUTINE: "#22c55e",
        WATCH: "#eab308",
        HIGH: "#f97316",
        URGENT: "#ef4444",
        CRITICAL: "#a855f7"
    };

    return colors[level] || "#94a3b8";
}


async function loadVulnerability() {
    const table = $("vulnerabilityTable");
    const summary = $("vulnerabilitySummary");

    if (!table) return;

    try {
        const response = await fetch(
            `${API_URL}/vulnerability` +
            `?latitude=${currentLatitude}` +
            `&longitude=${currentLongitude}` +
            `&location=${encodeURIComponent(currentLocation || "Selected Location")}`
        );

        if (!response.ok) {
            throw new Error("Vulnerability request failed");
        }

        const data = await response.json();
        renderVulnerability(data.areas || data.zones || []);

    } catch (error) {
        console.error("Vulnerability load failed:", error);

        table.innerHTML = `
            <tr>
                <td colspan="8">
                    Population vulnerability data unavailable.
                </td>
            </tr>
        `;

        if (summary) {
            summary.innerHTML = "";
        }
    }
}


function renderVulnerability(zones) {
    const table = $("vulnerabilityTable");
    const summary = $("vulnerabilitySummary");

    if (!table) return;

    if (!zones.length) {
        table.innerHTML = `
            <tr>
                <td colspan="8">No vulnerability data available.</td>
            </tr>
        `;

        if (summary) summary.innerHTML = "";
        return;
    }

    const critical = zones.filter(
        zone =>
            zone.priority_level === "CRITICAL" ||
            zone.priority_level === "URGENT"
    ).length;

    const high = zones.filter(
        zone => zone.priority_level === "HIGH"
    ).length;

    const totalPopulation = zones.reduce(
        (sum, zone) => sum + Number(zone.population || 0),
        0
    );

    if (summary) {
        summary.innerHTML = `
            <div class="vulnerability-summary-card">
                <span>Zones requiring urgent action</span>
                <strong>${critical}</strong>
            </div>

            <div class="vulnerability-summary-card">
                <span>High-priority zones</span>
                <strong>${high}</strong>
            </div>

            <div class="vulnerability-summary-card">
                <span>Population represented</span>
                <strong>${formatPopulation(totalPopulation)}</strong>
            </div>
        `;
    }

    table.innerHTML = zones.map(zone => {
        const vulnColor =
            getPriorityColor(
                zone.vulnerability_level === "CRITICAL"
                    ? "CRITICAL"
                    : zone.vulnerability_level === "HIGH"
                        ? "URGENT"
                        : zone.vulnerability_level === "MODERATE"
                            ? "WATCH"
                            : "ROUTINE"
            );

        const priorityColor =
            getPriorityColor(zone.priority_level);

        const vulnScore =
            Number(zone.vulnerability_score || 0);

        return `
            <tr>
                <td class="vuln-zone">
                    ${escapeHtml(zone.name)}
                </td>

                <td>
                    ${formatPopulation(zone.population)}
                </td>

                <td>
                    ${formatNumber(zone.elderly_percent, 0)}%
                </td>

                <td>
                    ${formatNumber(zone.outdoor_worker_percent, 0)}%
                </td>

                <td>
                    ${formatNumber(zone.exposure, 0)}/100
                </td>

                <td>
                    <div class="vuln-meter">
                        <strong style="color:${vulnColor}">
                            ${formatNumber(vulnScore, 0)}
                        </strong>
                        <div class="vuln-meter-track">
                            <div
                                class="vuln-meter-fill"
                                style="
                                    width:${vulnScore}%;
                                    background:${vulnColor};
                                "
                            ></div>
                        </div>
                        <small>
                            ${escapeHtml(zone.vulnerability_level)}
                        </small>
                    </div>
                </td>

                <td>
                    <span style="color:${getRiskColor(zone.thermal_risk)}">
                        ${zone.thermal_risk}
                        · ${formatNumber(zone.htsi, 0)}
                    </span>
                </td>

                <td>
                    <span
                        class="priority-pill"
                        style="color:${priorityColor}"
                    >
                        ${escapeHtml(zone.priority_level)}
                        · ${formatNumber(zone.priority_score, 0)}
                    </span>
                </td>
            </tr>
        `;
    }).join("");
}


function formatPopulation(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toLocaleString("en-IN") : "0";
}


/* ============================================================
   SIMULATION
============================================================ */

async function runSimulation() {

    const temperature =
        Number(
            $("simTemperature").value
        );


    const humidity =
        Number(
            $("simHumidity").value
        );


    const wind =
        Number(
            $("simWind").value
        );


    const solar =
        Number(
            $("simSolar").value
        );


    if (
        !Number.isFinite(temperature) ||
        !Number.isFinite(humidity) ||
        !Number.isFinite(wind) ||
        !Number.isFinite(solar)
    ) {

        alert(
            "Please enter valid simulation values."
        );

        return;
    }


    const result =
        $("simulationResult");


    result.innerHTML =
        `
        <div class="simulation-placeholder">
            Calculating human thermal danger...
        </div>
        `;


    try {

        const params =
            new URLSearchParams({
                temperature,
                humidity,
                wind,
                solar
            });


        const response =
            await fetch(
                `${API_URL}/simulate?${params}`
            );


        if (!response.ok) {
            throw new Error(
                "Simulation failed"
            );
        }


        const data =
            await response.json();


        renderSimulation(
            data
        );


    } catch (error) {

        console.error(
            error
        );

        result.innerHTML =
            `
            <div class="error-state">
                Simulation engine unavailable.
            </div>
            `;
    }
}


/* ============================================================
   SIMULATION RENDER
============================================================ */

function renderSimulation(
    data
) {

    const result =
        $("simulationResult");


    const color =
        getRiskColor(
            data.risk
        );


    result.innerHTML =
        `
        <div>

            <div class="section-label">
                SIMULATED HUMAN THERMAL DANGER
            </div>

            <div
                class="simulation-score"
                style="
                    color:${color};
                "
            >
                ${formatNumber(
                    data.htsi,
                    0
                )}
                <span
                    style="
                        color:#657080;
                        font-size:16px;
                        letter-spacing:0;
                    "
                >
                    /100
                </span>
            </div>

            <div
                class="simulation-risk"
                style="
                    color:${color};
                "
            >
                ${data.emoji}
                ${data.risk} THERMAL RISK
            </div>

            <div class="simulation-metrics">

                <div class="simulation-metric">

                    <span>
                        HEAT INDEX
                    </span>

                    <strong>
                        ${formatNumber(
                            data.heat_index
                        )}°C
                    </strong>

                </div>

                <div class="simulation-metric">

                    <span>
                        WBGT
                    </span>

                    <strong>
                        ${formatNumber(
                            data.wbgt
                        )}°C
                    </strong>

                </div>

                <div class="simulation-metric">

                    <span>
                        UTCI PROXY
                    </span>

                    <strong>
                        ${formatNumber(
                            data.utci
                        )}°C
                    </strong>

                </div>

            </div>

            <div class="simulation-health">

                Estimated hospitalization risk indicator:

                <strong>
                    ${formatNumber(
                        data.health.hospitalization
                    )}%
                </strong>

                <br>

                Estimated mortality risk indicator:

                <strong>
                    ${formatNumber(
                        data.health.mortality
                    )}%
                </strong>

            </div>

            <p
                style="
                    margin-top:18px;
                    color:#8c98a8;
                    line-height:1.7;
                    font-size:12px;
                "
            >
                ${escapeHtml(
                    data.message
                )}
            </p>

        </div>
        `;
}


/* ============================================================
   DATE / TIME FORMATTERS
============================================================ */

function formatDate(
    dateString
) {

    if (!dateString) {
        return "--";
    }


    const date =
        new Date(
            `${dateString}T00:00:00`
        );


    return date.toLocaleDateString(
        undefined,
        {
            weekday: "short",
            month: "short",
            day: "numeric"
        }
    );
}


function formatHour(
    value
) {

    if (!value) {
        return "--";
    }


    const parts =
        value.split("T");


    if (parts.length < 2) {
        return value;
    }


    return parts[1].slice(
        0,
        5
    );
}


/* ============================================================
   ERROR
============================================================ */

function showError(
    message
) {

    setText(
        "riskLevel",
        "OFFLINE"
    );


    setText(
        "riskMessage",
        message
    );


    setText(
        "riskEmoji",
        "⚠️"
    );


    setText(
        "htsiScore",
        "--"
    );


    const progress =
        $("riskProgress");


    if (progress) {

        progress.style.width =
            "0%";

        progress.style.background =
            "#64748b";
    }
}


/* ============================================================
   SECURITY / HTML ESCAPING
============================================================ */

function escapeHtml(
    value
) {

    return String(
        value ?? ""
    )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}


/* ============================================================
   EVENTS
============================================================ */

let refreshTimer = null;

async function checkSystemStatus() {
    const dot = document.querySelector(".status-dot");
    const label = document.querySelector(".system-status");
    try {
        const response = await fetch(`${API_URL}/health`, { cache: "no-store" });
        if (!response.ok) throw new Error("API offline");
        if (dot) dot.style.background = "#22c55e";
        if (label) label.innerHTML = '<span class="status-dot"></span> SYSTEM ONLINE';
    } catch (error) {
        if (dot) dot.style.background = "#ef4444";
        if (label) label.innerHTML = '<span class="status-dot"></span> API OFFLINE';
        console.warn("HeatHealthAI API health check failed.");
    }
}

function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);

    // Refresh live analysis every 10 minutes. Manual Analyze still works immediately.
    refreshTimer = setInterval(async () => {
        await checkSystemStatus();
        await analyzeLocation();
    }, 10 * 60 * 1000);
}


document.addEventListener(
    "DOMContentLoaded",
    () => {

        initializeMap();


        const form =
            $("analysisForm");


        if (form) {

            form.addEventListener(
                "submit",
                event => {

                    event.preventDefault();

                    analyzeLocation();
                }
            );
        }


        const simulationButton =
            $("simulateBtn");


        if (simulationButton) {

            simulationButton.addEventListener(
                "click",
                runSimulation
            );
        }


        const loadZoneBtn = $("loadZonePopulationBtn");
        if (loadZoneBtn) loadZoneBtn.addEventListener("click", loadZonePopulation);
        const zoneSelect = $("alertZone");
        if (zoneSelect) zoneSelect.addEventListener("change", loadZonePopulation);
        const zoneSmsBtn = $("broadcastSmsBtn");
        if (zoneSmsBtn) zoneSmsBtn.addEventListener("click", () => simulateZoneBroadcast("sms"));
        const zoneWhatsappBtn = $("broadcastWhatsappBtn");
        if (zoneWhatsappBtn) zoneWhatsappBtn.addEventListener("click", () => simulateZoneBroadcast("whatsapp"));
        loadZonePopulation();

        // Automatically analyze Visakhapatnam (Vizag)
        // when dashboard opens.
        checkSystemStatus();
        analyzeLocation();
        startAutoRefresh();
    }
);