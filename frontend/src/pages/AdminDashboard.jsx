import { useEffect, useState } from "react";
import {
  getCentres,
  getFarmers,

  createFarmer,
  updateFarmer,
  deleteFarmer,

  createCentre,
  updateCentre,
  deleteCentre,

  deleteAppointment
} from "../services/api";
import StatCard from "../components/StatCard";

// Admin auth now goes through the backend (see backend/main.py:
// POST /admin/auth/login, GET /admin/auth/verify, POST /admin/auth/logout).
// The token below is a real server-issued session token, checked against
// the database on every page load — it's still a prototype-level scheme
// (plaintext password, no expiry), but it is no longer a client-only gate.
const API_URL = "http://127.0.0.1:8000";
const ADMIN_TOKEN_KEY = "kisanflow_admin_token";

export default function AdminDashboard() {
  const [adminToken, setAdminToken] = useState(
    () => sessionStorage.getItem(ADMIN_TOKEN_KEY)
  );
  const [adminUsername, setAdminUsername] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [gateError, setGateError] = useState("");
  const [gateLoading, setGateLoading] = useState(false);

  // On mount (including page refresh), re-check any saved token against
  // the backend instead of trusting local storage on its own. This is
  // what makes a refresh keep the admin logged in ONLY if the session
  // is genuinely still valid server-side.
  useEffect(() => {
    const verifySession = async () => {
      const savedToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);

      if (!savedToken) {
        setCheckingSession(false);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/admin/auth/verify`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        });

        if (!response.ok) {
          sessionStorage.removeItem(ADMIN_TOKEN_KEY);
          setAdminToken(null);
          setCheckingSession(false);
          return;
        }

        const data = await response.json();
        setAdminUsername(data.username);
        setAdminToken(savedToken);
      } catch (error) {
        console.error("Admin session check failed:", error);
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdminToken(null);
      } finally {
        setCheckingSession(false);
      }
    };

    verifySession();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setGateError("");
    setGateLoading(true);

    try {
      const response = await fetch(`${API_URL}/admin/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Login failed.");
      }

      const data = await response.json();

      sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setAdminToken(data.token);
      setAdminUsername(data.username);
      setLoginUsername("");
      setLoginPassword("");
    } catch (err) {
      setGateError(err.message || "Unable to log in.");
    } finally {
      setGateLoading(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await fetch(`${API_URL}/admin/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    } catch (error) {
      console.error("Admin logout request failed:", error);
    } finally {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      setAdminToken(null);
      setAdminUsername("");
    }
  };

  const [centres, setCentres] = useState([]);
  const [farmers, setFarmers] = useState([]);
  const [appointments, setAppointments] = useState([]);

  // ================================
  // LOAD DASHBOARD DATA
  // ================================

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const centreResponse = await getCentres();
      const farmerResponse = await getFarmers();

      const appointmentResponse = await fetch(
        "http://127.0.0.1:8000/appointments"
      );

      if (!appointmentResponse.ok) {
        throw new Error("Failed to fetch appointments");
      }

      const appointmentData = await appointmentResponse.json();

      setCentres(centreResponse.data);
      setFarmers(farmerResponse.data);
      setAppointments(appointmentData);
    } catch (error) {
      console.error("Dashboard loading error:", error);
    }
  }

  const [showFarmerModal, setShowFarmerModal] = useState(false);
const [showCentreModal, setShowCentreModal] = useState(false);

const [editingFarmer, setEditingFarmer] = useState(null);
const [editingCentre, setEditingCentre] = useState(null);

const [farmerForm, setFarmerForm] = useState({
  name: "",
  phone: "",
  village: "",
  crop: "",
  quantity: ""
});

const [centreForm, setCentreForm] = useState({
  name: "",
  location: "",
  capacity: "",
  current_queue: "",
  processing_rate: ""
});

const handleAddFarmer = () => {
  setEditingFarmer(null);

  setFarmerForm({
    name: "",
    phone: "",
    village: "",
    crop: "",
    quantity: ""
  });

  setShowFarmerModal(true);
};

const handleEditFarmer = (farmer) => {
  setEditingFarmer(farmer);

  setFarmerForm({
    name: farmer.name || "",
    phone: farmer.phone || "",
    village: farmer.village || "",
    crop: farmer.crop || "",
    quantity: farmer.quantity || ""
  });

  setShowFarmerModal(true);
};

const handleSaveFarmer = async (e) => {
  e.preventDefault();

  try {
    const data = {
      name: farmerForm.name,
      phone: farmerForm.phone,
      village: farmerForm.village,
      crop: farmerForm.crop,
      quantity: Number(farmerForm.quantity)
    };

    if (editingFarmer) {

      // EDIT
      const response = await updateFarmer(
        editingFarmer.id,
        data
      );

      setFarmers((prev) =>
        prev.map((farmer) =>
          farmer.id === editingFarmer.id
            ? response.data
            : farmer
        )
      );

      alert("Farmer updated successfully!");

    } else {

      // ADD
      const response = await createFarmer(data);

      setFarmers((prev) => [
        ...prev,
        response.data
      ]);

      alert("Farmer added successfully!");
    }

    setShowFarmerModal(false);

  } catch (error) {
    console.error(error);
    alert("Failed to save farmer");
  }
};

const handleAddCentre = () => {
  setEditingCentre(null);

  setCentreForm({
    name: "",
    location: "",
    capacity: "",
    current_queue: "",
    processing_rate: ""
  });

  setShowCentreModal(true);
};

const handleEditCentre = (centre) => {
  setEditingCentre(centre);

  setCentreForm({
    name: centre.name || "",
    location: centre.location || "",
    capacity: centre.capacity || "",
    current_queue: centre.current_queue || "",
    processing_rate: centre.processing_rate || ""
  });

  setShowCentreModal(true);
};

const handleSaveCentre = async (e) => {
  e.preventDefault();

  try {
    const data = {
      name: centreForm.name,
      location: centreForm.location,
      capacity: Number(centreForm.capacity),
      current_queue: Number(centreForm.current_queue),
      processing_rate: Number(centreForm.processing_rate)
    };

    if (editingCentre) {

      // EDIT
      const response = await updateCentre(
        editingCentre.id,
        data
      );

      setCentres((prev) =>
        prev.map((centre) =>
          centre.id === editingCentre.id
            ? response.data
            : centre
        )
      );

      alert("Centre updated successfully!");

    } else {

      // ADD
      const response = await createCentre(data);

      setCentres((prev) => [
        ...prev,
        response.data
      ]);

      alert("Centre added successfully!");
    }

    setShowCentreModal(false);

  } catch (error) {
    console.error(error);
    alert("Failed to save centre");
  }
};

  // ================================
  // HELPER FUNCTIONS
  // ================================

  const getFarmer = (farmerId) => {
    return farmers.find(
      (farmer) => farmer.id === farmerId
    );
  };

  const getCentre = (centreId) => {
    return centres.find(
      (centre) => centre.id === centreId
    );
  };

  // ================================
  // UPDATE APPOINTMENT STATUS
  // ================================

  const updateStatus = async (
    appointmentId,
    status
  ) => {
    try {
      const response = await fetch(
        `http://127.0.0.1:8000/appointments/${appointmentId}/status?status=${status}`,
        {
          method: "PUT",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to update appointment"
        );
      }

      const updatedAppointment =
        await response.json();

      setAppointments((previous) =>
        previous.map((appointment) =>
          appointment.id ===
          updatedAppointment.id
            ? updatedAppointment
            : appointment
        )
      );
    } catch (error) {
      console.error(error);
      alert(
        "Unable to update appointment status"
      );
    }
  };

  // ================================
  // DELETE OPERATIONS
  // ================================

  const handleDeleteFarmer = async (farmerId) => {
    if (!window.confirm("Are you sure you want to delete this farmer? Related appointments will also be deleted.")) return;

    try {
      await deleteFarmer(farmerId);
      setFarmers((previous) => previous.filter((farmer) => farmer.id !== farmerId));
      setAppointments((previous) =>
        previous.filter((appointment) => appointment.farmer_id !== farmerId)
      );
      alert("Farmer deleted successfully");
    } catch (error) {
      console.error(error);
      alert("Unable to delete farmer");
    }
  };

  const handleDeleteAppointment = async (appointmentId) => {
    if (!window.confirm("Are you sure you want to delete this appointment?")) return;

    try {
      await deleteAppointment(appointmentId);
      setAppointments((previous) =>
        previous.filter((appointment) => appointment.id !== appointmentId)
      );
      alert("Appointment deleted successfully");
    } catch (error) {
      console.error(error);
      alert("Unable to delete appointment");
    }
  };

  const handleDeleteCentre = async (centreId) => {
    if (!window.confirm("Are you sure you want to delete this centre? Related appointments will also be deleted.")) return;

    try {
      await deleteCentre(centreId);
      setCentres((previous) => previous.filter((centre) => centre.id !== centreId));
      setAppointments((previous) =>
        previous.filter((appointment) => appointment.centre_id !== centreId)
      );
      alert("Procurement centre deleted successfully");
    } catch (error) {
      console.error(error);
      alert("Unable to delete procurement centre");
    }
  };

  // ================================
  // BASIC DASHBOARD CALCULATIONS
  // ================================

  const totalQueue = centres.reduce(
    (sum, centre) =>
      sum + (centre.current_queue || 0),
    0
  );

  const overloaded = centres.filter(
    (centre) => centre.is_congested
  ).length;

  // ================================
  // STEP 9 - ANALYTICS
  // ================================

  const completedCount =
    appointments.filter(
      (appointment) =>
        appointment.status === "COMPLETED"
    ).length;

  const activeAppointments =
    appointments.filter((appointment) =>
      [
        "BOOKED",
        "IN_QUEUE",
        "PROCESSING",
      ].includes(appointment.status)
    ).length;

  const averageWait = centres.length
    ? Math.round(
        centres.reduce(
          (sum, centre) =>
            sum +
            (centre.estimated_wait || 0),
          0
        ) / centres.length
      )
    : 0;


  const overloadedCentres =
    centres.filter(
      (centre) => centre.is_congested
    );

  const totalCapacity =
    centres.reduce(
      (sum, centre) =>
        sum + (centre.capacity || 0),
      0
    );

  const utilization = totalCapacity
    ? Math.round(
        (totalQueue / totalCapacity) *
          100
      )
    : 0;

  // ================================
  // UI
  // ================================

  if (checkingSession) {
    return (
      <main className="container">
        <div className="admin-gate">
          <div className="admin-gate-icon">🔒</div>
          <h2>Checking admin session...</h2>
        </div>
      </main>
    );
  }

  if (!adminToken) {
    return (
      <main className="container">
        <div className="admin-gate">
          <div className="admin-gate-icon">🔒</div>
          <h2>Admin Login</h2>
          <p>This control tower is restricted to procurement staff.</p>

          <form onSubmit={handleLogin}>
            <input
              type="text"
              placeholder="Username"
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              autoFocus
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
            />

            {gateError && (
              <p className="admin-gate-error">{gateError}</p>
            )}

            <button type="submit" disabled={gateLoading}>
              {gateLoading ? "Logging in..." : "Log In"}
            </button>
          </form>

          <p className="admin-gate-hint">
            Demo admin login — username <strong>admin</strong>, password{" "}
            <strong>KISAN2026</strong> — for judge/evaluator access during
            the hackathon only.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container">

      {/* =================================
          DASHBOARD HEADER
      ================================= */}

      <section className="dashboard-header">
        <div>
          <p className="eyebrow">
            CONTROL TOWER
          </p>

          <h1>
            Procurement Dashboard 🏢
          </h1>

          <p>
            Monitor procurement operations
            in real time.
          </p>
        </div>

        <div className="admin-session-info">
          <span>👤 Logged in as {adminUsername}</span>
          <button type="button" onClick={handleAdminLogout}>
            Log Out
          </button>
        </div>
      </section>


      {/* =================================
          MAIN STAT CARDS
      ================================= */}

      <div className="stats-grid">

        <StatCard
          title="Registered Farmers"
          value={farmers.length}
          icon="👨‍🌾"
        />

        <StatCard
          title="Procurement Centres"
          value={centres.length}
          icon="🏢"
        />

        <StatCard
          title="Current Queue"
          value={totalQueue}
          icon="🚦"
        />

        <StatCard
          title="High Risk Centres"
          value={overloaded}
          icon="🚨"
        />

      </div>


      {/* =================================
          CENTRE MONITORING
      ================================= */}

      <section className="dashboard-section">

        <div className="section-title">
          <div>
            <h2>
              Centre Monitoring
            </h2>
            <button
    className="add-button"
    onClick={handleAddCentre}
  >
    ➕ Add Centre
  </button>

            <p>
              Current queue and capacity
              status.
            </p>
          </div>
        </div>


        <div className="table-container">

          <table>

  <thead>
    <tr>
      <th>Centre</th>
      <th>Location</th>
      <th>Queue</th>
      <th>Capacity</th>
      <th>Utilisation</th>
      <th>Status</th>
      <th>ETA</th>
      <th>Action</th>
    </tr>
  </thead>


  <tbody>

    {centres.length === 0 ? (

      <tr>
        <td
          colSpan="8"
          style={{
            textAlign: "center",
            padding: "30px",
          }}
        >
          No procurement centres
          available.
        </td>
      </tr>

    ) : (

      centres.map((centre) => {

        const centreUtilization =
          centre.capacity > 0
            ? Math.round(
                (centre.current_queue /
                  centre.capacity) *
                  100
              )
            : 0;

        const eta =
          centre.processing_rate >
          0
            ? Math.ceil(
                (centre.current_queue /
                  centre.processing_rate) *
                  60
              )
            : 0;

        return (
          <tr
            key={centre.id}
          >

            <td>
              <strong>
                {centre.name}
              </strong>
            </td>

            <td>
              {centre.location}
            </td>

            <td>
              {centre.current_queue}
            </td>

            <td>
              {centre.capacity}
            </td>

            <td>
              {centreUtilization}%
            </td>

            <td>

              {centreUtilization >=
              85 ? (

                <span className="status danger">
                  🔴 High
                </span>

              ) : centreUtilization >=
                65 ? (

                <span className="status warning">
                  🟡 Moderate
                </span>

              ) : (

                <span className="status success">
                  🟢 Normal
                </span>

              )}

            </td>

            <td>
              {eta} min
            </td>

            <td>
              <div className="action-buttons">

                <button
                  className="edit-button"
                  onClick={() => handleEditCentre(centre)}
                >
                  ✏️ Edit
                </button>

                <button
                  className="delete-button"
                  onClick={() => handleDeleteCentre(centre.id)}
                >
                  🗑️ Delete
                </button>

              </div>
            </td>

          </tr>
        );
      })

    )}

  </tbody>

</table>

        </div>

      </section>


      {/* =================================
          APPOINTMENT CONTROL
      ================================= */}

      <section className="dashboard-section">

        <div className="section-title">

          <div>

            <h2>
              Appointment Control 🎫
            </h2>

            <p>
              Manage farmer procurement
              status in real time.
            </p>

            <button
              type="button"
              className="add-button"
              onClick={loadData}
            >
              🔄 Refresh
            </button>

          </div>

        </div>


        <div className="appointments-grid">

          {appointments.length === 0 ? (

            <div className="empty-state">
              📭 No appointments yet.
            </div>

          ) : (

            appointments.map(
              (appointment) => {

                const farmer =
                  getFarmer(
                    appointment.farmer_id
                  );

                const centre =
                  getCentre(
                    appointment.centre_id
                  );

                return (

                  <div
                    className="appointment-admin-card"
                    key={appointment.id}
                  >

                    {/* HEADER */}

                    <div className="appointment-admin-header">

                      <div>

                        <h3>
                          🎫 Appointment #
                          {appointment.id}
                        </h3>

                        <p>
                          👨‍🌾{" "}
                          {farmer?.name ||
                            "Unknown Farmer"}
                        </p>

                      </div>


                      <span
                        className={
                          appointment.status === "CANCELLED"
                            ? "appointment-status status-cancelled"
                            : "appointment-status"
                        }
                      >
                        {appointment.status}
                      </span>

                    </div>


                    {/* DETAILS */}

                    <div className="appointment-admin-details">

                      <div>
                        <span>
                          🌾 Crop
                        </span>

                        <strong>
                          {farmer?.crop ||
                            "N/A"}
                        </strong>
                      </div>


                      <div>
                        <span>
                          📦 Quantity
                        </span>

                        <strong>
                          {farmer?.quantity ||
                            0}{" "}
                          quintals
                        </strong>
                      </div>


                      <div>
                        <span>
                          🏢 Centre
                        </span>

                        <strong>
                          {centre?.name ||
                            "Unknown Centre"}
                        </strong>
                      </div>


                      <div>
                        <span>
                          📍 Location
                        </span>

                        <strong>
                          {centre?.location ||
                            "N/A"}
                        </strong>
                      </div>


                      <div>
                        <span>
                          📅 Date
                        </span>

                        <strong>
                          {appointment.date}
                        </strong>
                      </div>


                      <div>
                        <span>
                          🕐 Time
                        </span>

                        <strong>
                          {
                            appointment.time_slot
                          }
                        </strong>
                      </div>

                    </div>


                    {/* STATUS BUTTONS */}

                    <div className="status-buttons">

                      <button
                        onClick={() =>
                          updateStatus(
                            appointment.id,
                            "IN_QUEUE"
                          )
                        }
                      >
                        👥 In Queue
                      </button>


                      <button
                        onClick={() =>
                          updateStatus(
                            appointment.id,
                            "PROCESSING"
                          )
                        }
                      >
                        ⚙️ Processing
                      </button>


                      <button
                        onClick={() =>
                          updateStatus(
                            appointment.id,
                            "COMPLETED"
                          )
                        }
                      >
                        ✅ Completed
                      </button>


                      <button
                        className="delete-button"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Cancel this appointment? This will free up its queue slot at the centre."
                            )
                          ) {
                            updateStatus(
                              appointment.id,
                              "CANCELLED"
                            );
                          }
                        }}
                      >
                        ❌ Cancel
                      </button>

                    </div>

                    <button
                      className="delete-button appointment-delete-button"
                      onClick={() => handleDeleteAppointment(appointment.id)}
                    >
                      🗑️ Delete Appointment
                    </button>

                  </div>

                );
              }
            )

          )}

        </div>

      </section>


      {/* =================================
          FARMER MANAGEMENT
      ================================= */}

      <section className="dashboard-section">

        <div className="section-title">
          <div>
            <h2>Farmer Management 👨‍🌾</h2>
            <button
    className="add-button"
    onClick={handleAddFarmer}
  >
    ➕ Add Farmer
  </button>
            <p>View and remove registered farmers.</p>
          </div>
        </div>

        <div className="table-container">

          <table>

            <thead>
              <tr>
                <th>ID</th>
                <th>Farmer</th>
                <th>Phone</th>
                <th>Village</th>
                <th>Crop</th>
                <th>Quantity</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {farmers.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", padding: "30px" }}>
                    No registered farmers.
                  </td>
                </tr>
              ) : (
                farmers.map((farmer) => (
                  <tr key={farmer.id}>
                    <td>{farmer.id}</td>
                    <td><strong>{farmer.name || "N/A"}</strong></td>
                    <td>{farmer.phone || "N/A"}</td>
                    <td>{farmer.village || "N/A"}</td>
                    <td>{farmer.crop || "N/A"}</td>
                    <td>{farmer.quantity || 0} quintals</td>
                    <td>
                      <button
                        className="delete-button"
                        onClick={() => handleDeleteFarmer(farmer.id)}
                      >
                        🗑️ Delete
                      </button>
                    </td>
                    <td>
  <div className="action-buttons">

    <button
      className="edit-button"
      onClick={() => handleEditFarmer(farmer)}
    >
      ✏️ Edit
    </button>

    

  </div>
</td>
                  </tr>
                ))
              )}
            </tbody>

          </table>

        </div>
      </section>


      {/* =================================
          STEP 9 - PROCUREMENT ANALYTICS
      ================================= */}

      <section className="dashboard-section">

        <div className="section-title">

          <div>

            <h2>
              Procurement Analytics 📊
            </h2>

            <p>
              Real-time operational overview.
            </p>

          </div>

        </div>


        <div className="analytics-grid">

          <StatCard
            title="Active Appointments"
            value={activeAppointments}
            icon="⏳"
          />


          <StatCard
            title="Completed"
            value={completedCount}
            icon="✅"
          />


          <StatCard
            title="Average Wait"
            value={`${averageWait} min`}
            icon="🕐"
          />


          <StatCard
            title="Centre Utilization"
            value={`${utilization}%`}
            icon="🏢"
          />

        </div>

      </section>


      {/* =================================
          SMART ALERTS
      ================================= */}

      <section className="dashboard-section">

        <div className="section-title">

          <div>

            <h2>
              Smart Alerts 🧠
            </h2>

            <p>
              Automatically detected
              procurement bottlenecks.
            </p>

          </div>

        </div>


        {overloadedCentres.length ===
        0 ? (

          <div className="smart-alert success-alert">

            <div className="alert-icon">
              ✅
            </div>

            <div>

              <h3>
                All Centres Operating
                Normally
              </h3>

              <p>
                No procurement centre is
                currently overloaded.
              </p>

            </div>

          </div>

        ) : (

          <div className="alerts-list">

            {overloadedCentres.map(
              (centre) => (

                  <div
                    className="smart-alert warning-alert"
                    key={centre.id}
                  >

                    <div className="alert-icon">
                      🚨
                    </div>


                    <div className="alert-content">

                      <h3>
                        High Queue Alert —{" "}
                        {centre.name}
                      </h3>

                      <p>
                        {centre.congestion_warning}
                      </p>

                      <span className="alert-action">
                        💡 Consider redirecting
                        new farmers to another
                        available centre.
                      </span>

                    </div>

                  </div>

              )
            )}

          </div>

        )}

      </section>


      {/* =================================
          CENTRE UTILIZATION
      ================================= */}

      <section className="dashboard-section">

        <div className="section-title">

          <div>

            <h2>
              Centre Utilization 📈
            </h2>

            <p>
              Current queue versus processing
              capacity.
            </p>

          </div>

        </div>


        <div className="utilization-list">

          {centres.map((centre) => {

            const percentage =
              centre.capacity > 0
                ? Math.round(
                    (centre.current_queue /
                      centre.capacity) *
                      100
                  )
                : 0;

            return (

              <div
                className="utilization-item"
                key={centre.id}
              >

                <div className="utilization-header">

                  <strong>
                    {centre.name}
                  </strong>

                  <span>
                    {percentage}%
                  </span>

                </div>


                <div className="utilization-bar">

                  <div
                    className="utilization-fill"
                    style={{
                      width: `${Math.min(
                        percentage,
                        100
                      )}%`,
                    }}
                  />

                </div>


                <div className="utilization-meta">

                  <span>
                    👥 Queue:{" "}
                    {centre.current_queue}
                  </span>

                  <span>
                    🏢 Capacity:{" "}
                    {centre.capacity}
                  </span>

                  <span>
                    🕐 Wait:{" "}
                    {centre.estimated_wait ||
                      0}{" "}
                    min
                  </span>

                </div>

              </div>

            );

          })}


        </div>

      </section>


      {showFarmerModal && (
  <div className="modal-overlay">

<div className="modal">

  <div className="modal-header">
    <h2>
      {editingFarmer
        ? "✏️ Edit Farmer"
        : "➕ Add Farmer"}
    </h2>

    <button
      className="close-button"
      onClick={() => setShowFarmerModal(false)}
    >
      ✕
    </button>
  </div>

  <form onSubmit={handleSaveFarmer}>

    <div className="form-group">
      <label>Farmer Name</label>

      <input
        type="text"
        value={farmerForm.name}
        onChange={(e) =>
          setFarmerForm({
            ...farmerForm,
            name: e.target.value
          })
        }
        required
      />
    </div>

    <div className="form-group">
      <label>Phone Number</label>

      <input
        type="text"
        value={farmerForm.phone}
        onChange={(e) =>
          setFarmerForm({
            ...farmerForm,
            phone: e.target.value
          })
        }
        required
      />
    </div>

    <div className="form-group">
      <label>Village</label>

      <input
        type="text"
        value={farmerForm.village}
        onChange={(e) =>
          setFarmerForm({
            ...farmerForm,
            village: e.target.value
          })
        }
        required
      />
    </div>

    <div className="form-group">
      <label>Crop</label>

      <input
        type="text"
        value={farmerForm.crop}
        onChange={(e) =>
          setFarmerForm({
            ...farmerForm,
            crop: e.target.value
          })
        }
        required
      />
    </div>

    <div className="form-group">
        <label>Quantity (Quintals)</label>

      <input
        type="number"
        value={farmerForm.quantity}
        onChange={(e) =>
          setFarmerForm({
            ...farmerForm,
            quantity: e.target.value
          })
        }
        required
      />
    </div>

    <div className="modal-actions">

      <button
        type="button"
        className="cancel-button"
        onClick={() => setShowFarmerModal(false)}
      >
        Cancel
      </button>

      <button
        type="submit"
        className="save-button"
      >
        {editingFarmer
          ? "Update Farmer"
          : "Add Farmer"}
      </button>

    </div>

  </form>
</div>
  </div>
)}

