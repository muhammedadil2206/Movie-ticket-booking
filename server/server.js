import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "../public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

const requiredEnv = ["ADMIN_EMAIL", "ADMIN_APP_PASSWORD", "MONGO_URI", "JWT_SECRET"];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    console.warn(`⚠️  Missing ${key} in environment variables.`);
  }
});

if (!process.env.MONGO_URI) {
  console.error('❌ MONGO_URI is required in the environment.');
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is required in the environment.');
  process.exit(1);
}

const TMDB_API_KEY = process.env.TMDB_API_KEY || "d4787a064f506d5c77cd7de2b0cd91eb";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

if (!TMDB_API_KEY) {
  console.warn("⚠️ TMDB_API_KEY is not set. Movie listings will fail.");
}

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((error) => {
    console.error('❌ MongoDB connection failed', error);
    process.exit(1);
  });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, default: "" },
  passwordHash: { type: String, required: true },
  usernameLower: { type: String, lowercase: true, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now },
});

const contactSchema = new mongoose.Schema(
  {
    enquiryType: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phone: { type: String },
    preferredDate: { type: String },
    groupSize: { type: String },
    message: { type: String, required: true },
    source: { type: String, default: "website" },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

const pendingSignupSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    name: { type: String, required: true },
    phone: { type: String },
    passwordHash: { type: String, required: true },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

pendingSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 });

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    email: { type: String, required: true, lowercase: true },
    name: { type: String, required: true },
    movieId: { type: String, required: true },
    movieTitle: { type: String, required: true },
    releaseDate: { type: String, default: "TBA" },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const ContactMessage = mongoose.model("ContactMessage", contactSchema);
const PendingSignup = mongoose.model("PendingSignup", pendingSignupSchema);
const NotificationRequest = mongoose.model("NotificationRequest", notificationSchema);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.ADMIN_EMAIL,
    pass: process.env.ADMIN_APP_PASSWORD,
  },
});

const requireUser = async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "Not authenticated." });
    return null;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) {
      res.status(401).json({ ok: false, error: "User not found." });
      return null;
    }
    return user;
  } catch (error) {
    console.error("Auth check failed", error);
    res.status(401).json({ ok: false, error: "Invalid or expired token." });
    return null;
  }
};

app.get("/api/tmdb/*", rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  if (!TMDB_API_KEY) {
    return res.status(500).json({ ok: false, error: "TMDB API key missing on server." });
  }

  const pathFragment = req.params[0];
  if (!pathFragment) {
    return res.status(400).json({ ok: false, error: "Missing TMDB path." });
  }

  const search = new URLSearchParams(req.query);
  if (!search.has("api_key")) {
    search.set("api_key", TMDB_API_KEY);
  }

  const upstreamUrl = `${TMDB_BASE_URL}/${pathFragment}${search.size ? `?${search.toString()}` : ""}`;

  try {
    const response = await fetch(upstreamUrl);
    const payload = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(payload);
    }
    res.json(payload);
  } catch (error) {
    console.error("TMDB proxy failed", error);
    res.status(502).json({ ok: false, error: "Unable to reach TMDB." });
  }
});

