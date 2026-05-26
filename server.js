// .. if no need/ need more can add or remove method override to delete the forms later
const express = require("express");
const path = require("path");
const session = require("express-session");
const dotenv = require("dotenv");

//
dotenv.config({ path: "./config.env" });

const connectDB = require("./config/db");

//routes
const authRoutes = require("./routes/authRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");

const app = express();
connectDB();

//middlware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

//
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }),
);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

//routes
app.use("/", authRoutes);
app.use("/", dashboardRoutes);

app.get("/", (req, res) => {
  res.redirect("/posts");
});

//error handling
app.use((req, res) => {
  res.status(404).send("Page not found");
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
