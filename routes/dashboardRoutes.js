const { isUser } = require("../middleware/auth");

router.get("/dashboard", isUser, (req, res) => {
  res.render("dashboard", {
    user: req.user,
  });
});