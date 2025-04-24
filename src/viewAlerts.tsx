// src/viewAlerts.tsx
import { useState, useEffect, useCallback } from "react";
import { ActionPanel, Action, List, Icon, Color, showToast, Toast, Detail } from "@raycast/api";
import { formatDistanceToNow, format } from "date-fns";
import { fetchAlerts } from "./utils/api";
import { ProcessedServiceAlert } from "./types";

// --- Helper Function for Safe Date Formatting ---
function formatAlertDate(dateString: string | null | undefined, formatString: string): string {
  if (!dateString) return "N/A";
  try {
    return format(new Date(dateString), formatString);
  } catch (e) {
    console.warn("Failed to format alert date string:", dateString, e);
    return "Invalid Date";
  }
}

function formatAlertDistance(dateString: string | null | undefined): string {
  if (!dateString) return "N/A";
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  } catch (e) {
    console.warn("Failed to format alert distance for date string:", dateString, e);
    return "Invalid Date";
  }
}

interface ViewAlertsCommandProps {
  initialFilterLines?: string[]; // Optional lines to filter by initially
  initialFilterStationId?: string; // Optional station ID to filter by initially
}

export default function ViewAlertsCommand(props: ViewAlertsCommandProps = {}) {
  // Default empty props
  const { initialFilterLines, initialFilterStationId } = props; // Default to showing active alerts if navigated to with a line filter
  const [processedAlerts, setProcessedAlerts] = useState<ProcessedServiceAlert[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Store current filter state locally within this instance
  const [filterLines /* , setFilterLines */] = useState<string[] | undefined>(initialFilterLines); // Keep initial line filter
  const [filterActive] = useState<boolean>(true); // Use initial active filter

  // Callback to fetch and update CACHE with RAW data
  const loadAlerts = useCallback(
    async (showLoadingToast = false) => {
      setIsLoading(true);
      setError(null); // Clear previous errors on load attempt
      if (showLoadingToast) {
        showToast({ style: Toast.Style.Animated, title: "Refreshing Alerts..." });
      }
      try {
        // Fetch raw ServiceAlert[] with string dates
        console.log(`[Alerts View] Fetching with Lines: ${filterLines?.join(",")}, Active: ${filterActive}`);
        const alertsWithDates = await fetchAlerts(filterLines, initialFilterStationId);
        setProcessedAlerts(alertsWithDates);
      } catch (err: unknown) {
        console.error("Failed to fetch alerts:", err);
        const message = err instanceof Error ? err.message : "Could not load service alerts.";
        setError(message); // Set error state
        showToast({ style: Toast.Style.Failure, title: "Error Loading Alerts", message: message });
      } finally {
        setIsLoading(false);
      }
    },
    [filterLines, filterActive], // Dependencies
  );

  // Effect to load initially or if cache stale
  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // Reload when filterActive state changes
  useEffect(() => {
    loadAlerts();
  }, [filterActive, loadAlerts]); // Add filterActive dependency

  return (
    <List
      isLoading={isLoading}
      navigationTitle="MTA/LIRR Service Alerts"
      searchBarPlaceholder="Search alerts..."
      // Global Actions
      actions={
        <ActionPanel>
          <Action
            title="Refresh Alerts"
            icon={Icon.ArrowClockwise}
            onAction={() => loadAlerts(true)}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
          />
        </ActionPanel>
      }
    >
      {/* Error View */}
      {error && !isLoading && <List.EmptyView icon={Icon.Warning} title="Could Not Load Alerts" description={error} />}

      {/* No Alerts View */}
      {!isLoading &&
        !error &&
        processedAlerts.length === 0 && ( // Check processed length
          <List.EmptyView
            icon={Icon.CheckCircle}
            title="No Service Alerts"
            description="Transit services appear to be operating normally."
          />
        )}

      {/* Alerts List */}
      {!error &&
        processedAlerts.length > 0 && ( // Render only if no error and alerts exist
          <List.Section title="Current Alerts">
            {/* Map over PROCESSED alerts */}
            {processedAlerts.map((alert) => (
              <AlertListItem key={alert.id} alert={alert} onRefresh={() => loadAlerts(true)} />
            ))}
          </List.Section>
        )}
    </List>
  );
}

// --- AlertListItem Component ---
// Accepts ProcessedServiceAlert with Date objects
interface AlertListItemProps {
  alert: ProcessedServiceAlert;
  onRefresh: () => void;
}

function AlertListItem({ alert, onRefresh }: AlertListItemProps) {
  const getSeverityColor = (alert: ProcessedServiceAlert): Color => {
    // Use alert properties (now ProcessedServiceAlert)
    if (alert.title.toLowerCase().includes("suspend")) return Color.Red;
    if (alert.title.toLowerCase().includes("delay")) return Color.Orange;
    return Color.Yellow;
  };

  // Use the helper function for safe date formatting
  const displayDate = alert.startDate || null; // Use start date primarily for display timing

  return (
    <List.Item
      icon={{ source: Icon.ExclamationMark, tintColor: getSeverityColor(alert) }}
      title={alert.title}
      subtitle={alert.affectedLines.join(", ")}
      accessories={[
        {
          // Use safe formatting helper for distance
          text: displayDate ? formatAlertDistance(displayDate.toISOString()) : "Ongoing",
          icon: Icon.Calendar,
          // Use safe formatting helper for tooltip
          tooltip: displayDate ? `Started: ${formatAlertDate(displayDate.toISOString(), "PPpp")}` : undefined,
        },
      ]}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.Push title="View Alert Details" icon={Icon.Sidebar} target={<AlertDetailView alert={alert} />} />
            {alert.url && (
              <Action.OpenInBrowser
                title="Open on Website"
                url={alert.url}
                shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
              />
            )}
            <Action
              title="Refresh Alerts"
              icon={Icon.ArrowClockwise}
              onAction={onRefresh}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy Alert Title"
              content={alert.title}
              shortcut={{ modifiers: ["cmd"], key: "." }}
            />
            <Action.CopyToClipboard
              title="Copy Alert Details"
              content={alert.description}
              shortcut={{ modifiers: ["cmd", "shift"], key: "." }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

// --- AlertDetailView Component ---
// Accepts ProcessedServiceAlert with Date objects
interface AlertDetailViewProps {
  alert: ProcessedServiceAlert;
}

function AlertDetailView({ alert }: AlertDetailViewProps) {
  // Use safe date formatting helpers here too
  const startDateFormatted = alert.startDate ? formatAlertDate(alert.startDate.toISOString(), "PPpp") : "N/A";
  const startDateDistance = alert.startDate ? formatAlertDistance(alert.startDate.toISOString()) : "Ongoing";
  const endDateFormatted = alert.endDate ? formatAlertDate(alert.endDate.toISOString(), "PPpp") : "Ongoing";

  const markdown = `
# ${alert.title}

**Started:** ${startDateDistance} (${startDateFormatted})  
${alert.endDate ? `**Ends:** ${endDateFormatted}` : ""}

---

${alert.description}

${alert.url ? `\n[View on Website](${alert.url})` : ""}
  `;

  return (
    <Detail
      markdown={markdown}
      navigationTitle={alert.title}
      actions={
        <ActionPanel>
          {alert.url && <Action.OpenInBrowser title="Open on Website" url={alert.url} />}
          <Action.CopyToClipboard title="Copy Details" content={alert.description} />
          <Action.CopyToClipboard title="Copy Title" content={alert.title} />
        </ActionPanel>
      }
      metadata={
        <Detail.Metadata>
          {/* Use safe formatting helper */}
          <Detail.Metadata.Label title="Started" text={startDateFormatted} />
          {alert.endDate && <Detail.Metadata.Label title="Ends" text={endDateFormatted} />}

          <Detail.Metadata.TagList title="Affected Lines">
            {alert.affectedLinesLabels.map((line) => (
              <Detail.Metadata.TagList.Item key={line} text={line} color={Color.Red} />
            ))}
          </Detail.Metadata.TagList>
          <Detail.Metadata.TagList title="Affected Stations">
            {alert.affectedStationsLabels.map((station) => (
              <Detail.Metadata.TagList.Item key={station} text={station} color={Color.Red} />
            ))}
          </Detail.Metadata.TagList>
          {alert.url && <Detail.Metadata.Link title="Official Link" target={alert.url} text="Website" />}
          <Detail.Metadata.Separator />
        </Detail.Metadata>
      }
    />
  );
}
