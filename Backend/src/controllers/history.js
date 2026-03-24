import {pool } from "../db/index.js";


import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/Asynchandler.js";


export const markerHistory = asyncHandler(async (req, res) => {
const { lake_id, lat, lng } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    if (!lake_id || !lat || !lng) {
        throw new ApiError(400, "lake_id, lat and lng are required");
    }

    const offset = (page - 1) * limit;

    const history = await pool.query(
        `
        SELECT
            parameters,
            wqi,
            created_by,
            created_at
        FROM lake_marker_history
        WHERE lake_id = $1
        AND geom = ST_SetSRID(ST_Point($2,$3),4326)
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5
        `,
        [lake_id, lng, lat, limit, offset]
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                page,
                limit,
                results: history.rows
            },
            "Marker history fetched"
        )
    );
});


export const getMarkerChart = asyncHandler(async (req, res) => {

    const { lake_id, lat, lng, year } = req.query;

    if (!lake_id || !lat || !lng || !year) {
        throw new ApiError(
            400,
            "lake_id, lat, lng and year are required"
        );
    }

    const result = await pool.query(
        `
        SELECT
        EXTRACT(MONTH FROM created_at) AS month,
        AVG(wqi) AS avg_wqi

        FROM lake_marker_history

        WHERE lake_id = $1
        AND geom = ST_SetSRID(ST_Point($2,$3),4326)
        AND EXTRACT(YEAR FROM created_at) = $4

        GROUP BY month
        ORDER BY month
        `,
        [lake_id, lng, lat, year]
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows,
            "Chart data fetched successfully"
        )
    );
});

export const getMarkerYears = asyncHandler(async (req, res) => {

    const { lake_id, lat, lng } = req.query;

    if (!lake_id || !lat || !lng) {
        throw new ApiError(400, "lake_id, lat and lng are required");
    }

    const result = await pool.query(
        `
        SELECT DISTINCT
        EXTRACT(YEAR FROM created_at) AS year

        FROM lake_marker_history

        WHERE lake_id = $1
        AND geom = ST_SetSRID(ST_Point($2,$3),4326)

        ORDER BY year DESC
        `,
        [lake_id, lng, lat]
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows,
            "Available years fetched successfully"
        )
    );
});


export const getUserSubmissions = asyncHandler(async (req, res) => {

    const userId = "95c3371a-3bc6-4f39-bbba-bbf43de38921";;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const offset = (page - 1) * limit;

    const submissions = await pool.query(
        `
        SELECT
        id,
        status,
        created_at,
        processed_at
        FROM submissions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [userId, limit, offset]
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                page,
                limit,
                submissions: submissions.rows
            },
            "User submissions fetched"
        )
    );
});


export const getSubmissionLakes = asyncHandler(async (req, res) => {

    const { submission_id } = req.params;
     const userId = "95c3371a-3bc6-4f39-bbba-bbf43de38921";

    if (!submission_id) {
        throw new ApiError(400, "submission_id required");
    }

    // verify submission belongs to user
    const submission = await pool.query(
        `
        SELECT status
        FROM submissions
        WHERE id = $1 AND user_id = $2
        `,
        [submission_id, userId]
    );

    if (!submission.rows.length) {
        throw new ApiError(404, "Submission not found");
    }

    const status = submission.rows[0].status;

    let lakes;

    if (status === "pending" || status === "processing" || status==="error") {

        lakes = await pool.query(
            `
            SELECT
            lake_id,
            COUNT(*) AS marker_count
            FROM temp_markers
            WHERE submission_id = $1
            GROUP BY lake_id
            ORDER BY lake_id
            `,
            [submission_id]
        );

    } else {

        lakes = await pool.query(
            `
            SELECT
            lake_id,
            COUNT(*) AS marker_count
            FROM lake_marker_history
            WHERE submission_id = $1
            GROUP BY lake_id
            ORDER BY lake_id
            `,
            [submission_id]
        );

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                status,
                lakes: lakes.rows
            },
            "Available lakes fetched"
        )
    );
});

export const getSubmissionMarkers = asyncHandler(async (req, res) => {

    const { submission_id } = req.params;
    const { lake_id } = req.query;

     const userId = "95c3371a-3bc6-4f39-bbba-bbf43de38921";

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    if (!submission_id) {
        throw new ApiError(400, "submission_id required");
    }

    if (!lake_id) {
        throw new ApiError(400, "lake_id required");
    }

    // verify submission belongs to user
    const submission = await pool.query(
        `
        SELECT status
        FROM submissions
        WHERE id = $1 AND user_id = $2
        `,
        [submission_id, userId]
    );

    if (!submission.rows.length) {
        throw new ApiError(404, "Submission not found");
    }

    const status = submission.rows[0].status;

    let markers;

    // pending / processing markers
    if (status === "pending" || status === "processing" || status==="error") {

        markers = await pool.query(
            `
            SELECT
            lake_id,
            ST_Y(geom) AS lat,
            ST_X(geom) AS lng,
            parameters,
            created_at
            FROM temp_markers
            WHERE submission_id = $1
            AND lake_id = $2
            ORDER BY ST_Y(geom), ST_X(geom)
            LIMIT $3 OFFSET $4
            `,
            [submission_id, lake_id, limit, offset]
        );

    } else {

        // processed markers
        markers = await pool.query(
            `
            SELECT
            lake_id,
            ST_Y(geom) AS lat,
            ST_X(geom) AS lng,
            parameters,
            satellite_data,
            wqi,
            created_at
            FROM lake_marker_history
            WHERE submission_id = $1
            AND lake_id = $2
            ORDER BY ST_Y(geom), ST_X(geom)
            LIMIT $3 OFFSET $4
            `,
            [submission_id, lake_id, limit, offset]
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                status,
                page,
                limit,
                markers: markers.rows
            },
            "Submission markers fetched"
        )
    );

});