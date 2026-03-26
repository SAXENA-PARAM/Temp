import { pool } from "../db/index.js";
import zlib from "zlib";
import { promisify } from "util";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/Asynchandler.js";

const gzipAsync   = promisify(zlib.gzip);
const brotliAsync = promisify(zlib.brotliCompress);

// ─────────────────────────────────────────────────────────────
// Zoom → table mapping
// ─────────────────────────────────────────────────────────────
const ZOOM_BANDS = [
  { maxZoom: 3,        table: "lake_marker_supercluster_test_z2"  },
  { maxZoom: 5,        table: "lake_marker_supercluster_test_z4"  },
  { maxZoom: 7,        table: "lake_marker_supercluster_test_z6"  },
  { maxZoom: 10,       table: "lake_marker_supercluster_test_z9"  },
  { maxZoom: 12,       table: "lake_marker_supercluster_test_z11" },
  { maxZoom: 14,       table: "lake_marker_supercluster_test_z13" },
  { maxZoom: Infinity, table: "latest_markers"               },
];



const ALLOWED_TABLES = new Set(ZOOM_BANDS.map((b) => b.table));

const TTL_BY_ZOOM = (z) => {
  if (z <= 6)  return 86400;
  if (z <= 13) return 3600;
  return 300;
};

// ─────────────────────────────────────────────────────────────
// Strict tile param parser
// Rejects negatives, floats, leading zeros, non-numeric strings
// ─────────────────────────────────────────────────────────────
function parseTileParam(value) {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0 || parsed.toString() !== value) {
    return null;
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────
// Resolve table for zoom level
// ─────────────────────────────────────────────────────────────
function resolveTable(z) {
  return ZOOM_BANDS.find((b) => z < b.maxZoom).table;
}

// ─────────────────────────────────────────────────────────────
// Async compression — brotli preferred, gzip fallback,
// then uncompressed if both fail
// ─────────────────────────────────────────────────────────────
async function compressTile(tile, req) {
  const accept = req.headers["accept-encoding"] || "";

  if (accept.includes("br")) {
    try {
      return { buffer: await brotliAsync(tile), encoding: "br" };
    } catch (err) {
      console.warn("[compressTile] brotli failed, trying gzip:", err.message);
    }
  }

  if (accept.includes("br") || accept.includes("gzip")) {
    try {
      return { buffer: await gzipAsync(tile), encoding: "gzip" };
    } catch (err) {
      console.warn("[compressTile] gzip failed, sending uncompressed:", err.message);
    }
  }

  return { buffer: tile, encoding: null };
}

// ─────────────────────────────────────────────────────────────
// Cluster tile query (z < 14)
// ─────────────────────────────────────────────────────────────
function buildClusterQuery(table) {
  return `
    WITH bounds AS (
      SELECT ST_TileEnvelope($1, $2, $3) AS geom
    )
    SELECT ST_AsMVT(tile, 'markers', 4096, 'geom') AS mvt
    FROM (
      SELECT
        m.is_cluster,
        m.point_count,
        m.avg_wqi,
        m.lake_id,
        m.wqi,
        ST_Y(m.geom) AS lat,
        ST_X(m.geom) AS lng,
        ST_AsMVTGeom(m.geom_3857, bounds.geom, 4096, 256, true) AS geom
      FROM ${table} m, bounds
      WHERE m.geom_3857 && bounds.geom
    ) tile
    WHERE geom IS NOT NULL
  `;
}

// ─────────────────────────────────────────────────────────────
// Individual marker query (z >= 14)
// ─────────────────────────────────────────────────────────────
const MARKER_QUERY = `
  WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS geom
  )
  SELECT ST_AsMVT(tile, 'markers', 4096, 'geom') AS mvt
  FROM (
    SELECT
      m.id,
      m.lake_id,
      m.wqi        AS wqi,
      ST_Y(m.geom) AS lat,
      ST_X(m.geom) AS lng,
      FALSE        AS is_cluster,
      1            AS point_count,
      ST_AsMVTGeom(m.geom_3857, bounds.geom, 4096, 64, true) AS geom
    FROM latest_markers m, bounds
    WHERE m.geom_3857 && bounds.geom
  ) tile
  WHERE geom IS NOT NULL
`;

// ─────────────────────────────────────────────────────────────
// GET /tiles/markers/:z/:x/:y.mvt
// ─────────────────────────────────────────────────────────────
export const getMarkerTiles = asyncHandler(async (req, res) => {
  const z = parseTileParam(req.params.z);
  const x = parseTileParam(req.params.x);
  const y = parseTileParam(req.params.y);

  // 🔒 Always set CORS early (bulletproof)
  

  if (z === null || x === null || y === null) {
    throw new ApiError(400, "Invalid tile coordinates");
  }

  if (z > 22) {
    throw new ApiError(400, "Zoom must be 0–22");
  }

  const table = resolveTable(z);

  if (!ALLOWED_TABLES.has(table)) {
    throw new ApiError(400, "Invalid table resolved");
  }

  try {
    const sql =
      table === "latest_markers"
        ? MARKER_QUERY
        : buildClusterQuery(table);

    const result = await pool.query(sql, [z, x, y]);
    const tile = result.rows[0]?.mvt;

    // 🔥 IMPORTANT: never send 204 for tiles
    if (!tile || tile.length === 0) {
      return res.status(200).set({
        "Content-Type": "application/x-protobuf",
        "Cache-Control": `public, max-age=${TTL_BY_ZOOM(z)}`,
        "X-Tile-Zoom": String(z),
        "X-Tile-Table": table,
      }).send(Buffer.alloc(0));
    }

    const { buffer, encoding } = await compressTile(tile, req);

    res.set({
      "Content-Type": "application/x-protobuf",
      "Cache-Control": `public, max-age=${TTL_BY_ZOOM(z)}`,
      "X-Tile-Zoom": String(z),
      "X-Tile-Table": table,
      ...(encoding && { "Content-Encoding": encoding }),
    });

    return res.status(200).send(buffer);

  } catch (err) {
    console.error(
      `[markerTile] z=${z} x=${x} y=${y} table=${table}`,
      err.message
    );

    throw new ApiError(500, "Tile generation failed");
  }
});
// ─────────────────────────────────────────────────────────────
// POST /tiles/markers/refresh
// ─────────────────────────────────────────────────────────────
export const refreshClusters = async (req, res) => {
  try {
    const start = Date.now();
    await pool.query("CALL test_refresh_clusters()");
    const durationMs = Date.now() - start;
    console.log(`[refreshClusters] completed in ${durationMs}ms`);
    return res.json({ success: true, durationMs });
  } catch (err) {
    console.error("[refreshClusters]", err.message);
    return res.status(500).json({ error: "Cluster refresh failed" });
  }
};