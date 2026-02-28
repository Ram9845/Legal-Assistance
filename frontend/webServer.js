const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.FRONTEND_PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.render("home", {
    config: {
      ragApiBase: process.env.RAG_API_BASE || "http://localhost:8000",
      backendApiBase: process.env.BACKEND_API_BASE || "http://localhost:5000",
      googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    },
  });
});

app.get("/login", (req, res) => {
  res.render("login", {
    config: {
      backendApiBase: process.env.BACKEND_API_BASE || "http://localhost:5000",
      googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    },
  });
});

app.get("/register", (req, res) => {
  res.render("register", {
    config: {
      backendApiBase: process.env.BACKEND_API_BASE || "http://localhost:5000",
      googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    },
  });
});

app.get("/chat", (req, res) => {
  res.render("chat", {
    config: {
      ragApiBase: process.env.RAG_API_BASE || "http://localhost:8000",
      backendApiBase: process.env.BACKEND_API_BASE || "http://localhost:5000",
      googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    },
  });
});

app.listen(PORT, () => {
  console.log(`Frontend listening on port ${PORT}`);
});
