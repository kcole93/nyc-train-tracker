// src/findDepartures.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { ActionPanel, Action, List, Icon, showToast, Toast, Color } from "@raycast/api";
import { useFavorites } from "./hooks/useFavorites"; // Hook for managing favorite IDs
import { fetchStations } from "./utils/api"; // API utility to fetch from your wrapper
import { FilterableSystem, Station } from "./types"; // Import types
import StationDepartures from "./components/StationDepartures"; // Component to show departures
import ViewAlertsCommand from "./viewAlerts"; // Component/Command to show alerts

// --- Constants for Dropdown ---
const systemFilters = ["All", "SUBWAY", "LIRR", "MNR"] as const;
const systemFilterDisplayNames = {
  All: "All Systems", // Slightly clearer display name
  SUBWAY: "Subway",
  LIRR: "LIRR",
  MNR: "Metro-North",
} as const;
type SystemFilterValue = (typeof systemFilters)[number];
type ApiSystemFilter = "SUBWAY" | "LIRR" | "MNR";

// Helper to convert dropdown value to API parameter
const filterValueToApiParam = (filter: SystemFilterValue): ApiSystemFilter | undefined => {
  if (filter === "All") return undefined;
  return filter as ApiSystemFilter;
};
// --- End Constants ---

export default function FindDeparturesCommand() {
  // --- State ---
  const [searchText, setSearchText] = useState<string>(""); // User's search input
  const [selectedSystem, setSelectedSystem] = useState<SystemFilterValue>("All"); // Dropdown selection
  const [allStations, setAllStations] = useState<Station[]>([]); // Holds the FULL list for the selected system
  const [isLoading, setIsLoading] = useState<boolean>(true); // Loading state for API calls
  const [error, setError] = useState<string | null>(null); // Error message state
  const { addFavorite, removeFavorite, isFavorite } = useFavorites(); // Favorites management
  // --- End State ---

  // --- Data Fetching Logic (No Caching) ---
  const loadStations = useCallback(async (systemFilterValue: SystemFilterValue) => {
    setIsLoading(true);
    setError(null);
    const apiSystemFilter = filterValueToApiParam(systemFilterValue);
    console.log(`Fetching stations list for system: "${systemFilterValue}" (API Param: ${apiSystemFilter}) - NO CACHE`);

    try {
      // Fetch WITHOUT searchText - always get full list for the system
      const stations = await fetchStations(undefined, apiSystemFilter);
      setAllStations(stations); // Update state with fetched data
    } catch (err: unknown) {
      console.error("Failed to fetch stations:", err);
      const message = err instanceof Error ? err.message : "Could not load station data.";
      setError(message);
      showToast({ style: Toast.Style.Failure, title: "Error Loading Stations", message: message });
      setAllStations([]); // Clear data on error
    } finally {
      setIsLoading(false);
    }
  }, []); // useCallback dependencies are empty as fetchStations is stable

  // --- Manual Refresh Handler (No Cache Clearing) ---
  const handleRefresh = useCallback(async () => {
    await showToast({ style: Toast.Style.Animated, title: "Refreshing station list..." });
    // Just call loadStations for the current system, no forceRefresh needed
    await loadStations(selectedSystem);
    await showToast({ style: Toast.Style.Success, title: "Station list refreshed" });
  }, [loadStations, selectedSystem]);

  // --- useEffect: Load based on selectedSystem ONLY ---
  useEffect(() => {
    loadStations(selectedSystem); // Load when system changes or on mount
  }, [selectedSystem, loadStations]); // Depend only on system filter and load function

  // --- useMemo to Split Stations for Section Rendering ---
  // This still splits the current 'allStations' list for display structure
  const { favoriteStations, otherStations } = useMemo(() => {
    const favorites: Station[] = [];
    const others: Station[] = [];
    allStations.forEach((station) => {
      if (isFavorite(station.id)) {
        favorites.push(station);
      } else {
        others.push(station);
      }
    });
    favorites.sort((a, b) => a.name.localeCompare(b.name));
    others.sort((a, b) => a.name.localeCompare(b.name));
    return { favoriteStations: favorites, otherStations: others };
  }, [allStations, isFavorite]); // Re-run when allStations or favorites change

  // --- Conditional rendering flags ---
  const hasFavorites = favoriteStations.length > 0;
  const hasOthers = otherStations.length > 0;
  const showEmptyView = !isLoading && !error && !hasFavorites && !hasOthers;
  // ---

  // --- Render Component ---
  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filtering={true}
      searchBarPlaceholder="Search Stations..."
      navigationTitle="Find Transit Departures"
      // Dropdown to filter by system
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by Transit System"
          storeValue={true} // Keep storing dropdown UI state
          value={selectedSystem}
          onChange={(newValue) => {
            setSelectedSystem(newValue as SystemFilterValue);
          }}
        >
          <List.Dropdown.Section title="Filter by System">
            {systemFilters.map((filter) => (
              <List.Dropdown.Item
                key={filter}
                title={systemFilterDisplayNames[filter]}
                value={filter}
                // Basic icons
                icon={
                  filter === "SUBWAY"
                    ? Icon.Train // Use specific icon if available
                    : filter === "LIRR"
                      ? Icon.Train
                      : filter === "MNR"
                        ? Icon.Train
                        : Icon.BulletPoints // "All"
                }
              />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
      // Global actions
      actions={
        <ActionPanel title="List Actions">
          <Action
            title="Refresh Station List"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={handleRefresh} // Use manual refresh handler
          />
          <Action.Push title="View Service Alerts" icon={Icon.Bell} target={<ViewAlertsCommand />} />
        </ActionPanel>
      }
    >
      {/* Error View */}
      {error && !isLoading && <List.EmptyView icon={Icon.Warning} title="Error Loading Stations" description={error} />}

      {/* --- Render Both Sections - Raycast Filters Items INSIDE --- */}
      {!isLoading && !error && (
        <>
          {/* Favorites Section - Rendered if favorites exist */}
          {hasFavorites && (
            <List.Section title="Favorites">
              {favoriteStations.map((station) => (
                <StationListItem
                  key={`fav-${station.id}`}
                  station={station}
                  isFavorite={true}
                  addFavorite={addFavorite}
                  removeFavorite={removeFavorite}
                />
              ))}
            </List.Section>
          )}

          {/* Other Stations Section - Rendered if others exist */}
          {hasOthers && (
            <List.Section title={hasFavorites ? "Other Stations" : "Stations"}>
              {otherStations.map((station) => (
                <StationListItem
                  key={`other-${station.id}`}
                  station={station}
                  isFavorite={false}
                  addFavorite={addFavorite}
                  removeFavorite={removeFavorite}
                />
              ))}
            </List.Section>
          )}
        </>
      )}
      {/* --- End Render Both Sections --- */}

      {/* Empty View (Only shown if BOTH sections would be empty AND not loading/error) */}
      {showEmptyView && (
        <List.EmptyView
          icon={searchText ? Icon.MagnifyingGlass : Icon.Train}
          title={searchText ? "No Stations Found" : "No Stations Loaded"}
          description={
            searchText
              ? `Couldn't find stations matching "${searchText}" for the selected system.`
              : `No station data found for the selected system.`
          }
        />
      )}
    </List>
  );
}

// --- Station List Item Component ---
interface StationListItemProps {
  station: Station;
  isFavorite: boolean;
  addFavorite: (id: string) => void;
  removeFavorite: (id: string) => void;
}

function StationListItem({ station, isFavorite, addFavorite, removeFavorite }: StationListItemProps) {
  const accessories: List.Item.Accessory[] = [];

  // Lines Accessory
  if (station.lines && station.lines.length > 0) {
    accessories.push({
      tag: { value: station.lines.join(" "), color: Color.SecondaryText },
      tooltip: `Lines: ${station.lines.join(", ")}`,
      icon: Icon.Train,
    });
  }

  // System Accessory
  if (station.system) {
    let systemColor = Color.SecondaryText;
    if (station.system === "SUBWAY") systemColor = Color.Blue;
    else if (station.system === "LIRR") systemColor = Color.Green;
    else if (station.system === "MNR") systemColor = Color.Red;
    // Use display name for tag
    accessories.push({
      tag: {
        value: systemFilterDisplayNames[station.system as keyof typeof systemFilterDisplayNames] || station.system,
        color: systemColor,
      },
    });
  }

  return (
    <List.Item
      title={station.name}
      keywords={[station.name]}
      icon={Icon.Pin} // TODO: Could use system-specific icon here
      accessories={accessories}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.Push
              title="View Departures"
              icon={Icon.Clock}
              target={<StationDepartures station={station as Station & { system: FilterableSystem }} />}
            />
            {isFavorite ? (
              <Action
                title="Remove from Favorites"
                icon={Icon.StarDisabled}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                onAction={() => removeFavorite(station.id)}
              />
            ) : (
              <Action
                title="Add to Favorites"
                icon={Icon.Star}
                shortcut={{ modifiers: ["cmd"], key: "f" }}
                onAction={() => addFavorite(station.id)}
              />
            )}
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy Station Name"
              content={station.name}
              shortcut={{ modifiers: ["cmd"], key: "." }}
            />
            <Action.CopyToClipboard
              title="Copy Station ID"
              content={station.id}
              shortcut={{ modifiers: ["cmd", "shift"], key: "." }}
            />
            <Action.Push title="View Service Alerts" icon={Icon.Bell} target={<ViewAlertsCommand />} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
