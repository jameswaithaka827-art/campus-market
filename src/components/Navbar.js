import React from "react";

function Navbar() {
  return (
    <nav
      style={{
        background: "linear-gradient(90deg, #5B6EFF, #FF5FA2)",
        color: "#fff",
        padding: "15px 25px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderRadius: "12px",
      }}
    >
      <h2 style={{ margin: 0 }}>🎓 Campus Market</h2>

      <div style={{ display: "flex", gap: "15px" }}>
        <button>🏠 Home</button>
        <button>🛍 Browse</button>
        <button>➕ Sell</button>
        <button>🏪 Stores</button>
        <button>💬 Messages</button>
        <button>👤 Profile</button>
      </div>
    </nav>
  );
}

export default Navbar;