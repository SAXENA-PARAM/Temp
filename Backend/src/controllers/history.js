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
        AND  ST_DWithin(geom, ST_SetSRID(ST_Point($2, $3), 4326), 1e-8)
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

export const RiverMarkerHistory = asyncHandler(async (req, res) => {
    const { river_id, lat, lng } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    if (!river_id || !lat || !lng) {
        throw new ApiError(400, "river_id, lat and lng are required");
    }

    const offset = (page - 1) * limit;

    const history = await pool.query(
        `
        SELECT
            parameters,
            wqi,
            created_by,
            created_at,
            basin,
            sub_basin
        FROM river_marker_history
        WHERE river_id = $1
        AND  ST_DWithin(geom, ST_SetSRID(ST_Point($2, $3), 4326), 1e-8)
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5
        `,
        [river_id, lng, lat, limit, offset]
    );

    const results = history.rows.map(({ basin, sub_basin, ...rest }) => ({
        ...rest,
        ...(basin     && { basin }),
        ...(sub_basin && { sub_basin }),
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            { page, limit, results },
            "Marker history fetched"
        )
    );
});

export const getMarkerChart = asyncHandler(async (req, res) => {
    const { lake_id, lat, lng, year } = req.query;

    if (!lake_id || !lat || !lng || !year) {
        throw new ApiError(400, "lake_id, lat, lng and year are required");
    }

    const parsedLat    = parseFloat(lat);
    const parsedLng    = parseFloat(lng);
    const parsedYear   = parseInt(year, 10);
    const parsedLakeId = parseInt(lake_id, 10);

    if (
        isNaN(parsedLat) || isNaN(parsedLng) ||
        isNaN(parsedYear) || isNaN(parsedLakeId)
    ) {
        throw new ApiError(400, "Invalid numeric values in query parameters");
    }

    const startDate = `${parsedYear}-01-01`;
    const endDate   = `${parsedYear + 1}-01-01`;

    // Run both queries in parallel
    const [wqiResult, paramsResult] = await Promise.all([

        // WQI avg per month
        pool.query(
                  `
            SELECT
                EXTRACT(MONTH FROM created_at)::int AS month,
                AVG(wqi) AS avg_wqi
            FROM lake_marker_history
            WHERE lake_id = $1
              AND created_at >= $4
              AND created_at < $5
              AND ST_DWithin(
                    geom,
                    ST_SetSRID(ST_Point($2, $3), 4326),
                    1e-8
                  )
            GROUP BY month
            ORDER BY month
            `,
            [parsedLakeId, parsedLng, parsedLat, startDate, endDate]
        ),

        // All parameter keys available for this marker + year
        // with their avg value per month
        pool.query(
            `
            SELECT
                key AS parameter,
                EXTRACT(MONTH FROM created_at)::int AS month,
                AVG(value::double precision) AS avg_value
            FROM lake_marker_history
            CROSS JOIN LATERAL jsonb_each_text(parameters)
            WHERE lake_id = $1
              AND created_at >= $4
              AND created_at < $5
              AND parameters IS NOT NULL
              AND parameters <> '{}'
              AND ST_DWithin(
                    geom,
                    ST_SetSRID(ST_Point($2, $3), 4326),
                    1e-8
                  )
            GROUP BY key, month
            ORDER BY key, month
            `,
            [parsedLakeId, parsedLng, parsedLat, startDate, endDate]
        )
    ]);

    // Group parameter rows by param_key for easy frontend consumption
    // { pH: [{month:1, avg_value:7.2}, ...], turbidity: [...], ... }
    const parameters = paramsResult.rows.reduce((acc, row) => {
        if (!acc[row.parameter]) acc[row.parameter] = [];
        acc[row.parameter].push({
            month:     row.month,
            avg_value: parseFloat(row.avg_value)
        });
        return acc;
    }, {});

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                year: parsedYear,
                wqi: wqiResult.rows.map(r => ({
                    month:   r.month,
                    avg_wqi: parseFloat(r.avg_wqi)
                })),
                parameters  // keys = available param names, values = monthly avg data
            },
            "Chart data fetched successfully"
        )
    );
});

