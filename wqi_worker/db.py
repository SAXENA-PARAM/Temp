import json
import asyncpg
from config import DATABASE_URL


async def get_connection() -> asyncpg.Connection:
    return await asyncpg.connect(DATABASE_URL)


async def fetch_markers(conn: asyncpg.Connection, submission_id: str) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT
            lake_id,
            ST_Y(geom)  AS lat,
            ST_X(geom)  AS lng,
            parameters,
            created_by,
            created_at AS observed_at
        FROM temp_markers
        WHERE submission_id = $1
        """,
        submission_id,
    )
    result = []
    for r in rows:
        params = r["parameters"]
        if isinstance(params, str):
            params = json.loads(params)
        result.append({
            "lake_id":    r["lake_id"],
            "lat":        float(r["lat"]),
            "lng":        float(r["lng"]),
            "parameters": params or {},
            "created_by": r["created_by"],
            "observed_at": r["observed_at"],
        })
    return result

async def fetch_river_markers(conn: asyncpg.Connection, submission_id: str) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT
            river_id,
            ST_Y(geom)  AS lat,
            ST_X(geom)  AS lng,
            parameters,
            created_by,
            created_at AS observed_at,
            basin,
            sub_basin
        FROM temp_river_markers
        WHERE submission_id = $1
        """,
        submission_id,
    )
    result = []
    for r in rows:
        params = r["parameters"]
        if isinstance(params, str):
            params = json.loads(params)
        result.append({
            "river_id":   r["river_id"],
            "lat":        float(r["lat"]),
            "lng":        float(r["lng"]),
            "parameters": params or {},
            "created_by": r["created_by"],
            "observed_at": r["observed_at"],
            "basin":      r["basin"],
            "sub_basin":  r["sub_basin"],
        })
    return result