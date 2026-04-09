import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import {ApiError} from './utils/ApiError.js'
import compression from "compression";


const app = express();
app.use((req, res, next) => {
  console.log("Global Check:", req.method, req.url);
  next();
});

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept-Encoding",
    "ngrok-skip-browser-warning"   // ✅ add this
  ],
}));
// app.options("*", cors());
app.use(compression({
  filter: (req, res) => {
    if (req.path.endsWith(".mvt")) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json());



import riverRoutes from "./routes/river.routes.js"
import lakeRoutes from "./routes/lake.routes.js"

app.use("/api/lakes", lakeRoutes);
app.use("/api/rivers", riverRoutes);


app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      statusCode: err.statusCode,
      data: err.data,
      success: err.success,
      errors: err.errors?.length ? err.errors : [err.message],
      message: err.message,
    });
  }

 res.status(500).json({
    success: false,
    message: err.message, // Change this to show the real error in Postman
    stack: err.stack      // This will tell you exactly which line failed
  });
});

export { app };