export const RiverMarkerChart = asyncHandler(async (req, res) => {
    const { river_id, lat, lng, year } = req.query;

    if (!river_id || !lat || !lng || !year) {
        throw new ApiError(400, "river_id, lat, lng and year are required");
    }

    const parsedLat    = parseFloat(lat);
    const parsedLng    = parseFloat(lng);
    const parsedYear   = parseInt(year, 10);
    const parsedRiverId = parseInt(river_id, 10);

    if (
        isNaN(parsedLat) || isNaN(parsedLng) ||
        isNaN(parsedYear) || isNaN(parsedRiverId)
    ) {
        throw new ApiError(400, "Invalid numeric values in query parameters");
    }

    const startDate = `${parsedYear}-01-01`;
    const endDate   = `${parsedYear + 1}-01-01`;

    // Run both queries in parallel
    const [wqiResult, paramsResult] = await Promise.all([

        // WQI avg per month
        pool.query(
                  `
            SELECT
                EXTRACT(MONTH FROM created_at)::int AS month,
                AVG(wqi) AS avg_wqi
            FROM river_marker_history
            WHERE river_id = $1
              AND created_at >= $4
              AND created_at < $5
              AND ST_DWithin(
                    geom,
                    ST_SetSRID(ST_Point($2, $3), 4326),
                    1e-8
                  )
            GROUP BY month
            ORDER BY month
            `,
            [parsedRiverId, parsedLng, parsedLat, startDate, endDate]
        ),

        // All parameter keys available for this marker + year
        // with their avg value per month
        pool.query(
            `
            SELECT
                key AS parameter,
                EXTRACT(MONTH FROM created_at)::int AS month,
                AVG(value::double precision) AS avg_value
            FROM river_marker_history
            CROSS JOIN LATERAL jsonb_each_text(parameters)
            WHERE river_id = $1
              AND created_at >= $4
              AND created_at < $5
              AND parameters IS NOT NULL
              AND parameters <> '{}'
              AND ST_DWithin(
                    geom,
                    ST_SetSRID(ST_Point($2, $3), 4326),
                    1e-8
                  )
            GROUP BY key, month
            ORDER BY key, month
            `,
            [parsedRiverId, parsedLng, parsedLat, startDate, endDate]
        )
    ]);

    // Group parameter rows by param_key for easy frontend consumption
    // { pH: [{month:1, avg_value:7.2}, ...], turbidity: [...], ... }
    const parameters = paramsResult.rows.reduce((acc, row) => {
        if (!acc[row.parameter]) acc[row.parameter] = [];
        acc[row.parameter].push({
            month:     row.month,
            avg_value: parseFloat(row.avg_value)
        });
        return acc;
    }, {});

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                year: parsedYear,
                wqi: wqiResult.rows.map(r => ({
                    month:   r.month,
                    avg_wqi: parseFloat(r.avg_wqi)
                })),
                parameters  // keys = available param names, values = monthly avg data
            },
            "Chart data fetched successfully"
        )
    );
});

export const getMarkerYears = asyncHandler(async (req, res) => {
    const { lake_id, lat, lng } = req.query;

    if (!lake_id || !lat || !lng) {
        throw new ApiError(400, "lake_id, lat and lng are required");
    }

    const parsedLat    = parseFloat(lat);
    const parsedLng    = parseFloat(lng);
    const parsedLakeId = parseInt(lake_id, 10);

    if (isNaN(parsedLat) || isNaN(parsedLng) || isNaN(parsedLakeId)) {
        throw new ApiError(400, "Invalid numeric values in query parameters");
    }

    const result = await pool.query(
        `
        SELECT 
             EXTRACT(YEAR FROM created_at)::int AS year
        FROM lake_marker_history
        WHERE lake_id = $1
          AND created_at >= '2015-01-01'
          AND created_at < '2030-01-01'
          AND ST_DWithin(
                geom,
                ST_SetSRID(ST_Point($2, $3), 4326),
                1e-8
              )
        GROUP BY year
        ORDER BY year DESC
        `,
        [parsedLakeId, parsedLng, parsedLat]
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows.map(r => r.year),   // [2024, 2023, 2022]
            "Available years fetched successfully"
        )
    );
});

export const RiverMarkerYears = asyncHandler(async (req, res) => {
    const { river_id, lat, lng } = req.query;

    if (!river_id || !lat || !lng) {
        throw new ApiError(400, "river_id, lat and lng are required");
    }

    const parsedLat    = parseFloat(lat);
    const parsedLng    = parseFloat(lng);
    const parsedRiverId = parseInt(river_id, 10);

    if (isNaN(parsedLat) || isNaN(parsedLng) || isNaN(parsedRiverId)) {
        throw new ApiError(400, "Invalid numeric values in query parameters");
    }

    const result = await pool.query(
        `
        SELECT 
             EXTRACT(YEAR FROM created_at)::int AS year
        FROM river_marker_history
        WHERE river_id = $1
          AND created_at >= '2015-01-01'
          AND created_at < '2030-01-01'
          AND ST_DWithin(
                geom,
                ST_SetSRID(ST_Point($2, $3), 4326),
                1e-8
              )
        GROUP BY year
        ORDER BY year DESC
        `,
        [parsedRiverId, parsedLng, parsedLat]
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows.map(r => r.year),   // [2024, 2023, 2022]
            "Available years fetched successfully"
        )
    );
});


