import { createPlaceholderHandler } from "../utils/apiPlaceholder.js";

const authNote = {
  note: "Frontend-only mock auth for now. Real auth will be added later.",
};

export const getLogin = createPlaceholderHandler("login", authNote);
export const postLogin = createPlaceholderHandler("login", authNote);
export const getRegister = createPlaceholderHandler("register", authNote);
export const postRegister = createPlaceholderHandler("register", authNote);
export const getLogout = createPlaceholderHandler("logout", authNote);
export const postLogout = createPlaceholderHandler("logout", authNote);

//evonne
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import supabase from "../config/supabase.js";
//this is the const user part

const signToken = (user) => {
  return jwt.sign(
    { userId: user._id, username: user.username, isAdmin: user.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
}; //this is the req res part

export const postRegister = async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    const missingFields = [];
    if (!username?.trim()) missingFields.push("username");
    if (!email?.trim()) missingFields.push("email");
    if (!password?.trim()) missingFields.push("password");
    if (!confirmPassword?.trim()) missingFields.push("confirm password");

    if (missingFields.length > 0) {
      return res
        .status(400)
        .json({ error: `Please fill in: ${missingFields.join(" and ")}` });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .or(`username.eq.${username.trim()},email.eq.${email.trim()}`)
      .maybeSingle();

    if (existing) {
      return res
        .status(400)
        .json({ error: "Username or email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        username: username.trim(),
        email: email.trim(),
        password: hashedPassword,
      })
      .select()
      .single();

    if (error) throw error; //this is the post part, same logic as what i wrote but supabase take from

    // returns me a token instead of the redirect
    const token = signToken(user);
    const role = user.isAdmin ? "admin" : "user";

    res.status(201).json({ token, role, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

export const postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const missingFields = [];
    if (!email?.trim()) missingFields.push("email");
    if (!password?.trim()) missingFields.push("password");

    if (missingFields.length > 0) {
      return res
        .status(400)
        .json({ error: `Please fill in: ${missingFields.join(" and ")}` });
    }

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.trim())
      .maybeSingle();

    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const token = signToken(user);
    const role = user.isAdmin ? "admin" : "user";

    res.json({ token, role, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

//the token is deleted on the front end??
export const postLogout = (_req, res) => {
  res.json({ message: "Logged out" });
};

//
export const getLogin = (_req, res) =>
  res.json({ message: "Use POST /api/auth/login" });
export const getRegister = (_req, res) =>
  res.json({ message: "Use POST /api/auth/register" });
export const getLogout = (_req, res) =>
  res.json({ message: "Use POST /api/auth/logout" });