{showCentreModal && (
  <div className="modal-overlay">

<div className="modal">

  <div className="modal-header">

    <h2>
      {editingCentre
        ? "✏️ Edit Centre"
        : "➕ Add Centre"}
    </h2>

    <button
      className="close-button"
      onClick={() => setShowCentreModal(false)}
    >
      ✕
    </button>

  </div>

  <form onSubmit={handleSaveCentre}>

    <div className="form-group">
      <label>Centre Name</label>

      <input
        type="text"
        value={centreForm.name}
        onChange={(e) =>
          setCentreForm({
            ...centreForm,
            name: e.target.value
          })
        }
        required
      />
    </div>

    <div className="form-group">
      <label>Location</label>

      <input
        type="text"
        value={centreForm.location}
        onChange={(e) =>
          setCentreForm({
            ...centreForm,
            location: e.target.value
          })
        }
        required
      />
    </div>

    <div className="form-group">
      <label>Capacity</label>

      <input
        type="number"
        value={centreForm.capacity}
        onChange={(e) =>
          setCentreForm({
            ...centreForm,
            capacity: e.target.value
          })
        }
        required
      />
    </div>

    <div className="form-group">
      <label>Current Queue</label>

      <input
        type="number"
        value={centreForm.current_queue}
        onChange={(e) =>
          setCentreForm({
            ...centreForm,
            current_queue: e.target.value
          })
        }
        required
      />
    </div>

    <div className="form-group">
      <label>Processing Rate / Hour</label>

      <input
        type="number"
        step="0.1"
        value={centreForm.processing_rate}
        onChange={(e) =>
          setCentreForm({
            ...centreForm,
            processing_rate: e.target.value
          })
        }
        required
      />
    </div>

    <div className="modal-actions">

      <button
        type="button"
        className="cancel-button"
        onClick={() => setShowCentreModal(false)}
      >
        Cancel
      </button>

      <button
        type="submit"
        className="save-button"
      >
        {editingCentre
          ? "Update Centre"
          : "Add Centre"}
      </button>

    </div>

  </form>

</div>
  </div>
)}

    </main>
  );
}