// Deterministic, approximate farmer -> centre distance.
// This is NOT a real GPS/road distance — it's a stable estimate
// derived from the farmer's village name and the centre's location
// text, so the same farmer + centre pair always shows the same
// distance without needing any maps/geocoding service.
const AVERAGE_SPEED_KMPH = 30;

export function getApproxDistanceKm(villageText, locationText) {
  const combined = `${villageText.trim().toLowerCase()}|${locationText
    .trim()
    .toLowerCase()}`;

  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * 31 + combined.charCodeAt(i)) % 100000;
  }

  // Map the hash into a realistic rural catchment range: 2km - 48km.
  const distanceKm = 2 + (hash % 461) / 10;

  return Math.round(distanceKm * 10) / 10;
}

export function getApproxTravelMinutes(distanceKm) {
  return Math.max(5, Math.round((distanceKm / AVERAGE_SPEED_KMPH) * 60));
}

function CentreCard({
  centre,
  recommended,
  onBook,
  farmerVillage,
  onFindAlternatives,
}) {
  const queue = centre.current_queue || 0;
  const capacity = centre.capacity || 1;

  const queuePercentage = Math.min(
    Math.round((queue / capacity) * 100),
    100
  );

  const waitTime = centre.estimated_wait ?? 0;
  const hasVillage = Boolean(farmerVillage && farmerVillage.trim());

  const distanceKm = hasVillage
    ? getApproxDistanceKm(farmerVillage, centre.location)
    : null;

  const travelMinutes =
    distanceKm !== null ? getApproxTravelMinutes(distanceKm) : null;

  const getStatusClass = () => {
    if (centre.status === "FULL") return "status-full";
    if (centre.status === "BUSY") return "status-busy";
    return "status-open";
  };

  return (
    <div
      className={`centre-card ${
        recommended ? "recommended-card" : ""
      }`}
    >

      {/* RECOMMENDED BADGE */}

      {recommended && (
        <div className="recommended-badge">
          ⭐ AI RECOMMENDED
        </div>
      )}

      {/* HEADER */}

      <div className="centre-card-header">

        <div>
          <h3>{centre.name}</h3>

          <p>
            📍 {centre.location}
          </p>
        </div>

        <div className={getStatusClass()}>
          {centre.status === "FULL"
            ? "🔴 FULL"
            : centre.status === "BUSY"
            ? "🟠 BUSY"
            : "🟢 OPEN"}
        </div>

      </div>


      {/* CONGESTION WARNING */}

      {centre.congestion_warning && (
        <div className="congestion-warning">
          {centre.congestion_warning}
        </div>
      )}


      {/* QUEUE */}

      <div className="queue-section">

        <div className="queue-info">

          <span>
            👥 Current Queue
          </span>

          <strong>
            {queue} / {capacity}
          </strong>

        </div>

        <div className="queue-bar">

          <div
            className="queue-progress"
            style={{
              width: `${queuePercentage}%`,
            }}
          />

        </div>

        <small>
          {queuePercentage}% capacity occupied
        </small>

      </div>


      {/* STATS */}

      <div className="centre-stats">

        <div className="centre-stat">

          <span>⏱️</span>

          <div>
            <small>Estimated Wait</small>

            <strong>
              {waitTime >= 60
                ? `${Math.floor(waitTime / 60)}h ${
                    waitTime % 60
                  }m`
                : `${waitTime} min`}
            </strong>
          </div>

        </div>


        <div className="centre-stat">

          <span>⚡</span>

          <div>
            <small>Processing Rate</small>

            <strong>
              {centre.processing_rate}/hr
            </strong>
          </div>

        </div>

        {hasVillage && (

          <div className="centre-stat">

            <span>📏</span>

            <div>
              <small>Distance (approx.)</small>

              <strong>
                {distanceKm} km · ~{travelMinutes} min
              </strong>
            </div>

          </div>

        )}

      </div>


      {/* BOOK BUTTON */}

      <button
        className="book-slot-button"
        onClick={() => onBook(centre)}
        disabled={centre.status === "FULL"}
      >
        {centre.status === "FULL"
          ? "🚫 Centre Full"
          : "📅 Book Procurement Slot"}
      </button>
      {/* FIND ALTERNATIVE CENTRES (only when this centre is full) */}

      {centre.status === "FULL" && onFindAlternatives && (
        <button
          className="find-button"
          onClick={() => onFindAlternatives(centre)}
        >
          🔁 Find Alternative Centres
        </button>
      )}
    </div>
  );
}

export default CentreCard;