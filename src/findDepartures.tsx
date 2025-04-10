// src/findDepartures.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { ActionPanel, Action, List, Icon, showToast, Toast, Color, LocalStorage } from "@raycast/api";
import { useFavorites } from "./hooks/useFavorites";
import { fetchStations } from "./utils/api";
import { FilterableSystem, Station, StationListItemProps } from "./types";
import StationDepartures from "./components/StationDepartures";
import ViewAlertsCommand from "./viewAlerts";

// Define the possible values for our system filter dropdown
const systemFilters = ["All", "SUBWAY", "LIRR", "MNR"] as const;

// Display names for the UI
const systemFilterDisplayNames = {
  All: "All",
  SUBWAY: "Subway",
  LIRR: "LIRR",
  MNR: "MNR",
} as const;

type SystemFilterValue = (typeof systemFilters)[number]; // Type: "ALL" | "SUBWAY" | "LIRR" | "MNR"

// Map filter values to API parameter values ('All' maps to undefined)
type ApiSystemFilter = "SUBWAY" | "LIRR" | "MNR";
const filterValueToApiParam = (filter: SystemFilterValue): ApiSystemFilter | undefined => {
  if (filter === "All") return undefined;
  return filter as ApiSystemFilter;
};

// Update the StationListItemProps interface to include onRefresh
interface ExtendedStationListItemProps extends StationListItemProps {
  onRefresh: () => void;
}

const STATION_LIST_CACHE_KEY = "cachedStationList";
const STATION_LIST_TIMESTAMP_KEY = "cachedStationListTimestamp";
const STATION_LIST_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

