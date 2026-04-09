import { Router } from "express";
import { validateRiverData } from "../controllers/validation.js";


const router = Router();

router.get("/health", (req, res) => {
  res.json({ message: "Welcome to the Lake API!" });
});

router.route("/validate-or-snap").post(validateRiverData);




export default router;