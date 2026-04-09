import { v4 as uuidv4 } from "uuid";
import { pool } from "../db/index.js";
import { wqiQueue } from "../queues/wqi.queue.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/Asynchandler.js";

export const submitData = asyncHandler(async (req, res) => {
  const { markers } = req.body;
  const userId = "95c3371a-3bc6-4f39-bbba-bbf43de38921";

  // ── validation ────────────────────────────────────────────────────────────
  if (!markers || !Array.isArray(markers) || markers.length === 0) {
    throw new ApiError(400, "markers array is required and must not be empty");
  }
  if (markers.length > 50) {
    throw new ApiError(400, "Maximum 50 markers allowed per submission");
  }

  const markerErrors = [];
markers.forEach((m, i) => {
  if (!m.lake_id) markerErrors.push(`markers[${i}]: lake_id is required`);

  if (m.lat == null) {
    markerErrors.push(`markers[${i}]: lat is required`);
  } else if (isNaN(parseFloat(m.lat))) {
    markerErrors.push(`markers[${i}]: lat must be a number`);
  } else if (parseFloat(m.lat) < -90 || parseFloat(m.lat) > 90) {
    markerErrors.push(`markers[${i}]: lat must be between -90 and 90`);
  }

  if (m.lng == null) {
    markerErrors.push(`markers[${i}]: lng is required`);
  } else if (isNaN(parseFloat(m.lng))) {
    markerErrors.push(`markers[${i}]: lng must be a number`);
  } else if (parseFloat(m.lng) < -180 || parseFloat(m.lng) > 180) {
    markerErrors.push(`markers[${i}]: lng must be between -180 and 180`);
  }

  if (!m.parameters || typeof m.parameters !== "object" || Array.isArray(m.parameters)) {
    markerErrors.push(`markers[${i}]: parameters must be a non-empty object`);
  } else if (Object.keys(m.parameters).length === 0) {
    markerErrors.push(`markers[${i}]: parameters must not be empty`);
  }

  if (m.observed_at && isNaN(new Date(m.observed_at))) {
    markerErrors.push(`markers[${i}]: observed_at is not a valid date`);
  }
});
if (markerErrors.length > 0) {
  throw new ApiError(400, "Marker validation failed", markerErrors);
}

  // ── DB ────────────────────────────────────────────────────────────────────
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const submissionId = uuidv4();

    // observed_at not passed — Postgres DEFAULT NOW() fills it
    await client.query(
      `INSERT INTO submissions (id, user_id, status)
       VALUES ($1, $2, 'pending')`,
      [submissionId, userId]
    );

    const lakeIds     = markers.map((m) => m.lake_id);
    const lats        = markers.map((m) => parseFloat(m.lat));
    const lngs        = markers.map((m) => parseFloat(m.lng));
    const parameters  = markers.map((m) => JSON.stringify(m.parameters));
    const observedAts = markers.map((m) =>
      m.observed_at ? new Date(m.observed_at) : new Date()
    );

    await client.query(
      `INSERT INTO temp_markers
         (submission_id, lake_id, geom, parameters, created_by, created_at)
       SELECT
         $1,
         lake_id,
         ST_SetSRID(ST_Point(lng, lat), 4326),
         param::jsonb,
         $2,
         obs_at
       FROM UNNEST(
         $3::int[],
         $4::float8[],
         $5::float8[],
         $6::text[],
         $7::timestamptz[]
       ) AS t(lake_id, lat, lng, param, obs_at)`,
      [submissionId, userId, lakeIds, lats, lngs, parameters, observedAts]
    );

    await client.query("COMMIT");

    await wqiQueue.add(
      "calculate",
      { submissionId, userId, markerCount: markers.length },
      { jobId: submissionId }
    );

    return res.status(201).json(
      new ApiResponse(
        201,
        { submission_id: submissionId, marker_count: markers.length, status: "pending" },
        "Submission received and queued for processing"
      )
    );
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, "Submission failed", [err.message]);
  } finally {
    client.release();
  }
});