const pendingOtps = new Map();
const registeredUsers = new Map();
const OTP_EXPIRY_MS = 10 * 60 * 1000;

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const buildOtpEmail = (name, otp) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>HeimeShow OTP</title>
    <style>
      body { margin:0; background:#050505; color:#f7f6f2; font-family:'Montserrat',Arial,sans-serif; }
      .wrapper { max-width:520px; margin:0 auto; padding:32px 24px; background:linear-gradient(160deg, rgba(17,17,17,.95), rgba(32,22,15,.9)); border-radius:24px; border:1px solid rgba(255,206,148,.25); }
      h1 { font-size:24px; letter-spacing:0.12em; text-transform:uppercase; color:#ffd166; margin:0 0 14px; }
      p { color:rgba(247,244,236,.84); line-height:1.7; }
      .otp { margin:24px 0; font-size:34px; letter-spacing:0.35em; text-align:center; color:#ffffff; font-weight:700; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <h1>Verification Code</h1>
      <p>Hello ${name.split(" ")[0] || "there"},</p>
      <p>Use the six-digit code below to complete your HeimeShow account. The code expires in 10 minutes.</p>
      <div class="otp">${otp}</div>
      <p>If you didn’t request this, you can ignore the email.</p>
      <p style="margin-top:24px;">— HeimeShow Concierge</p>
    </div>
  </body>
</html>`;

const sendOtp = async ({ name, email, otp }) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `HeimeShow Concierge <${process.env.ADMIN_EMAIL}>`,
    to: email,
    subject: "Your HeimeShow Verification Code",
    text: `Your HeimeShow verification code is ${otp}. It expires in 10 minutes.`,
    html: buildOtpEmail(name, otp),
  });
};

const enquiryTemplate = ({ enquiryType, name, email, phone, preferredDate, groupSize, message }) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HeimeShow Enquiry</title>
    <style>
      body { margin:0; background:#050505; color:#f7f6f2; font-family:'Montserrat',Arial,sans-serif; }
      .wrapper { padding:32px 24px; max-width:640px; margin:0 auto; background:linear-gradient(160deg, rgba(17,17,17,.95), rgba(37,28,19,.9)); border:1px solid rgba(255,206,148,.25); border-radius:24px; }
      h1 { font-size:24px; margin:0 0 16px; letter-spacing:0.08em; text-transform:uppercase; color:#ffd166; }
      p { color:rgba(247,244,236,.88); line-height:1.7; margin:0; }
      .meta { margin:24px 0; border-top:1px solid rgba(255,206,148,.25); border-bottom:1px solid rgba(255,206,148,.25); padding:16px 0; display:grid; gap:12px; }
      .meta div { display:flex; justify-content:space-between; font-size:14px; color:rgba(247,244,236,.9); }
      .meta span:first-child { text-transform:uppercase; letter-spacing:0.06em; color:rgba(255,214,166,.9); }
      .message { margin-top:24px; font-size:15px; line-height:1.7; white-space:pre-wrap; color:#ffffff; }
      .cta { margin-top:32px; text-align:center; }
      .cta a { display:inline-block; padding:12px 28px; border-radius:999px; background:linear-gradient(135deg,#ff8c1a,#ffd166); color:#100a03; font-weight:700; text-decoration:none; letter-spacing:0.04em; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <h1>New HeimeShow Enquiry</h1>
      <p>Someone submitted an enquiry via the website. Details below:</p>
      <div class="meta">
        <div><span>Enquiry Type</span><span>${enquiryType}</span></div>
        <div><span>Name</span><span>${name}</span></div>
        <div><span>Email</span><span>${email}</span></div>
        <div><span>Phone</span><span>${phone || "N/A"}</span></div>
        <div><span>Preferred Date</span><span>${preferredDate || "N/A"}</span></div>
        <div><span>Group Size</span><span>${groupSize || "N/A"}</span></div>
      </div>
      <div class="message">${message.replace(/\n/g, "<br />")}</div>
      <div class="cta"><a href="mailto:${email}" target="_blank" rel="noopener">Reply to ${name}</a></div>
    </div>
  </body>
</html>`;

const signToken = (user) =>
  jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

const sanitizeUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  phone: user.phone,
  createdAt: user.createdAt,
});

const extractToken = (req) => {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
};

app.post("/api/signup/request", async (req, res) => {
  const { name, email, phone, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ ok: false, error: "Name, email, and password are required." });
  }

  try {
    const normalizedEmail = email.toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ ok: false, error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const otp = generateOtp();

    await sendOtp({ name, email, otp });

    await PendingSignup.findOneAndUpdate(
      { email: normalizedEmail },
      {
        name,
        phone: phone || "",
        passwordHash,
        otp: otp.trim(),
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ ok: true, message: "Verification code sent." });
  } catch (error) {
    console.error("OTP email failed", error);
    res.status(500).json({ ok: false, error: "Unable to send verification code." });
  }
});

