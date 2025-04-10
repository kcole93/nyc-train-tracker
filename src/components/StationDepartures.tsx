// src/components/StationDepartures.tsx
import { useState, useEffect, useCallback } from "react";
import { ActionPanel, Action, List, Icon, Color, showToast, Toast } from "@raycast/api";
import { fetchDepartures } from "../utils/api";
import { FilterableSystem, ProcessedDeparture } from "../types";
import ViewAlertsCommand from "../viewAlerts";
import { formatDepartureTime, getCopyContent } from "../utils/dateUtils";
import { DepartureDetails } from "./DepartureDetails";

interface StationDeparturesProps {
  station: {
    id: string;
    name: string;
    system: FilterableSystem;
  };
  limitMinutes?: number;
}

// --- Time Limit Options ---
const timeLimitOptions = [
  { title: "Next 10 Minutes", value: 10 },
  { title: "Next 30 Minutes", value: 30 },
  { title: "Next Hour", value: 60 },
  { title: "Next 2 Hours", value: 120 },
  { title: "Show All", value: 0 }, // Use 0 or undefined to represent no limit
];
type TimeLimitValue = number; // Type for the state

// Helper function for status styling
function getStatusAccessory(status: string): List.Item.Accessory {
  const lowerStatus = status.toLowerCase();
  if (lowerStatus.includes("delay")) return { text: status, icon: { source: Icon.Clock, tintColor: Color.Yellow } };
  if (lowerStatus.includes("cancel")) return { text: status, icon: { source: Icon.XMarkCircle, tintColor: Color.Red } };
  if (lowerStatus.includes("on time"))
    return { text: "On Time", icon: { source: Icon.CheckCircle, tintColor: Color.Green } };
  return { text: status }; // Default
}

