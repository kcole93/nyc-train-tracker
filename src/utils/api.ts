import {
  Station,
  Departure,
  ServiceAlert,
  ProcessedDeparture,
  ProcessedServiceAlert,
  FilterableSystem,
  ErrorResponse,
} from "../types";

const API_BASE_URL = process.env.API_URL || "http://localhost:3000/api/v1";

class APIError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "APIError";
    this.statusCode = statusCode;
  }
}

function isErrorResponse(data: unknown): data is ErrorResponse {
  if (typeof data !== "object" || data === null) return false;

  const candidate = data as Record<string, unknown>;

  return (
    "error" in candidate &&
    candidate.error !== null &&
    typeof candidate.error === "object" &&
    candidate.error !== null &&
    "message" in (candidate.error as Record<string, unknown>) &&
    typeof (candidate.error as Record<string, unknown>).message === "string"
  );
}

async function fetchFromWrapper<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log(`[Raycast API Util] Fetching from: ${url}`);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    // Check content type before parsing JSON
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      console.error(`[Raycast API Util] Expected JSON response but got ${contentType} from ${url}`);
      throw new APIError(`Invalid response format received from server.`, response.status);
    }

    const data = await response.json();

    // Check if the response is an error response
    if (!response.ok) {
      if (isErrorResponse(data)) {
        throw new APIError(data.error.message || `HTTP error! status: ${response.status}`, response.status);
      }
      throw new APIError(`HTTP error! status: ${response.status}`, response.status);
    }

    // Check for error format in successful response
    if (isErrorResponse(data)) {
      throw new APIError(data.error.message, response.status);
    }

    return data as T;
  } catch (error) {
    console.error(`[Raycast API Util] Network or parsing error fetching ${url}:`, error);
    if (error instanceof APIError) {
      throw error;
    } else if (error instanceof Error) {
      throw new APIError(error.message);
    } else {
      throw new APIError("An unknown network error occurred.");
    }
  }
}

// --- API Functions ---

export async function fetchStations(
  query?: string,
  system?: FilterableSystem,
  forceRefresh: boolean = false,
): Promise<Station[]> {
  let endpoint = "/stations";
  const params = new URLSearchParams();
  if (query) {
    params.append("q", query);
  }
  // Append system ONLY if it's provided and not 'All'
  if (system) {
    params.append("system", system);
  }
  if (forceRefresh) {
    params.append("_", Date.now().toString());
  }

  const queryString = params.toString();
  if (queryString) {
    endpoint += `?${queryString}`;
  }

  return fetchFromWrapper<Station[]>(endpoint);
}

// Wrapper type for departures
export async function fetchDepartures(
  stationId: string,
  limitMinutes?: number, // Add optional limit parameter
  source?: "scheduled" | "realtime",
): Promise<ProcessedDeparture[]> {
  // Returns raw Departure[] with string dates
  if (!stationId) return [];

  let endpoint = `/departures/${stationId}`;
  // Append limitMinutes if provided and valid
  if (limitMinutes && limitMinutes > 0) {
    endpoint += `?limitMinutes=${limitMinutes}`;
  }
  if (source) {
    endpoint += `&source=${source}`;
  }

  const rawDepartures = await fetchFromWrapper<Departure[]>(endpoint);

  const processedDepartures: ProcessedDeparture[] = rawDepartures.map((dep) => ({
    ...dep,
    departureTime: dep.departureTime ? new Date(dep.departureTime) : null,
    systemRouteId: dep.routeId ? `${dep.system}-${dep.routeId}` : "",
    delayMinutes: dep.delayMinutes ? Number(dep.delayMinutes) : null,
  }));

  return processedDepartures;
}

// Wrapper type for alerts
export async function fetchAlerts(
  targetLines?: string[], // Array of line identifiers (e.g., SystemId-RouteId)
  stationId?: string, // Optional station ID to filter by
): Promise<ProcessedServiceAlert[]> {
  // Construct endpoint with optional parameters
  const params = new URLSearchParams();
  if (targetLines && targetLines.length > 0) {
    params.append("lines", targetLines.join(","));
  }
  // Always get active alerts only
  params.append("activeNow", "true");
  // Always include human-friendly labels
  params.append("includeLabels", "true");

  if (stationId) {
    params.append("stationId", stationId);
  }
  const queryString = params.toString();
  const endpoint = `/alerts${queryString ? `?${queryString}` : ""}`;

  // Fetch raw data
  const rawAlerts = await fetchFromWrapper<ServiceAlert[]>(endpoint);

  // Convert date strings before returning
  const processedAlerts: ProcessedServiceAlert[] = rawAlerts.map((alert) => ({
    ...alert,
    affectedLines: alert.affectedLines || [],
    affectedStations: alert.affectedStations || [],
    startDate: alert.startDate ? new Date(alert.startDate) : undefined,
    endDate: alert.endDate ? new Date(alert.endDate) : undefined,
  }));

  return processedAlerts;
}