app.post("/api/signup/verify", async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ ok: false, error: "Email and OTP are required." });
  }

  try {
    const normalizedEmail = email.toLowerCase();
    const submittedOtp = String(otp).trim();

    const pending = await PendingSignup.findOne({ email: normalizedEmail });

    console.log({
      email: normalizedEmail,
      storedOtp: pending?.otp,
      submittedOtp,
      expiresAt: pending?.expiresAt,
      now: new Date(),
    });

    if (!pending) {
      return res.status(400).json({ ok: false, error: "OTP expired or invalid." });
    }

    if (pending.expiresAt.getTime() < Date.now()) {
      await PendingSignup.deleteOne({ email: normalizedEmail });
      return res.status(400).json({ ok: false, error: "OTP expired or invalid." });
    }

    if (pending.otp.trim() !== submittedOtp) {
      return res.status(400).json({ ok: false, error: "OTP expired or invalid." });
    }

    let user = await User.findOne({ email: normalizedEmail });

    try {
      if (user) {
        if (!user.usernameLower) {
          user.usernameLower = normalizedEmail;
          await user.save();
        }
        console.log("User already exists:", user.email);
      }

      if (!user) {
        console.log("Creating new user:", normalizedEmail);
        const fallbackPasswordHash = pending.passwordHash || (await bcrypt.hash(Math.random().toString(36), 12));
        user = await User.create({
          name: pending.name || "HeimeShow Guest",
          email: normalizedEmail,
          phone: pending.phone || "",
          passwordHash: fallbackPasswordHash,
          usernameLower: normalizedEmail,
        });
      }

      if (!user || !user._id) {
        console.error("User creation returned null or missing _id for", normalizedEmail);
        return res.status(500).json({ ok: false, error: "Unable to create user." });
      }

      await PendingSignup.deleteOne({ email: normalizedEmail });

      const token = signToken(user);
      console.log("✅ Signup verified successfully:", normalizedEmail);
      return res.status(200).json({ ok: true, message: "Signup verified", token, user: sanitizeUser(user) });
    } catch (err) {
      console.error("Signup verify failed Error:", err);
      return res.status(500).json({ ok: false, error: "Unable to create user." });
    }

  } catch (error) {
    console.error("Signup verify failed:", error);
    res.status(500).json({ ok: false, error: "Unable to verify the code." });
  }
});

app.post("/api/signin", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "Email and password are required." });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ ok: false, error: "Invalid email or password." });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(400).json({ ok: false, error: "Invalid email or password." });
    }

    const token = signToken(user);
    res.json({ ok: true, token, user: sanitizeUser(user) });
  } catch (error) {
    console.error("Sign in failed", error);
    res.status(500).json({ ok: false, error: "Unable to sign in." });
  }
});

app.get("/api/me", async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Not authenticated." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ ok: false, error: "User not found." });
    }

    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (error) {
    console.error("Token verification failed", error);
    res.status(401).json({ ok: false, error: "Invalid or expired token." });
  }
});

