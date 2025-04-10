// src/findDepartures.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { ActionPanel, Action, List, Icon, showToast, Toast, Color } from "@raycast/api";
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

export default function FindDeparturesCommand() {
  const [searchText, setSearchText] = useState("");
  const [selectedSystem, setSelectedSystem] = useState<SystemFilterValue>("All");
  const [allStations, setAllStations] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { addFavorite, removeFavorite, isFavorite } = useFavorites();

  const loadStations = useCallback(async (currentSearchText: string, systemFilterValue: SystemFilterValue) => {
    setIsLoading(true);
    const apiSystemFilter = filterValueToApiParam(systemFilterValue); // Convert dropdown value to API param
    console.log(
      `Fetching stations for search: "${currentSearchText}", system: "${systemFilterValue}" (API Param: ${apiSystemFilter})`,
    );
    try {
      // Pass the filter to fetchStations
      const stations = await fetchStations(currentSearchText, apiSystemFilter);
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

  const handleRefresh = () => {
    showToast({
      style: Toast.Style.Animated,
      title: "Refreshing station list...",
    });
    loadStations(searchText, selectedSystem);
  };

  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filtering={true}
      searchBarPlaceholder="Search Stations..."
      navigationTitle="Find Transit Departures"
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
                icon={
                  filter === "SUBWAY"
                    ? Icon.Train
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
      accessories={accessories}
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