export default function StationDepartures({ station, limitMinutes }: StationDeparturesProps) {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedLimit, setSelectedLimit] = useState<TimeLimitValue>(limitMinutes || 60); // Default to 1 hour
  const [processedDepartures, setProcessedDepartures] = useState<ProcessedDeparture[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Callback to fetch and update the CACHE with RAW data
  const loadDepartures = useCallback(
    async (showLoadingToast = false) => {
      setIsLoading(true);
      setError(null);
      if (showLoadingToast) {
        showToast({ style: Toast.Style.Animated, title: "Refreshing Departures..." });
      }

      try {
        // Pass the selected limit (0 means undefined/no limit for the API call)
        const limitParam = selectedLimit > 0 ? selectedLimit : undefined;
        const departuresWithDates: ProcessedDeparture[] = await fetchDepartures(station.id, limitParam);
        setProcessedDepartures(departuresWithDates);

        if (showLoadingToast) {
          showToast({ style: Toast.Style.Success, title: "Departures Updated" });
        }
      } catch (err: unknown) {
        // Type catch parameter
        console.error("Failed to fetch departures:", err);
        const message = err instanceof Error ? err.message : `Could not load departures for ${station.name}.`;
        setError(message);
        showToast({ style: Toast.Style.Failure, title: "Error", message: message });
        setProcessedDepartures([]); // Clear data on error
      } finally {
        setIsLoading(false);
      }
    },
    [station.id, selectedLimit, setProcessedDepartures], // Keep dependencies for useCallback
  );

  // Effect to load data initially or if cache is stale
  useEffect(() => {
    loadDepartures(); // Load when stationId or selectedLimit changes
    // Optional: Interval refresh
  }, [loadDepartures, selectedLimit]); // Depend on selectedLimit

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Departures from ${station.name}`}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter Departures by Time"
          storeValue={true} // Remember selection
          value={selectedLimit.toString()} // Dropdown value is string
          onChange={(newValue) => {
            setSelectedLimit(parseInt(newValue, 10)); // Convert back to number for state
          }}
        >
          <List.Dropdown.Section title="Show Departures Within">
            {timeLimitOptions.map((option) => (
              <List.Dropdown.Item
                key={option.value.toString()}
                title={option.title}
                value={option.value.toString()} // Dropdown value must be string
              />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
      actions={
        <ActionPanel title={`Actions for ${station.name}`}>
          <Action
            title="Refresh Departures"
            icon={Icon.ArrowClockwise}
            onAction={() => loadDepartures(true)}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
          />
          <Action.Push title="View Service Alerts" icon={Icon.Bell} target={<ViewAlertsCommand />} />
          {/* Add other global actions if needed */}
        </ActionPanel>
      }
    >
      {error && <List.EmptyView icon={Icon.Warning} title="Error" description={error} />}
      {!isLoading &&
        !error &&
        processedDepartures.length === 0 && ( // Use processed list length check
          <List.EmptyView
            icon={Icon.Train}
            title="No Departures"
            description={`No upcoming departures found for ${station.name}.`}
          />
        )}

      {!isLoading &&
        !error &&
        processedDepartures.length > 0 &&
        // First group by borough
        Object.entries(
          processedDepartures.reduce(
            (acc, dep) => {
              const borough = dep.destinationBorough || "Outbound";
              if (!acc[borough]) acc[borough] = [];
              acc[borough]?.push(dep);
              return acc;
            },
            {} as { [key: string]: ProcessedDeparture[] },
          ),
        )
          // Then sort sections based on system type
          .sort(([boroughA], [boroughB]) => {
            // For LIRR and MNR stations, prioritize Outbound
            if (station.system === "LIRR" || station.system === "MNR") {
              if (boroughA === "Outbound") return -1;
              if (boroughB === "Outbound") return 1;
              return 0;
            }
            // For SUBWAY, maintain alphabetical order
            return boroughA.localeCompare(boroughB);
          })
          .map(([borough, departuresInSection]) => {
            // Make sure departuresInSection is not undefined (shouldn't be if key exists)
            if (!departuresInSection || departuresInSection.length === 0) return null;

            // Create a user-friendly title for the section
            let sectionTitle = `${borough}-Bound Departures`;
            if (borough === "Outbound") sectionTitle = "Outbound Departures";

            return (
              <List.Section key={borough} title={sectionTitle}>
                {/* Map over departures *within this section* */}
                {departuresInSection.map((dep) => (
                  <List.Item
                    key={`${dep.tripId || "no-trip"}-${dep.routeId || "no-route"}-${dep.departureTime?.toISOString() || "no-time"}`}
                    title={dep.destination}
                    //subtitle={dep.routeLongName || dep.routeShortName}
                    icon={{ source: Icon.Train, tintColor: Color.PrimaryText }}
                    accessories={[
                      ...(dep.routeShortName && dep.routeLongName && dep.routeLongName !== ""
                        ? [
                            {
                              tag: {
                                value: `${dep.routeShortName}: ${dep.routeLongName}`,
                                color: {
                                  light: dep.routeColor ? `#${dep.routeColor}` : Color.SecondaryText,
                                  dark: dep.routeColor ? `#${dep.routeColor}` : Color.SecondaryText,
                                  adjustContrast: true,
                                },
                              },
                            },
                          ]
                        : dep.routeLongName && dep.routeLongName !== ""
                          ? [
                              {
                                tag: {
                                  value: dep.routeLongName,
                                  color: {
                                    light: dep.routeColor ? `#${dep.routeColor}` : Color.SecondaryText,
                                    dark: dep.routeColor ? `#${dep.routeColor}` : Color.SecondaryText,
                                    adjustContrast: true,
                                  },
                                },
                              },
                            ]
                          : []),
                      ...(dep.track ? [{ text: `Track ${dep.track}`, icon: Icon.Pin }] : []),
                      ...(dep.peakStatus === "Peak"
                        ? [
                            {
                              tag: {
                                value: dep.peakStatus,
                                color: {
                                  light: Color.Orange,
                                  dark: Color.Orange,
                                  adjustContrast: true,
                                },
                              },
                            },
                          ]
                        : []),
                      { text: formatDepartureTime(dep.departureTime), icon: Icon.Clock },
                      getStatusAccessory(dep.status),
                    ]}
                    actions={
                      <ActionPanel>
                        <ActionPanel.Section>
                          <Action
                            title="Refresh Departures"
                            icon={Icon.ArrowClockwise}
                            onAction={() => loadDepartures(true)}
                            shortcut={{ modifiers: ["cmd"], key: "r" }}
                          />
                          {dep.routeShortName && dep.routeShortName !== "" && (
                            <Action.Push
                              title={`View Active Alerts for Line ${dep.routeShortName}`}
                              icon={Icon.Bell}
                              target={
                                <ViewAlertsCommand
                                  initialFilterLines={[dep.routeShortName]}
                                  initialFilterActiveNow={true}
                                />
                              }
                            />
                          )}
                          <Action.Push
                            title="Show Departure Details"
                            icon={Icon.Info}
                            target={<DepartureDetails departure={dep} />}
                          />
                        </ActionPanel.Section>
                        <ActionPanel.Section>
                          <Action.CopyToClipboard
                            title="Copy Departure Info"
                            content={getCopyContent(dep)}
                            shortcut={{ modifiers: ["cmd"], key: "." }}
                          />
                        </ActionPanel.Section>
                      </ActionPanel>
                    }
                  />
                ))}
              </List.Section>
            );
          })}
    </List>
  );
}
