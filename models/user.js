const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  isAdmin: {
    type: Boolean,
    default: false, // not sure if we adding this part because we could make the non organisers just not sign in at all..
  },
});

module.exports = mongoose.model("User", userSchema);
