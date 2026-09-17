import { useState } from "react";
import Navbar from "./components/Navbar";
import FarmerDashboard from "./pages/FarmerDashboard";
import AdminDashboard from "./pages/AdminDashboard";

function App() {

  const [page, setPage] = useState("farmer");

  return (
    <>
      <Navbar setPage={setPage} />

      {page === "farmer" ? (
        <FarmerDashboard />
      ) : (
        <AdminDashboard />
      )}
    </>
  );
}

export default App;