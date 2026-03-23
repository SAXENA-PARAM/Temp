import {pool } from "../db/index.js";


import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/Asynchandler.js";

const validateLakeData = asyncHandler(async (req, res) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    throw new ApiError(400, "Latitude and longitude are required");
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);

  if (isNaN(lat) || isNaN(lng)) {
    throw new ApiError(400, "Invalid coordinates");
  }

  // 1️⃣ Check if point is inside a lake
  const insideLakeQuery = `
    SELECT 
      hylak_id,
      lake_name,
      ST_AsGeoJSON(geom) as geom
    FROM lakes
    WHERE ST_Covers(
      geom,
      ST_SetSRID(ST_MakePoint($1,$2),4326)
    )
    LIMIT 1
  `;

  const insideLake = await pool.query(insideLakeQuery, [lng, lat]);

  if (insideLake.rows.length > 0) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          snapped: false,
          lake: insideLake.rows[0],
          latitude: lat,
          longitude: lng
        },
        "Point is inside lake"
      )
    );
  }

  // 2️⃣ Snap to nearest lake within threshold
 const snapQuery = `
  SELECT
    hylak_id,
    lake_name,
    ST_X(ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint($1,$2),4326))) AS snapped_lng,
    ST_Y(ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint($1,$2),4326))) AS snapped_lat,
    ST_Distance(
      geom::geography,
      ST_SetSRID(ST_MakePoint($1,$2),4326)::geography
    ) AS distance_meters
  FROM lakes
  WHERE ST_DWithin(
    geom::geography,
    ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
    50
  )
  ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1,$2),4326)
  LIMIT 1
`;

  const snappedLake = await pool.query(snapQuery, [lng, lat]);

  if (snappedLake.rows.length === 0) {
    throw new ApiError(404, "No nearby lakes found");
  }

  const lake = snappedLake.rows[0];

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        snapped: true,
        lakeId: lake.hylak_id,
        lakeName: lake.lake_name,
        latitude: parseFloat(lake.snapped_lat),
        longitude: parseFloat(lake.snapped_lng),
        distanceMeters: lake.distance_meters
      },
      "Point snapped to nearest lake"
    )
  );
});



export { validateLakeData }