import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";
import { isMongoAvailable } from "../services/persistenceMode.js";
import {
  createUser as createLocalUser,
  findUserByEmail as findLocalUserByEmail,
  findUserById as findLocalUserById,
  saveUser as saveLocalUser,
} from "../services/localDataStore.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-this";
const TOKEN_TTL = process.env.JWT_EXPIRES_IN || "7d";
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || "");
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:3000";

function userId(user) {
  return String(user?._id || user?.id || "");
}

async function findUserByEmail(email) {
  if (isMongoAvailable()) {
    return User.findOne({ email });
  }
  return findLocalUserByEmail(email);
}

async function findLocalProviderUser(email) {
  if (isMongoAvailable()) {
    return User.findOne({ email, provider: "local" });
  }
  const user = await findLocalUserByEmail(email);
  return user?.provider === "local" ? user : null;
}

async function createUser(data) {
  if (isMongoAvailable()) {
    return User.create(data);
  }
  return createLocalUser(data);
}

async function saveUser(user) {
  if (isMongoAvailable()) {
    await user.save();
    return user;
  }
  return saveLocalUser(user);
}

async function findUserById(id) {
  if (isMongoAvailable()) {
    return User.findById(id);
  }
  return findLocalUserById(id);
}

function signUserToken(user) {
  return jwt.sign(
    {
      sub: userId(user),
      email: user.email,
      name: user.name,
      provider: user.provider,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function safeUser(user) {
  return {
    id: userId(user),
    name: user.name,
    email: user.email,
    provider: user.provider,
    createdAt: user.createdAt,
  };
}

function validateRegistrationInput(name, email, password) {
  if (!name || !email || !password) {
    return "name, email, and password are required";
  }

  if (String(name).trim().length < 2) {
    return "name must be at least 2 characters";
  }

  if (String(password).length < 6) {
    return "password must be at least 6 characters";
  }

  return null;
}

function oauthStateToken() {
  return jwt.sign({ type: "github_oauth_state" }, JWT_SECRET, { expiresIn: "10m" });
}

function frontendRedirect(path) {
  const safePath = path.startsWith("/") ? path : "/login";
  return `${FRONTEND_BASE_URL}${safePath}`;
}

function githubCallbackUrl(req) {
  return process.env.GITHUB_CALLBACK_URL || `${req.protocol}://${req.get("host")}/api/auth/github/callback`;
}

export async function registerUser(req, res) {
  const { name, email, password } = req.body || {};
  const validationError = validateRegistrationInput(name, email, password);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);

  if (existing) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const user = await createUser({
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(String(password), 10),
    provider: "local",
  });

  const token = signUserToken(user);
  return res.status(201).json({ token, user: safeUser(user) });
}

export async function loginUser(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await findLocalProviderUser(normalizedEmail);

  if (!user || !user.passwordHash) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const isValid = await bcrypt.compare(String(password), user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const token = signUserToken(user);
  return res.status(200).json({ token, user: safeUser(user) });
}

export async function googleLogin(req, res) {
  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ message: "credential is required" });
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ message: "Google auth is not configured on backend" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(401).json({ message: "Invalid Google token" });
    }

    const normalizedEmail = payload.email.toLowerCase();
    let user = await findUserByEmail(normalizedEmail);

    if (!user) {
      user = await createUser({
        name: payload.name || normalizedEmail,
        email: normalizedEmail,
        provider: "google",
        googleSub: payload.sub || null,
      });
    } else {
      user.provider = "google";
      user.googleSub = payload.sub || user.googleSub;
      if (!user.name && payload.name) {
        user.name = payload.name;
      }
      user = await saveUser(user);
    }

    const token = signUserToken(user);
    return res.status(200).json({ token, user: safeUser(user) });
  } catch (_err) {
    return res.status(401).json({ message: "Google token verification failed" });
  }
}

export function startGithubLogin(req, res) {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(500).json({ message: "GitHub auth is not configured on backend" });
  }

  const state = oauthStateToken();
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", githubCallbackUrl(req));
  authorizeUrl.searchParams.set("scope", "read:user user:email");
  authorizeUrl.searchParams.set("state", state);

  return res.redirect(authorizeUrl.toString());
}

async function getGithubEmail(accessToken, fallbackEmail) {
  if (fallbackEmail) {
    return fallbackEmail;
  }

  const emailsRes = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "legal-assist-app",
    },
  });

  if (!emailsRes.ok) {
    return null;
  }

  const emails = await emailsRes.json();
  if (!Array.isArray(emails)) {
    return null;
  }

  const preferred =
    emails.find((item) => item?.primary && item?.verified)?.email ||
    emails.find((item) => item?.verified)?.email ||
    emails[0]?.email;

  return preferred ? String(preferred).toLowerCase() : null;
}

export async function githubCallback(req, res) {
  const { code, state } = req.query || {};
  if (!code || !state) {
    return res.redirect(frontendRedirect("/login?oauthError=missing_code_or_state"));
  }

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return res.redirect(frontendRedirect("/login?oauthError=github_not_configured"));
  }

  try {
    jwt.verify(String(state), JWT_SECRET);
  } catch (_err) {
    return res.redirect(frontendRedirect("/login?oauthError=invalid_state"));
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: String(code),
        redirect_uri: githubCallbackUrl(req),
      }),
    });

    if (!tokenRes.ok) {
      return res.redirect(frontendRedirect("/login?oauthError=token_exchange_failed"));
    }

    const tokenData = await tokenRes.json();
    if (!tokenData?.access_token) {
      return res.redirect(frontendRedirect("/login?oauthError=no_access_token"));
    }

    const ghRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "legal-assist-app",
      },
    });

    if (!ghRes.ok) {
      return res.redirect(frontendRedirect("/login?oauthError=github_profile_failed"));
    }

    const ghUser = await ghRes.json();
    const email = await getGithubEmail(tokenData.access_token, ghUser?.email);
    if (!email) {
      return res.redirect(frontendRedirect("/login?oauthError=email_not_available"));
    }

    const normalizedEmail = String(email).toLowerCase();
    let user = await findUserByEmail(normalizedEmail);

    if (!user) {
      user = await createUser({
        name: ghUser?.name || ghUser?.login || normalizedEmail,
        email: normalizedEmail,
        provider: "github",
        githubSub: ghUser?.id ? String(ghUser.id) : null,
      });
    } else {
      user.provider = "github";
      user.githubSub = ghUser?.id ? String(ghUser.id) : user.githubSub;
      if (!user.name) {
        user.name = ghUser?.name || ghUser?.login || normalizedEmail;
      }
      user = await saveUser(user);
    }

    const token = signUserToken(user);
    return res.redirect(frontendRedirect(`/login#token=${encodeURIComponent(token)}`));
  } catch (_err) {
    return res.redirect(frontendRedirect("/login?oauthError=github_login_failed"));
  }
}

export async function getCurrentUser(req, res) {
  if (!req.user?.sub) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const user = await findUserById(req.user.sub);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    return res.status(200).json({ user: safeUser(user) });
  } catch (_err) {
    return res.status(500).json({ message: "Failed to load user" });
  }
}
