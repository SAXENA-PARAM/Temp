import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL     = os.environ["DATABASE_URL"]
REDIS_URL        = os.environ.get("REDIS_URL", "redis://localhost:6379")
PARAMETERS_XLSX  = os.environ.get("PARAMETERS_XLSX", "Parameters.xlsx")