const express = require("express");
const bcrypt = require("bcrypt");

const User = require("../models/user");
const { isUser } = require("../middleware/auth");

const router = express.Router();

//login
router.get("/login", (req, res) => {
  res.render("login");
});

//register
router.get("/register", (req, res) => {
  res.render("register");
});

router.post("/register", async (req, res) => {
  try {
    const username = req.body.username.trim(); //avoid "   "
    const password = req.body.password.trim();
    const confirmPassword = req.body.confirmPassword.trim();

    if (!username || !password || !confirmPassword) {
      //if no username n password n confirmed
      let missingFields = [];

      if (!username) missingFields.push("username");
      if (!password) missingFields.push("password");
      if (!confirmPassword) missingFields.push("confirm password");

      return res.send(`Please fill in: ${missingFields.join(" and ")}`); //show the missing fields
    }

    if (password !== confirmPassword) {
      return res.send("Passwords do not match");
    }

    // const existingUser = await User.findOne({ username });

    // if (existingUser) {
    //   return res.send("Username already exists");
    // } ///chat reco this part seems cool but not needed currently, can js consdier

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      password: hashedPassword,
    });

    // save session
    req.session.user = {
      _id: user._id,
      username: user.username,
      isAdmin: user.isAdmin,
    }; //i actually dont understand sessions at all

    res.redirect("/dashboard");
  } catch (err) {
    console.log(err);
    res.status(500).send("Server Error");
  }
});

router.post("/login", async (req, res) => {
  try {
    const username = req.body.username.trim();
    const password = req.body.password.trim();

    if (!username || !password) {
      let missingFields = [];

      if (!username) missingFields.push("username");
      if (!password) missingFields.push("password");

      return res.send(`Please fill in: ${missingFields.join(" and ")}`);
    }

    const user = await User.findOne({ username });

    if (!user) {
      return res.send("User does not exist");
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.send("Password is wrong"); //chat was saying how hackers can user this to discover existing usernames, and was telling me to js use "invalid credentails"
    }

    req.session.user = {
      _id: user._id,
      username: user.username,
      isAdmin: user.isAdmin,
    };

    res.redirect("/dashboard");
  } catch (err) {
    console.log(err);
    res.status(500).send("Server Error");
  }
});

//logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

module.exports = router;
