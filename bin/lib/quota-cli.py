"""Entrypoint whose trusted script directory contains telemetry and quota."""
from quota.cli import main
raise SystemExit(main())
