import { Router } from "express";
import { validateRiverData } from "../controllers/validation.js";
import { submitRiverData } from "../controllers/submission.js";
import { RiverMarkerHistory, RiverMarkerChart, RiverMarkerYears, getUserRiverSubmissions, getSubmissionRivers, getRiverSubmissionMarkers,getRiverCCMEChart, getRiverLatestCCME} from "../controllers/history.js";
import  { getRiverMarkerTiles, refreshRiverClusters } from '../controllers/marker.js';


const router = Router();

router.get("/health", (req, res) => {
  res.json({ message: "Welcome to the River API!" });
});

router.route("/validate-or-snap").post(validateRiverData);
router.route("/submit").post(submitRiverData);
router.route("/marker-history").get(RiverMarkerHistory);
router.route("/marker-chart").get(RiverMarkerChart);
router.route("/marker-years").get(RiverMarkerYears);
router.route("/submissions").get(getUserRiverSubmissions);
router.route("/submissions/:submission_id/lakes").get(getSubmissionRivers);
router.route("/submissions/:submission_id/markers").get(getRiverSubmissionMarkers);
router.get('/markers/:z/:x/:y.mvt', getRiverMarkerTiles);
router.post('/markers/refresh', refreshRiverClusters);


router.route("/ccme-chart").get(getRiverCCMEChart);
router.route("/latest-ccme").get(getRiverLatestCCME);

// router.get('/states/wqi', getStateWiseWqi);
// router.get('/cities/wqi/:state_id', getCityWiseWqi);
// router.get('/lakes/wqi/:state_id/:city_id', getLakeWiseWqiByCity);




export default router;