export const submitRiverData = asyncHandler(async (req, res) => {
  const { markers } = req.body;
  const userId = "95c3371a-3bc6-4f39-bbba-bbf43de38921";

  // ── validation ────────────────────────────────────────────────────────────
  if (!markers || !Array.isArray(markers) || markers.length === 0) {
    throw new ApiError(400, "markers array is required and must not be empty");
  }
  if (markers.length > 50) {
    throw new ApiError(400, "Maximum 50 markers allowed per submission");
  }

  const markerErrors = [];
markers.forEach((m, i) => {
  if (!m.river_id) markerErrors.push(`markers[${i}]: river_id is required`);

  if (m.lat == null) {
    markerErrors.push(`markers[${i}]: lat is required`);
  } else if (isNaN(parseFloat(m.lat))) {
    markerErrors.push(`markers[${i}]: lat must be a number`);
  } else if (parseFloat(m.lat) < -90 || parseFloat(m.lat) > 90) {
    markerErrors.push(`markers[${i}]: lat must be between -90 and 90`);
  }

  if (m.lng == null) {
    markerErrors.push(`markers[${i}]: lng is required`);
  } else if (isNaN(parseFloat(m.lng))) {
    markerErrors.push(`markers[${i}]: lng must be a number`);
  } else if (parseFloat(m.lng) < -180 || parseFloat(m.lng) > 180) {
    markerErrors.push(`markers[${i}]: lng must be between -180 and 180`);
  }

  if (!m.parameters || typeof m.parameters !== "object" || Array.isArray(m.parameters)) {
    markerErrors.push(`markers[${i}]: parameters must be a non-empty object`);
  } else if (Object.keys(m.parameters).length === 0) {
    markerErrors.push(`markers[${i}]: parameters must not be empty`);
  }

  if (m.observed_at && isNaN(new Date(m.observed_at))) {
    markerErrors.push(`markers[${i}]: observed_at is not a valid date`);
  }
});
if (markerErrors.length > 0) {
  throw new ApiError(400, "Marker validation failed", markerErrors);
}

  // ── DB ────────────────────────────────────────────────────────────────────
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const submissionId = uuidv4();

    // observed_at not passed — Postgres DEFAULT NOW() fills it
    await client.query(
      `INSERT INTO river_submissions (id, user_id, status)
       VALUES ($1, $2, 'pending')`,
      [submissionId, userId]
    );

    const riverIds     = markers.map((m) => m.river_id);
    const lats        = markers.map((m) => parseFloat(m.lat));
    const lngs        = markers.map((m) => parseFloat(m.lng));
    const parameters  = markers.map((m) => JSON.stringify(m.parameters));
    const observedAts = markers.map((m) =>
      m.observed_at ? new Date(m.observed_at) : new Date()
    );

    await client.query(
      `INSERT INTO temp_river_markers
         (submission_id, river_id, geom, parameters, created_by, created_at)
       SELECT
         $1,
         river_id,
         ST_SetSRID(ST_Point(lng, lat), 4326),
         param::jsonb,
         $2,
         obs_at
       FROM UNNEST(
         $3::int[],
         $4::float8[],
         $5::float8[],
         $6::text[],
         $7::timestamptz[]
       ) AS t(river_id, lat, lng, param, obs_at)`,
      [submissionId, userId, riverIds, lats, lngs, parameters, observedAts]
    );

    await client.query("COMMIT");

    await wqiQueue.add(
      "river_calculate",
      { submissionId, userId, markerCount: markers.length },
      { jobId: submissionId }
    );

    return res.status(201).json(
      new ApiResponse(
        201,
        { submission_id: submissionId, marker_count: markers.length, status: "pending" },
        "Submission received and queued for processing"
      )
    );
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, "Submission failed", [err.message]);
  } finally {
    client.release();
  }
});