export const getUserSubmissions = asyncHandler(async (req, res) => {

    const userId = "95c3371a-3bc6-4f39-bbba-bbf43de38921";

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

export const getUserRiverSubmissions =asyncHandler(async (req, res) => {

    const userId = "95c3371a-3bc6-4f39-bbba-bbf43de38921";

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
        FROM river_submissions
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

export const getSubmissionRivers = asyncHandler(async (req, res) => {

    const { submission_id } = req.params;
     const userId = "95c3371a-3bc6-4f39-bbba-bbf43de38921";

    if (!submission_id) {
        throw new ApiError(400, "submission_id required");
    }

    // verify submission belongs to user
    const submission = await pool.query(
        `
        SELECT status
        FROM river_submissions
        WHERE id = $1 AND user_id = $2
        `,
        [submission_id, userId]
    );

    if (!submission.rows.length) {
        throw new ApiError(404, "Submission not found");
    }

    const status = submission.rows[0].status;

    let rivers;

    if (status === "pending" || status === "processing" || status==="error") {

        rivers = await pool.query(
            `
            SELECT
            river_id,
            COUNT(*) AS marker_count
            FROM temp_river_markers
            WHERE submission_id = $1
            GROUP BY river_id
            ORDER BY river_id
            `,
            [submission_id]
        );

    } else {

        rivers = await pool.query(
            `
            SELECT
            river_id,
            COUNT(*) AS marker_count
            FROM river_marker_history
            WHERE submission_id = $1
            GROUP BY river_id
            ORDER BY river_id
            `,
            [submission_id]
        );

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                status,
                rivers: rivers.rows
            },
            "Available rivers fetched"
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
            ORDER BY id DESC
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
            ORDER BY id DESC
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


export const getRiverSubmissionMarkers = asyncHandler(async (req, res) => {

    const { submission_id } = req.params;
    const { river_id } = req.query;

    const userId = "95c3371a-3bc6-4f39-bbba-bbf43de38921";

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    if (!submission_id) {
        throw new ApiError(400, "submission_id required");
    }

    if (!river_id) {
        throw new ApiError(400, "river_id required");
    }

    // verify submission belongs to user
    const submission = await pool.query(
        `
        SELECT status
        FROM river_submissions
        WHERE id = $1 AND user_id = $2
        `,
        [submission_id, userId]
    );

    if (!submission.rows.length) {
        throw new ApiError(404, "Submission not found");
    }

    const status = submission.rows[0].status;

    let markers;

    if (status === "pending" || status === "processing" || status === "error") {

        markers = await pool.query(
            `
            SELECT
                river_id,
                ST_Y(geom) AS lat,
                ST_X(geom) AS lng,
                parameters,
                created_at,
                basin,
                sub_basin
            FROM temp_river_markers
            WHERE submission_id = $1
            AND river_id = $2
            ORDER BY id DESC
            LIMIT $3 OFFSET $4
            `,
            [submission_id, river_id, limit, offset]
        );

    } else {

        markers = await pool.query(
            `
            SELECT
                river_id,
                ST_Y(geom) AS lat,
                ST_X(geom) AS lng,
                parameters,
                satellite_data,
                wqi,
                created_at,
                basin,
                sub_basin
            FROM river_marker_history
            WHERE submission_id = $1
            AND river_id = $2
            ORDER BY id DESC
            LIMIT $3 OFFSET $4
            `,
            [submission_id, river_id, limit, offset]
        );
    }

    const results = markers.rows.map(({ basin, sub_basin, ...rest }) => ({
        ...rest,
        ...(basin     && { basin }),
        ...(sub_basin && { sub_basin }),
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                status,
                page,
                limit,
                markers: results
            },
            "Submission markers fetched"
        )
    );

});

export const getCCMEChart = asyncHandler(async (req, res) => {
    const { lake_id, lat, lng } = req.query;

    if (!lake_id || !lat || !lng) {
        throw new ApiError(400, "lake_id, lat and lng are required");
    }

    const parsedLat    = parseFloat(lat);
    const parsedLng    = parseFloat(lng);
    const parsedLakeId = parseInt(lake_id, 10);

    if (isNaN(parsedLat) || isNaN(parsedLng) || isNaN(parsedLakeId)) {
        throw new ApiError(400, "Invalid numeric values in query parameters");
    }

    const result = await pool.query(
        `
        SELECT
            year,
            f1,
            f2,
            f3,
            ccme_wqi
        FROM lake_ccme_wqi
        WHERE lake_id = $1
          AND ST_DWithin(
                geom,
                ST_SetSRID(ST_Point($2, $3), 4326),
                1e-8
              )
        ORDER BY year ASC
        `,
        [parsedLakeId, parsedLng, parsedLat]
    );

    if (result.rows.length === 0) {
        throw new ApiError(404, "No CCME WQI data found for this location");
    }

    const data = result.rows.map(row => ({
        year:     row.year,
        f1:       parseFloat(row.f1),
        f2:       parseFloat(row.f2),
        f3:       parseFloat(row.f3),
        ccme_wqi: parseFloat(row.ccme_wqi)
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            { lake_id: parsedLakeId, data },
            "CCME WQI chart data fetched successfully"
        )
    );
});

export const getLatestCCME = asyncHandler(async (req, res) => {
    const { lake_id, lat, lng } = req.query;

    if (!lake_id || !lat || !lng) {
        throw new ApiError(400, "lake_id, lat and lng are required");
    }

    const parsedLat    = parseFloat(lat);
    const parsedLng    = parseFloat(lng);
    const parsedLakeId = parseInt(lake_id, 10);

    if (isNaN(parsedLat) || isNaN(parsedLng) || isNaN(parsedLakeId)) {
        throw new ApiError(400, "Invalid numeric values in query parameters");
    }

    const result = await pool.query(
        `
        SELECT
            year,
            f1,
            f2,
            f3,
            ccme_wqi
        FROM lake_ccme_wqi
        WHERE lake_id = $1
          AND ST_DWithin(
                geom,
                ST_SetSRID(ST_Point($2, $3), 4326),
                1e-8
              )
        ORDER BY year DESC
        LIMIT 1
        `,
        [parsedLakeId, parsedLng, parsedLat]
    );

    if (result.rows.length === 0) {
        throw new ApiError(404, "No CCME WQI data found for this location");
    }

    const row = result.rows[0];

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                lake_id:  parsedLakeId,
                year:     row.year,
                f1:       parseFloat(row.f1),
                f2:       parseFloat(row.f2),
                f3:       parseFloat(row.f3),
                ccme_wqi: parseFloat(row.ccme_wqi)
            },
            "Latest CCME WQI fetched successfully"
        )
    );
});

export const getRiverLatestCCME = asyncHandler(async (req, res) => {
    const { river_id, lat, lng } = req.query;

    if (!river_id || !lat || !lng) {
        throw new ApiError(400, "river_id, lat and lng are required");
    }

    const parsedLat     = parseFloat(lat);
    const parsedLng     = parseFloat(lng);
    const parsedRiverId = parseInt(river_id, 10);

    if (isNaN(parsedLat) || isNaN(parsedLng) || isNaN(parsedRiverId)) {
        throw new ApiError(400, "Invalid numeric values in query parameters");
    }

    const result = await pool.query(
        `
        SELECT
            year,
            f1,
            f2,
            f3,
            ccme_wqi
        FROM river_ccme_wqi
        WHERE river_id = $1
          AND ST_DWithin(
                geom,
                ST_SetSRID(ST_Point($2, $3), 4326),
                1e-8
              )
        ORDER BY year DESC
        LIMIT 1
        `,
        [parsedRiverId, parsedLng, parsedLat]
    );

    if (result.rows.length === 0) {
        throw new ApiError(404, "No CCME WQI data found for this location");
    }

    const row = result.rows[0];

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                river_id: parsedRiverId,
                year:     row.year,
                f1:       parseFloat(row.f1),
                f2:       parseFloat(row.f2),
                f3:       parseFloat(row.f3),
                ccme_wqi: parseFloat(row.ccme_wqi)
            },
            "Latest CCME WQI fetched successfully"
        )
    );  
});

export const getRiverCCMEChart = asyncHandler(async (req, res) => {
    const { river_id, lat, lng } = req.query;
    
    if (!river_id || !lat || !lng) {
        throw new ApiError(400, "river_id, lat and lng are required");
    }

    const parsedLat     = parseFloat(lat);
    const parsedLng     = parseFloat(lng);
    const parsedRiverId = parseInt(river_id, 10);
    
    if (isNaN(parsedLat) || isNaN(parsedLng) || isNaN(parsedRiverId)) {
        throw new ApiError(400, "Invalid numeric values in query parameters");
    }

    const result = await pool.query(
        `
        SELECT
            year,
            f1,
            f2,
            f3,
            ccme_wqi
        FROM river_ccme_wqi
        WHERE river_id = $1
          AND ST_DWithin(
                geom,
                ST_SetSRID(ST_Point($2, $3), 4326),
                1e-8
              )
        ORDER BY year ASC
        `,
        [parsedRiverId, parsedLng, parsedLat]
    );

    if (result.rows.length === 0) {
        throw new ApiError(404, "No CCME WQI data found for this location");
    }

    const data = result.rows.map(row => ({
        year:     row.year,
        f1:       parseFloat(row.f1),
        f2:       parseFloat(row.f2),
        f3:       parseFloat(row.f3),
        ccme_wqi: parseFloat(row.ccme_wqi)
    }));    

    return res.status(200).json(
        new ApiResponse(
            200,
            { data },
            "CCME WQI chart data fetched successfully"
        )
    );  
});



