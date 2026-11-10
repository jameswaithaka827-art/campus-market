import React, { useState } from "react";
import { supabase } from "../supabase";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // SIGN UP
  const signUp = async () => {
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Account created! You can now login.");
    }

    setLoading(false);
  };

  // LOGIN
  const signIn = async () => {
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Login successful 🎉");
    }

    setLoading(false);
  };

  return (
    <div style={styles.container}>
      <h2>🎓 Campus Market Login</h2>

      <input
        style={styles.input}
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        style={styles.input}
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <div style={styles.buttons}>
        <button style={styles.loginBtn} onClick={signIn} disabled={loading}>
          Login
        </button>

        <button style={styles.signupBtn} onClick={signUp} disabled={loading}>
          Sign Up
        </button>
      </div>

      <p>{message}</p>
    </div>
  );
}

const styles = {
  container: {
    padding: "30px",
    fontFamily: "Arial",
    maxWidth: "400px",
    margin: "auto",
    textAlign: "center",
  },
  input: {
    display: "block",
    width: "100%",
    padding: "10px",
    margin: "10px 0",
  },
  buttons: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
  },
  loginBtn: {
    flex: 1,
    padding: "10px",
    backgroundColor: "green",
    color: "white",
    border: "none",
  },
  signupBtn: {
    flex: 1,
    padding: "10px",
    backgroundColor: "blue",
    color: "white",
    border: "none",
  },
};

export default Login;