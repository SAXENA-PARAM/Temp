import asyncio
import json
import logging

from config import REDIS_URL, PARAMETERS_XLSX
from db import get_connection, fetch_markers
from ewqi import run_ewqi
from param_loader import load_parameters
from validator import validate_marker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("wqi_worker")

PARAM_CONFIG: dict = {}


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

        all_errors = []
        for m in markers:
            all_errors.extend(validate_marker(m, PARAM_CONFIG))

        if all_errors:
            log.error(f"[{submission_id}] validation failed:\n" + "\n".join(all_errors))
            await conn.execute(
                "UPDATE submissions SET status = 'error', processed_at = NOW() WHERE id = $1",
                submission_id,
            )
            return  # do not raise — data error, no retry needed

        param_dicts = [m["parameters"] for m in markers]
        wqi_list, weights = run_ewqi(param_dicts, PARAM_CONFIG)

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
        await conn.close()


async def main():
    log.info(f"Loading Parameters.xlsx from: {PARAMETERS_XLSX}")
    PARAM_CONFIG.update(load_parameters(PARAMETERS_XLSX))
    log.info(
        f"Loaded {len(PARAM_CONFIG['eff_map'])} efficiency, "
        f"{len(PARAM_CONFIG['cost_map'])} cost, "
        f"{len(PARAM_CONFIG['int_map'])} interval parameters"
    )

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

    from bullmq import Worker
    worker = Worker(
        "wqi-calculation",
        process_submission,
        {"connection": REDIS_URL},
    )
    log.info("WQI worker listening for jobs ...")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
