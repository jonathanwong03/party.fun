const express = require("express");
const { isUser } = require("../middleware/auth");

const router = express.Router();

router.get("/dashboard", isUser, (req, res) => {
  res.render("dashboard", {
    user: req.user,
  });
});

module.exports = router;
