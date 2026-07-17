import OwnerHarvestDash from "./OwnerHarvestDash";

/** Manager harvest planning — same dashboard as owner, scoped to my-field-officers. */
const HarvestDashboard: React.FC = () => {
  return <OwnerHarvestDash mode="manager" />;
};

export default HarvestDashboard;
