import React, { useState } from "react";
import Navbar from "../components/Navbar";

function Home() {
  const [category, setCategory] = useState("All");

  const [products, setProducts] = useState([
    {
      id: 1,
      name: "Math Textbook",
      category: "Books",
      price: "KSh 800",
      views: 12,
    },
    {
      id: 2,
      name: "iPhone Charger",
      category: "Electronics",
      price: "KSh 500",
      views: 5,
    },
    {
      id: 3,
      name: "Nike Hoodie",
      category: "Fashion",
      price: "KSh 1200",
      views: 20,
    },
  ]);

  const increaseViews = (id) => {
    setProducts(
      products.map((item) =>
        item.id === id
          ? { ...item, views: item.views + 1 }
          : item
      )
    );
  };

  const deleteItem = (id) => {
    setProducts(products.filter((item) => item.id !== id));
  };

  const filtered =
    category === "All"
      ? products
      : products.filter((p) => p.category === category);

  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <Navbar />

      <h2>Campus Market 🎓</h2>

      {/* Categories */}
      <div style={{ display: "flex", gap: "10px" }}>
        <button onClick={() => setCategory("All")}>All</button>
        <button onClick={() => setCategory("Books")}>Books</button>
        <button onClick={() => setCategory("Electronics")}>Electronics</button>
        <button onClick={() => setCategory("Fashion")}>Fashion</button>
      </div>

      {/* Products */}
      <div style={{ marginTop: "20px" }}>
        {filtered.map((item) => (
          <div
            key={item.id}
            onClick={() => increaseViews(item.id)}
            style={{
              border: "1px solid gray",
              padding: "10px",
              margin: "10px 0",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            <h3>{item.name}</h3>
            <p>{item.category}</p>
            <p>{item.price}</p>

            <p>👁 Views: {item.views}</p>

            <button>Contact Seller</button>

            <button
              onClick={() => deleteItem(item.id)}
              style={{ marginLeft: "10px", color: "red" }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Home;