export default function FindDeparturesCommand() {
  const [searchText, setSearchText] = useState("");
  const [selectedSystem, setSelectedSystem] = useState<SystemFilterValue>("All");
  const [allStations, setAllStations] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { addFavorite, removeFavorite, isFavorite } = useFavorites();

  const loadStations = useCallback(async (currentSearchText: string, systemFilterValue: SystemFilterValue) => {
    setIsLoading(true);
    const apiSystemFilter = filterValueToApiParam(systemFilterValue);

    try {
      // First check if we have a valid timestamp
      const timestampStr = await LocalStorage.getItem<string>(STATION_LIST_TIMESTAMP_KEY);
      const timestamp = timestampStr ? parseInt(timestampStr, 10) : 0;

      // If we have a valid timestamp and it's fresh enough
      if (timestamp && Date.now() - timestamp < STATION_LIST_CACHE_TTL) {
        console.log("Using cached station list");
        const cachedData = await LocalStorage.getItem<string>(STATION_LIST_CACHE_KEY);
        if (cachedData) {
          const stations = JSON.parse(cachedData);
          setAllStations(stations);
          setIsLoading(false);
          return;
        }
      }

      console.log(
        `Fetching stations for search: "${currentSearchText}", system: "${systemFilterValue}" (API Param: ${apiSystemFilter})`,
      );
      const stations = await fetchStations(currentSearchText, apiSystemFilter);

      // Cache the data and timestamp separately
      await Promise.all([
        LocalStorage.setItem(STATION_LIST_CACHE_KEY, JSON.stringify(stations)),
        LocalStorage.setItem(STATION_LIST_TIMESTAMP_KEY, Date.now().toString()),
      ]);

      setAllStations(stations);
    } catch (err: unknown) {
      console.error("Failed to fetch stations:", err);
      const message = err instanceof Error ? err.message : "Could not load station data.";
      showToast({ style: Toast.Style.Failure, title: "Error Loading Stations", message: message });
      setAllStations([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStations(searchText, selectedSystem);
  }, [searchText, selectedSystem, loadStations]);

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
  }, [allStations, isFavorite]);

  const showFavorites = searchText === "" && favoriteStations.length > 0;
  const showOthers = otherStations.length > 0;

  const handleRefresh = async () => {
    // Show loading toast
    await showToast({ style: Toast.Style.Animated, title: "Refreshing station list..." });

    try {
      console.log("Refresh started: Clearing cache");
      // Clear cache
      await Promise.all([
        LocalStorage.removeItem(STATION_LIST_CACHE_KEY),
        LocalStorage.removeItem(STATION_LIST_TIMESTAMP_KEY),
      ]);

      // Set loading state explicitly
      setIsLoading(true);

      // Instead of calling loadStations, directly fetch to avoid the caching logic
      const apiSystemFilter = filterValueToApiParam(selectedSystem);
      console.log(
        `About to fetch fresh data for system: "${selectedSystem}", filter: ${apiSystemFilter}, searchText: "${searchText}"`,
      );

      // Add a flag to force the API call
      const stations = await fetchStations(searchText, apiSystemFilter, true); // Add a forceRefresh parameter
      console.log(`Fetch completed, received ${stations.length} stations`);

      // Save the new data to cache
      console.log("Updating cache with fresh data");
      await Promise.all([
        LocalStorage.setItem(STATION_LIST_CACHE_KEY, JSON.stringify(stations)),
        LocalStorage.setItem(STATION_LIST_TIMESTAMP_KEY, Date.now().toString()),
      ]);

      // Update the state with the new data
      setAllStations(stations);

      // Show success toast
      await showToast({ style: Toast.Style.Success, title: "Station list refreshed" });
      console.log("Refresh completed successfully");
    } catch (error) {
      console.error("Failed to refresh station list:", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to refresh station list",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search LIRR/Subway/MNR Stations..."
      throttle
      navigationTitle="Find Transit Departures"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by Transit System"
          storeValue={true}
          value={selectedSystem}
          onChange={(newValue) => {
            setSelectedSystem(newValue as SystemFilterValue);
          }}
        >
          <List.Dropdown.Section title="Filter by System">
            {systemFilters.map((filter) => (
              <List.Dropdown.Item key={filter} title={systemFilterDisplayNames[filter]} value={filter} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {showFavorites && (
        <List.Section title="Favorites">
          {favoriteStations.map((station) => (
            <StationListItem
              key={`fav-${station.id}`}
              station={station}
              isFavorite={true}
              addFavorite={addFavorite}
              removeFavorite={removeFavorite}
              onRefresh={handleRefresh}
            />
          ))}
        </List.Section>
      )}

      {showOthers && (
        <List.Section
          title={searchText === "" ? (showFavorites ? "Other Stations" : "All Stations") : "Search Results"}
        >
          {otherStations.map((station) => (
            <StationListItem
              key={`station-${station.id}`}
              station={station}
              isFavorite={isFavorite(station.id)}
              addFavorite={addFavorite}
              removeFavorite={removeFavorite}
              onRefresh={handleRefresh}
            />
          ))}
        </List.Section>
      )}

      {searchText !== "" && !showOthers && !isLoading && (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No Stations Found"
          description={`Couldn't find stations matching "${searchText}".`}
        />
      )}

      {searchText === "" && !showFavorites && !showOthers && !isLoading && (
        <List.EmptyView
          icon={Icon.Train}
          title="No Stations Found"
          description="No stations found. Try searching or refreshing."
        />
      )}
    </List>
  );
}

// Station List Item component
function StationListItem({
  station,
  isFavorite,
  addFavorite,
  removeFavorite,
  onRefresh,
}: ExtendedStationListItemProps) {
  const accessories: List.Item.Accessory[] = [];

  // Add Lines Accessory
  if (station.lines && station.lines.length > 0) {
    accessories.push({
      // Use tag for compact display, or text if preferred
      tag: { value: station.lines.join(" "), color: Color.PrimaryText }, // Display lines separated by space in a tag
      // text: station.lines.join(", "), // Alternative: comma-separated text
      tooltip: `Lines: ${station.lines.join(", ")}`,
      icon: Icon.Train, // Use a relevant icon
    });
  }

  // Add System Accessory
  if (station.system) {
    let systemColor = Color.SecondaryText;
    if (station.system === "SUBWAY") systemColor = Color.Blue;
    else if (station.system === "LIRR") systemColor = Color.Green;
    else if (station.system === "MNR") systemColor = Color.Red;
    accessories.push({
      tag: {
        value: systemFilterDisplayNames[station.system as keyof typeof systemFilterDisplayNames],
        color: systemColor,
      },
    });
  }

  return (
    <List.Item
      title={station.name}
      icon={Icon.Pin} // Keep generic pin or choose based on system later
      accessories={accessories} // <-- Use the generated accessories array
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.Push
              title="View Departures"
              icon={Icon.Clock}
              target={
                <StationDepartures
                  station={{
                    id: station.id,
                    name: station.name,
                    system: station.system as FilterableSystem,
                  }}
                />
              }
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
            <Action
              title="Refresh Station List"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={onRefresh}
            />
            <Action.Push title="View Service Alerts" icon={Icon.Bell} target={<ViewAlertsCommand />} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