app.post("/api/enquiry", async (req, res) => {
  const { enquiryType, name, email, phone, preferredDate, groupSize, message, metadata = {} } = req.body || {};

  if (!enquiryType || !name || !email || !message) {
    return res.status(400).json({ ok: false, error: "Missing required fields." });
  }

  const plainBody = `Type: ${enquiryType}
Name: ${name}
Email: ${email}
Phone: ${phone || "N/A"}
Preferred Date: ${preferredDate || "N/A"}
Group Size: ${groupSize || "N/A"}

Message:
${message}
`;

  try {
    let source = "website";
    if (req.headers.referer) {
      try {
        source = new URL(req.headers.referer).pathname || "website";
      } catch (parseError) {
        source = "website";
      }
    }

    const stored = await ContactMessage.create({
      enquiryType,
      name,
      email,
      phone: phone || "",
      preferredDate: preferredDate || "",
      groupSize: groupSize || "",
      message,
      source,
      metadata: req.body.metadata || null,
    });

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `HeimeShow Concierge <${process.env.ADMIN_EMAIL}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `HeimeShow Enquiry: ${enquiryType}`,
      text: plainBody,
      html: enquiryTemplate({ enquiryType, name, email, phone, preferredDate, groupSize, message }),
    });

    if (enquiryType === 'Ticket Payment' && email) {
      const {
        movieTitle = 'HeimeShow Feature',
        theatreName = 'HeimeShow Theatre',
        showtime = 'TBA',
        dateReadable = preferredDate || 'TBA',
        seats = [],
        total = '—',
        format: formatLabel = 'Premium Experience',
        method: paymentMethod = 'Card',
      } = metadata;

      const qrData = encodeURIComponent(
        `HeimeShow Booking | ${movieTitle} | ${theatreName} | ${dateReadable} ${showtime} | Seats: ${Array.isArray(seats) ? seats.join(', ') : seats}`
      );

      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${qrData}`;

      const detailHtml = `
        <p><strong>Movie:</strong> ${movieTitle}</p>
        <p><strong>Theatre:</strong> ${theatreName}</p>
        <p><strong>Date:</strong> ${dateReadable}</p>
        <p><strong>Showtime:</strong> ${showtime}</p>
        <p><strong>Format:</strong> ${formatLabel}</p>
        <p><strong>Seats:</strong> ${Array.isArray(seats) ? seats.join(', ') : seats || '—'}</p>
        <p><strong>Total:</strong> AED ${total}</p>
        <p><strong>Payment Method:</strong> ${paymentMethod}</p>
      `;

      const invoiceHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Your HeimeShow Booking</title>
    <style>
      body { margin:0; background:#050505; color:#f7f6f2; font-family:'Montserrat',Arial,sans-serif; }
      .wrap { max-width:600px; margin:0 auto; padding:34px 28px; background:linear-gradient(160deg, rgba(18,18,18,.96), rgba(40,26,18,.9)); border-radius:28px; border:1px solid rgba(255,214,102,.25); }
      h1 { font-size:24px; text-transform:uppercase; letter-spacing:.14em; color:#ffd166; margin:0 0 18px; }
      .summary { margin:24px 0; border:1px solid rgba(255,214,102,.25); border-radius:18px; padding:18px; background:rgba(12,12,12,.85); color:#ffffff; }
      .summary p { margin:0 0 10px; color:#ffffff; }
      .qr { display:flex; align-items:center; gap:18px; margin-top:24px; padding:14px 16px; border:1px solid rgba(255,214,102,.25); border-radius:16px; background:rgba(12,12,12,.75); }
      .qr img { width:120px; height:120px; border-radius:14px; }
      .cta { margin-top:26px; display:inline-block; padding:12px 28px; border-radius:999px; background:linear-gradient(135deg,#ff8c1a,#ffd166); color:#120a04; font-weight:700; letter-spacing:.08em; text-decoration:none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Booking Confirmed</h1>
      <p>Hi ${name || 'Guest'},</p>
      <p>Thank you for securing your seats at HeimeShow. Our concierge will ring you shortly to finalise hospitality preferences and arrival timing.</p>
      <div class="summary">
        ${detailHtml}
      </div>
      <div class="qr">
        <img src="${qrUrl}" alt="HeimeShow QR" />
        <p style="margin:0; color:rgba(247,244,236,.78);">Present this QR code at the concierge lounge for express check-in.</p>
      </div>
      <p>For any adjustments WhatsApp +971 52 902 1184 or reply to this email.</p>
      <a class="cta" href="${process.env.FRONTEND_URL || 'http://localhost:5000'}/account.html">View My Booking</a>
      <p style="margin-top:26px; font-size:13px; color:rgba(247,244,236,.55);">HeimeShow Concierge · Dubai Marina</p>
    </div>
  </body>
</html>`;

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || `HeimeShow Concierge <${process.env.ADMIN_EMAIL}>`,
        to: email,
        subject: 'Your HeimeShow Booking Receipt',
        text: message,
        html: invoiceHtml,
      });
    }

    res.json({ ok: true, enquiryId: stored._id });
  } catch (error) {
    console.error("Enquiry email failed", error);
    res.status(500).json({ ok: false, error: "Email failed." });
  }
});

async function fetchFromTmdb(endpoint, params = {}) {
  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const message = `TMDB request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

app.get('/api/movies/now-playing', async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const region = req.query.region || 'AE';
    const data = await fetchFromTmdb('/movie/now_playing', {
      language: 'en-US',
      page,
      region,
    });
    res.json(data);
  } catch (error) {
    console.error('Now playing fetch failed', error);
    res.status(error.status || 500).json({ ok: false, error: 'Unable to load now playing titles.' });
  }
});

app.get('/api/movies/coming-soon', async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const region = req.query.region || 'AE';
    const data = await fetchFromTmdb('/movie/upcoming', {
      language: 'en-US',
      page,
      region,
    });
    res.json(data);
  } catch (error) {
    console.error('Upcoming fetch failed', error);
    res.status(error.status || 500).json({ ok: false, error: 'Unable to load upcoming titles.' });
  }
});

app.get('/api/movies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await fetchFromTmdb(`/movie/${id}`, {
      language: 'en-US',
      append_to_response: 'credits,videos,release_dates,similar,watch/providers',
    });
    res.json(data);
  } catch (error) {
    console.error('Movie detail fetch failed', error);
    res.status(error.status || 500).json({ ok: false, error: 'Unable to load that feature.' });
  }
});

app.get('/api/debug/users', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).limit(20).lean();
    res.json({ ok: true, users });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Unable to load users.' });
  }
});

