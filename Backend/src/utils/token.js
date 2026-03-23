import jwt from 'jsonwebtoken';

function generateAccessToken(user) {
  if (!process.env.ACCESS_TOKEN_SECRET) {
    console.error("Missing ACCESS_TOKEN_SECRET");
    throw new Error("Missing ACCESS_TOKEN_SECRET");
  }
  return jwt.sign(
    {
      email: user.email,
      username: user.username,
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    }
  );
}

function generateRefreshToken(user) {
  if (!process.env.REFRESH_TOKEN_SECRET) {
    console.error("Missing REFRESH_TOKEN_SECRET");
    throw new Error("Missing REFRESH_TOKEN_SECRET");
  }
  return jwt.sign(
    { id: user.id },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
    }
  );
}

export { generateAccessToken, generateRefreshToken };
