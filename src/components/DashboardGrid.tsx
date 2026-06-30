import React from "react";


interface DashboardGridProps {
  userRole: "manager" | "farmer" | "admin" | "fieldofficer" | "owner" | "planeteye";
  submenu: string;
  onClose: () => void;
}

const dashboardUrls: { [role: string]: { [submenu: string]: string } } = {
  manager: {
    "Farm Crop Status":
      "https://app.powerbi.com/view?r=eyJrIjoiNmUwNmVjYTYtZTIwNC00NTk2LTg5NTYtYTlkZDE2Mjc0MTA3IiwidCI6ImYwY2M0NzU1LWY3M2EtNGI3ZS1iMmRmLTM3YjY0N2M5NzNiNyJ9",
    Agroclimatic:
      "https://app.powerbi.com/view?r=eyJrIjoiZWUwNTYxMjMtZWM1NC00MjYwLTkyMmQtMDg5OWFiMTlmYjYzIiwidCI6ImYwY2M0NzU1LWY3M2EtNGI3ZS1iMmRmLTM3YjY0N2M5NzNiNyJ9",
  },
  farmer: {
    "Plot View":
      "https://app.powerbi.com/view?r=eyJrIjoiM2ZlMTk3MWYtZTQyMC00ZTk5LTkxMDUtZTdkNjcxNGZiNjFjIiwidCI6ImYwY2M0NzU1LWY3M2EtNGI3ZS1iMmRmLTM3YjY0N2M5NzNiNyJ9",
  },
  owner: {
    "Farm Crop Status":
      "https://app.powerbi.com/view?r=eyJrIjoiMGM1ZmI4NzEtYWUzNi00NmM1LTk4OWYtMTg1MjZkYzJjYzMzIiwidCI6ImYwY2M0NzU1LWY3M2EtNGI3ZS1iMmRmLTM3YjY0N2M5NzNiNyJ9",
    "Harvesting Planning":
      "https://app.powerbi.com/view?r=eyJrIjoiMjlhOGFmZTYtMzc4My00OTVhLTgwYTYtNTA4MDNhZTUzYWM4IiwidCI6ImYwY2M0NzU1LWY3M2EtNGI3ZS1iMmRmLTM3YjY0N2M5NzNiNyJ9",
    Agroclimatic:
      "https://app.powerbi.com/view?r=eyJrIjoiMzFhN2Q5OWYtMjBmNi00NzljLTkzOGYtMWEyYTU4ZDBmODVkIiwidCI6ImYwY2M0NzU1LWY3M2EtNGI3ZS1iMmRmLTM3YjY0N2M5NzNiNyJ9",
    Resources: "https://app.powerbi.com/view?r=...",
    "Plot Bird View": "https://app.powerbi.com/view?r=...",
  },
  fieldofficer: {
    ViewFarmerPlot:
      "https://app.powerbi.com/view?r=eyJrIjoiMGM1ZmI4NzEtYWUzNi00NmM1LTk4OWYtMTg1MjZkYzJjYzMzIiwidCI6ImYwY2M0NzU1LWY3M2EtNGI3ZS1iMmRmLTM3YjY0N2M5NzNiNyJ9",
  },
};

const DashboardGrid: React.FC<DashboardGridProps> = ({ userRole, submenu }) => {
  const url = dashboardUrls[userRole]?.[submenu];

  return (
    <div className="flex flex-col h-screen w-full">
      {/* Header */}

      {/* Iframe */}
      {url ? (
        <iframe
          title={submenu}
          src={url}
          className="flex-grow w-full border-none"
        />
      ) : (
        <div className="flex-grow flex items-center justify-center">
          <p className="text-red-500">Dashboard not available</p>
        </div>
      )}
    </div>
  );
};

export { DashboardGrid };
