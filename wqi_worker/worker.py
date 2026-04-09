import asyncio
import json
import logging

from config import REDIS_URL, PARAMETERS_XLSX
from db import get_connection, fetch_markers, fetch_river_markers
from ewqi import run_ewqi
from param_loader import load_parameters
from validator import validate_marker, validate_river_marker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("wqi_worker")

# Populated once in main() before the worker starts accepting jobs.
# Intentionally not a module-level mutable dict — assigned as a whole so
# any job that somehow runs before loading sees a RuntimeError rather than
# silently computing WQI with an empty config.
_PARAM_CONFIG: dict | None = None


def _get_param_config() -> dict:
    if _PARAM_CONFIG is None:
        raise RuntimeError("PARAM_CONFIG not loaded — worker started before main() finished")
    return _PARAM_CONFIG


async def process_submission(job, job_token):
    submission_id = job.data["submissionId"]
    log.info(f"[{submission_id}] job received")

    conn = await get_connection()
    try:
        await conn.execute(
            "UPDATE submissions SET status = 'processing' WHERE id = $1",
            submission_id,
        )

        markers = await fetch_markers(conn, submission_id)

        if not markers:
            log.warning(f"[{submission_id}] no markers found")
            await conn.execute(
                "UPDATE submissions SET status = 'error', processed_at = NOW() WHERE id = $1",
                submission_id,
            )
            return  # do not raise — no retry needed

        param_config = _get_param_config()

        all_errors = []
        for m in markers:
            all_errors.extend(validate_marker(m, param_config))

        if all_errors:
            log.error(f"[{submission_id}] validation failed:\n" + "\n".join(all_errors))
            await conn.execute(
                "UPDATE submissions SET status = 'error', processed_at = NOW() WHERE id = $1",
                submission_id,
            )
            return  # do not raise — data error, no retry needed

        param_dicts = [m["parameters"] for m in markers]
        wqi_list, weights = run_ewqi(param_dicts, param_config)

        log.info(
            f"[{submission_id}] weights: "
            + ", ".join(f"{k}={v:.4f}" for k, v in weights.items() if v > 0)
        )

        async with conn.transaction():
            for i, m in enumerate(markers):
                wqi_score = wqi_list[i]

                if wqi_score is None:
                    log.warning(
                        f"[{submission_id}] lake_id={m['lake_id']}: WQI is NULL"
                    )

                await conn.execute(
                    """
                    INSERT INTO lake_marker_history
                        (submission_id, lake_id, geom,
                         parameters, wqi, created_by, created_at)
                    VALUES
                        ($1, $2,
                         ST_SetSRID(ST_Point($3, $4), 4326),
                         $5::jsonb, $6, $7, $8)
                    """,
                    submission_id,
                    m["lake_id"],
                    m["lng"],
                    m["lat"],
                    json.dumps(m["parameters"]),
                    wqi_score,
                    m["created_by"],
                    m["observed_at"],
                )

                await conn.execute(
                    """
                    INSERT INTO latest_markers (lake_id, geom, wqi, updated_at)
                    VALUES (
                        $1,
                        ST_SetSRID(ST_Point($2, $3), 4326),
                        $4, $5
                    )
                    ON CONFLICT (lake_id, ST_AsText(geom)) DO UPDATE
                        SET wqi        = EXCLUDED.wqi,
                            updated_at = EXCLUDED.updated_at
                        WHERE latest_markers.updated_at < EXCLUDED.updated_at
                    """,
                    m["lake_id"],
                    m["lng"],
                    m["lat"],
                    wqi_score,
                    m["observed_at"],
                )

            await conn.execute(
                "UPDATE submissions SET status = 'completed', processed_at = NOW() WHERE id = $1",
                submission_id,
            )

        log.info(
            f"[{submission_id}] completed — "
            f"{len(markers)} markers, "
            f"{len(set(m['lake_id'] for m in markers))} lakes"
        )

    except Exception:
        log.exception(f"[{submission_id}] unexpected error")
        try:
            await conn.execute(
                "UPDATE submissions SET status = 'error', processed_at = NOW() WHERE id = $1",
                submission_id,
            )
        except Exception:
            pass
        raise  # re-raise → bullmq handles retry + backoff + DLQ

    finally:
        # Wrap close() so an error here doesn't suppress the original exception
        # and doesn't prevent BullMQ from seeing the re-raise above.
        try:
            await conn.close()
        except Exception:
            log.warning(f"[{submission_id}] error closing DB connection", exc_info=True)


