import { Leaf } from "lucide-react";

export default function Navbar({ setPage }) {
  return (
    <nav className="navbar">
      <div className="brand">
        <Leaf size={28} />
        <span>KisanFlow</span>
      </div>

      <div className="nav-buttons">
        <button onClick={() => setPage("farmer")}>
          👨‍🌾 Farmer
        </button>

        <button onClick={() => setPage("admin")}>
          🏢 Admin
        </button>
      </div>
    </nav>
  );
}