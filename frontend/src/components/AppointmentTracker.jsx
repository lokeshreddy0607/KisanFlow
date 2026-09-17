function AppointmentTracker({ appointment }) {

  const statuses = [
    "BOOKED",
    "IN_QUEUE",
    "PROCESSING",
    "COMPLETED",
  ];

  const isCancelled = appointment.status === "CANCELLED";

  const currentIndex =
    statuses.indexOf(appointment.status);

  return (
    <div className="appointment-tracker">

      <div className="tracker-header">
        <div>
          <h3>🎫 Appointment #{appointment.id}</h3>
          <p>Procurement Appointment</p>
        </div>

        <span
          className={
            isCancelled
              ? "appointment-status status-cancelled"
              : "appointment-status"
          }
        >
          {appointment.status}
        </span>
      </div>

      <div className="appointment-details">

        <div>
          <span>👨‍🌾 Farmer</span>
          <strong>
            Farmer #{appointment.farmer_id}
          </strong>
        </div>

        <div>
          <span>🏢 Centre</span>
          <strong>
            Centre #{appointment.centre_id}
          </strong>
        </div>

        <div>
          <span>📅 Date</span>
          <strong>
            {appointment.date}
          </strong>
        </div>

        <div>
          <span>🕙 Slot</span>
          <strong>
            {appointment.time_slot}
          </strong>
        </div>

      </div>

      {isCancelled ? (

        <div className="tracker-cancelled">
          ❌ This appointment has been cancelled. Its queue slot has been released.
        </div>

      ) : (

        <div className="tracker">

          {statuses.map((status, index) => (

            <div
              key={status}
              className={
                index <= currentIndex
                  ? "tracker-step active"
                  : "tracker-step"
              }
            >

              <div className="tracker-circle">
                {index <= currentIndex ? "✓" : index + 1}
              </div>

              <span>
                {status.replace("_", " ")}
              </span>

            </div>

          ))}

        </div>

      )}

    </div>
  );
}

export default AppointmentTracker;