async def process_river_submission(job, job_token):
    submission_id = job.data["submissionId"]
    log.info(f"[RIVER][{submission_id}] job received")

    conn = await get_connection()
    try:
        await conn.execute(
            "UPDATE river_submissions SET status = 'processing' WHERE id = $1",
            submission_id,
        )

        markers = await fetch_river_markers(conn, submission_id)

        if not markers:
            log.warning(f"[RIVER][{submission_id}] no markers found")
            await conn.execute(
                "UPDATE river_submissions SET status = 'error', processed_at = NOW() WHERE id = $1",
                submission_id,
            )
            return

        param_config = _get_param_config()

        all_errors = []
        for m in markers:
            all_errors.extend(validate_river_marker(m, param_config))

        if all_errors:
            log.error(f"[RIVER][{submission_id}] validation failed:\n" + "\n".join(all_errors))
            await conn.execute(
                "UPDATE river_submissions SET status = 'error', processed_at = NOW() WHERE id = $1",
                submission_id,
            )
            return

        param_dicts = [m["parameters"] for m in markers]
        wqi_list, weights = run_ewqi(param_dicts, param_config)

        async with conn.transaction():
            for i, m in enumerate(markers):
                wqi_score = wqi_list[i]

                if wqi_score is None:
                    log.warning(
                        f"[RIVER][{submission_id}] river_id={m['river_id']}: WQI is NULL"
                    )

                await conn.execute(
                    """
                    INSERT INTO river_marker_history
                        (submission_id, river_id, geom,
                         parameters, wqi, created_by, created_at)
                    VALUES
                        ($1, $2,
                         ST_SetSRID(ST_Point($3, $4), 4326),
                         $5::jsonb, $6, $7, $8)
                    """,
                    submission_id, m["river_id"],
                    m["lng"], m["lat"],
                    json.dumps(m["parameters"]),
                    wqi_score, m["created_by"], m["observed_at"],
                )

                await conn.execute(
                    """
                    INSERT INTO latest_river_markers (river_id, geom, wqi, updated_at)
                    VALUES ($1, ST_SetSRID(ST_Point($2, $3), 4326), $4, $5)
                    ON CONFLICT (river_id, ST_AsText(geom)) DO UPDATE
                        SET wqi        = EXCLUDED.wqi,
                            updated_at = EXCLUDED.updated_at
                        WHERE latest_river_markers.updated_at < EXCLUDED.updated_at
                    """,
                    m["river_id"], m["lng"], m["lat"],
                    wqi_score, m["observed_at"],
                )

            await conn.execute(
                "UPDATE river_submissions SET status = 'completed', processed_at = NOW() WHERE id = $1",
                submission_id,
            )

        log.info(f"[RIVER][{submission_id}] completed — {len(markers)} markers")

    except Exception:
        log.exception(f"[RIVER][{submission_id}] unexpected error")
        try:
            await conn.execute(
                "UPDATE river_submissions SET status = 'error', processed_at = NOW() WHERE id = $1",
                submission_id,
            )
        except Exception:
            pass
        raise

    finally:
        try:
            await conn.close()
        except Exception:
            log.warning(f"[RIVER][{submission_id}] error closing DB connection", exc_info=True)


async def main():
    global _PARAM_CONFIG
    log.info(f"Loading Parameters.xlsx from: {PARAMETERS_XLSX}")
    loaded = load_parameters(PARAMETERS_XLSX)
    log.info(
        f"Loaded {len(loaded['eff_map'])} efficiency, "
        f"{len(loaded['cost_map'])} cost, "
        f"{len(loaded['int_map'])} interval parameters"
    )
    _PARAM_CONFIG = loaded  # assign atomically — Worker is not started yet

    # ── patch the bullmq empty task set bug ──────────────────────────────
    import bullmq.worker as _bw
    _original_get_completed = _bw.getCompleted

    async def _patched_get_completed(processing, emit):
        if not processing:
            await asyncio.sleep(0.1)
            return set(), set()
        return await _original_get_completed(processing, emit)

    _bw.getCompleted = _patched_get_completed
    # ─────────────────────────────────────────────────────────────────────

    async def dispatch(job, job_token):
        if job.name == "calculate":
            return await process_submission(job, job_token)
        elif job.name == "river_calculate":
            return await process_river_submission(job, job_token)
        else:
            log.warning(f"Unknown job name: {job.name}, skipping")

    from bullmq import Worker
    worker = Worker(
        "wqi-calculation",
        dispatch,
        {"connection": REDIS_URL},
    )
    log.info("WQI worker listening for jobs ...")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())