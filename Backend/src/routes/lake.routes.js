import { Router } from "express";
import { validateLakeData } from "../controllers/validation.js";
import { submitData } from "../controllers/submission.js";
import { markerHistory, getMarkerChart, getMarkerYears ,getSubmissionLakes, getSubmissionMarkers , getUserSubmissions} from "../controllers/history.js";
import  { getMarkerTiles, refreshClusters , getStateWiseWqi, getCityWiseWqi,getLakeWiseWqiByCity} from '../controllers/marker.js';

//import { asyncHandler } from "../utils/asynchandler.js";
const router = Router();

router.get("/health", (req, res) => {
  res.json({ message: "Welcome to the Lake API!" });
});

router.route("/validate-or-snap").post(validateLakeData);
router.route("/submit").post(submitData);
router.route("/marker-history").get(markerHistory);
router.route("/marker-chart").get(getMarkerChart);
router.route("/marker-years").get(getMarkerYears);
router.route("/submissions").get(getUserSubmissions);
router.route("/submissions/:submission_id/lakes").get(getSubmissionLakes);
router.route("/submissions/:submission_id/markers").get(getSubmissionMarkers);
router.get('/markers/:z/:x/:y.mvt', getMarkerTiles);
router.post('/markers/refresh', refreshClusters);
router.get('/states/wqi', getStateWiseWqi);
router.get('/cities/wqi/:state_id', getCityWiseWqi);
router.get('/lakes/wqi/:state_id/:city_id', getLakeWiseWqiByCity);


export default router;