app.get('/api/debug/enquiries', async (req, res) => {
  try {
    const enquiries = await ContactMessage.find().sort({ createdAt: -1 }).limit(50).lean();
    res.json({ ok: true, enquiries });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Unable to load enquiries.' });
  }
});

app.post('/api/debug/reset', async (req, res) => {
  try {
    await Promise.all([User.deleteMany({}), ContactMessage.deleteMany({})]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Unable to reset users.' });
  }
});

app.post('/api/notify', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { movieId, movieTitle, releaseDate } = req.body || {};
  if (!movieId || !movieTitle) {
    return res.status(400).json({ ok: false, error: 'Movie details are required.' });
  }

  try {
    await NotificationRequest.create({
      userId: user._id,
      email: user.email,
      name: user.name,
      movieId,
      movieTitle,
      releaseDate: releaseDate || 'TBA',
    });

    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>HeimeShow Premiere Alert</title>
    <style>
      body { margin:0; background:#050505; color:#f7f6f2; font-family:'Montserrat',Arial,sans-serif; }
      .wrap { max-width: 560px; margin:0 auto; padding:32px 26px; background:linear-gradient(160deg, rgba(18,18,18,.96), rgba(40,26,18,.92)); border-radius:28px; border:1px solid rgba(255,214,102,.24); }
      h1 { font-size:24px; text-transform:uppercase; letter-spacing:.16em; color:#ffd166; margin:0 0 18px; }
      p { line-height:1.7; color:rgba(247,244,236,.85); }
      .cta { margin-top:24px; display:inline-block; padding:12px 28px; border-radius:999px; background:linear-gradient(135deg,#ff8c1a,#ffd166); color:#120a04; font-weight:700; letter-spacing:.08em; text-decoration:none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Premiere Alert Set</h1>
      <p>Hi ${user.name.split(' ')[0] || 'there'},</p>
      <p>We’ll notify you the moment <strong>${movieTitle}</strong> opens at HeimeShow Dubai${releaseDate ? ` – currently slated for <strong>${releaseDate}</strong>` : ''}.</p>
      <p>Expect a tailored concierge invite with lounge availability, hospitality pairings, and early-access seat maps.</p>
      <a class="cta" href="${process.env.FRONTEND_URL || 'http://localhost:5000'}/now-showing.html">View Current Lineup</a>
      <p style="margin-top:32px; font-size:13px; color:rgba(247,244,236,.55);">HeimeShow Concierge · Dubai Marina · +971 52 902 1184</p>
    </div>
  </body>
</html>`;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `HeimeShow Concierge <${process.env.ADMIN_EMAIL}>`,
      to: user.email,
      subject: `We’ll alert you when ${movieTitle} premieres`,
      text: `We will notify you when ${movieTitle} premieres in Dubai. Current target: ${releaseDate || 'TBA'}.`,
      html,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Notify request failed', error);
    res.status(500).json({ ok: false, error: 'Unable to schedule notification.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 HeimeShow API listening on port ${PORT}`);
});
